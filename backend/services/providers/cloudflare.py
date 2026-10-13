# ==============================================================
# SpriteForge — services/providers/cloudflare.py
# US-08: Cloudflare Workers AI Primary Provider (FLUX.1 schnell)
# ==============================================================
"""CloudflareProvider: calls the Cloudflare Workers AI endpoint
with exponential back-off, Bearer auth, byte-limit verification,
and guaranteed token redaction in logs.
"""
from __future__ import annotations

import io
import logging
import time

import requests
from PIL import Image

from backend.config import cfg
from .base import (
    ProviderAuthError,
    ProviderBadResponse,
    ProviderQuotaExceeded,
    ProviderRateLimited,
    ProviderUnavailable,
)

log = logging.getLogger(__name__)

_ENDPOINT_TMPL = (
    "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model_id}"
)
# Back-off delays for retry 1, 2, 3 (seconds)
_BACKOFF = (2, 4, 8)


class CloudflareProvider:
    """Option A — Cloudflare Workers AI free tier."""

    name = "cloudflare"
    supports_negative_prompt = False
    supports_seed = True

    def __init__(self) -> None:
        self.model = cfg.CF_MODEL_ID
        self.max_side = 1024
        self._url = _ENDPOINT_TMPL.format(
            account_id=cfg.CF_ACCOUNT_ID,
            model_id=cfg.CF_MODEL_ID,
        )
        self._timeout = cfg.PROVIDER_TIMEOUT_S
        self._max_retries = cfg.PROVIDER_MAX_RETRIES
        self._max_bytes = cfg.MAX_IMAGE_BYTES

    def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
    ) -> Image.Image:
        headers = {
            "Authorization": f"Bearer {cfg.CF_API_TOKEN}",
            "Content-Type": "application/json",
        }
        payload = {"prompt": prompt, "steps": cfg.CF_STEPS, "seed": seed}

        last_exc: Exception = RuntimeError("Unknown error")
        for attempt in range(self._max_retries + 1):
            try:
                resp = requests.post(
                    self._url,
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                    stream=True,
                )
            except requests.Timeout as exc:
                last_exc = exc
                log.warning(
                    "Cloudflare request timed out (attempt %d/%d)",
                    attempt + 1,
                    self._max_retries + 1,
                )
                self._maybe_backoff(attempt)
                continue
            except requests.RequestException as exc:
                last_exc = exc
                log.warning(
                    "Cloudflare network error (attempt %d/%d): %s",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )
                self._maybe_backoff(attempt)
                continue

            # ── Auth failures — don't retry (AC 8.3) ─────────
            if resp.status_code in (401, 403):
                log.error(
                    "Cloudflare auth failed (HTTP %d). Check CF_ACCOUNT_ID / CF_API_TOKEN.",
                    resp.status_code,
                )
                raise ProviderAuthError(
                    f"Cloudflare returned HTTP {resp.status_code}. "
                    "Verify CF_ACCOUNT_ID and CF_API_TOKEN."
                )

            # ── Quota exceeded ────────────────────────────────
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 0))
                # Treat as quota exceeded so job runner switches to fallback
                if "daily" in resp.text.lower() or retry_after > 3600:
                    raise ProviderQuotaExceeded("Cloudflare daily neuron allowance exhausted.")
                log.warning(
                    "Cloudflare rate-limited (attempt %d/%d, retry-after=%s s)",
                    attempt + 1,
                    self._max_retries + 1,
                    retry_after or "?",
                )
                sleep = retry_after if retry_after else _BACKOFF[min(attempt, 2)]
                time.sleep(sleep)
                last_exc = ProviderRateLimited("HTTP 429")
                continue

            # ── Transient server errors — retry ───────────────
            if resp.status_code in (500, 502, 503, 504):
                log.warning(
                    "Cloudflare server error HTTP %d (attempt %d/%d)",
                    resp.status_code,
                    attempt + 1,
                    self._max_retries + 1,
                )
                self._maybe_backoff(attempt)
                last_exc = ProviderUnavailable(f"HTTP {resp.status_code}")
                continue

            if resp.status_code != 200:
                raise ProviderUnavailable(f"Unexpected HTTP {resp.status_code}")

            # ── Byte-limit verification (AC 8.5) ──────────────
            raw = b""
            for chunk in resp.iter_content(chunk_size=65536):
                raw += chunk
                if len(raw) > self._max_bytes:
                    raise ProviderBadResponse(
                        f"Response exceeded {self._max_bytes} bytes limit."
                    )

            # ── Content-type check (AC 8.5) ───────────────────
            ct = resp.headers.get("Content-Type", "")
            if "image" not in ct and len(raw) < 8:
                raise ProviderBadResponse(
                    f"Unexpected content-type '{ct}'; expected an image."
                )

            try:
                img = Image.open(io.BytesIO(raw)).convert("RGB")
                return img
            except Exception as exc:
                raise ProviderBadResponse(f"Could not decode image: {exc}") from exc

        # Exhausted all retries
        if isinstance(last_exc, ProviderRateLimited):
            raise last_exc
        raise ProviderUnavailable(
            f"Cloudflare unavailable after {self._max_retries + 1} attempts: {last_exc}"
        )

    def _maybe_backoff(self, attempt: int) -> None:
        if attempt < self._max_retries:
            time.sleep(_BACKOFF[min(attempt, len(_BACKOFF) - 1)])
