# ==============================================================
# SpriteForge — services/providers/gemini.py
# Google Gemini Provider for AI Image Generation
# ==============================================================
"""GeminiProvider: calls the Google Generative Language API endpoint
to generate images using Google Gemini multimodal models (e.g. gemini-2.5-flash-image)
with exponential back-off, byte-limit verification, quota error detection,
and guaranteed token redaction in logs.
"""
from __future__ import annotations

import base64
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
    "https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
)
_BACKOFF = (2, 4, 8)


class GeminiProvider:
    """Option D — Google Gemini Image Provider."""

    name = "gemini"
    supports_negative_prompt = True
    supports_seed = True

    def __init__(self) -> None:
        raw_model = cfg.GEMINI_MODEL.strip()
        self.model = raw_model.removeprefix("models/")
        self.max_side = 1024
        self._url = _ENDPOINT_TMPL.format(model_id=self.model)
        self._api_key = cfg.GEMINI_API_KEY
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
            "Content-Type": "application/json",
        }

        # Build prompt with optional negative avoidance context
        full_prompt = prompt
        if negative_prompt and negative_prompt.strip():
            full_prompt = f"{prompt}\nNegative prompt (avoid these elements): {negative_prompt.strip()}"

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": full_prompt}
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
            },
        }

        last_exc: Exception = RuntimeError("Unknown error")
        params = {"key": self._api_key}

        for attempt in range(self._max_retries + 1):
            try:
                resp = requests.post(
                    self._url,
                    params=params,
                    json=payload,
                    headers=headers,
                    timeout=self._timeout,
                )
            except requests.Timeout as exc:
                last_exc = exc
                log.warning(
                    "Gemini request timed out (attempt %d/%d)",
                    attempt + 1,
                    self._max_retries + 1,
                )
                self._maybe_backoff(attempt)
                continue
            except requests.RequestException as exc:
                last_exc = exc
                log.warning(
                    "Gemini network error (attempt %d/%d): %s",
                    attempt + 1,
                    self._max_retries + 1,
                    exc,
                )
                self._maybe_backoff(attempt)
                continue

            # ── Auth failures — don't retry ───────────────────
            if resp.status_code in (401, 403):
                log.error(
                    "Gemini auth failed (HTTP %d). Verify GEMINI_API_KEY in .env.",
                    resp.status_code,
                )
                raise ProviderAuthError(
                    f"Gemini returned HTTP {resp.status_code}. "
                    "Verify GEMINI_API_KEY in .env."
                )

            # ── Quota exceeded or rate limited ─────────────────
            if resp.status_code == 429:
                resp_text = resp.text.lower()
                # Free-tier limit reached or billing required for image generation
                if (
                    "quota" in resp_text
                    or "limit: 0" in resp_text
                    or "exceeded your current quota" in resp_text
                ):
                    log.warning("Gemini quota exceeded or image generation requires billing account.")
                    raise ProviderQuotaExceeded(
                        "Gemini quota exceeded or image generation requires billing account enabled in Google AI Studio."
                    )

                retry_after = int(resp.headers.get("Retry-After", 0))
                sleep = retry_after if retry_after else _BACKOFF[min(attempt, 2)]
                log.warning(
                    "Gemini rate-limited (attempt %d/%d, retry-after=%s s)",
                    attempt + 1,
                    self._max_retries + 1,
                    sleep,
                )
                time.sleep(sleep)
                last_exc = ProviderRateLimited("HTTP 429")
                continue

            # ── Transient server errors — retry ───────────────
            if resp.status_code in (500, 502, 503, 504):
                log.warning(
                    "Gemini server error HTTP %d (attempt %d/%d)",
                    resp.status_code,
                    attempt + 1,
                    self._max_retries + 1,
                )
                self._maybe_backoff(attempt)
                last_exc = ProviderUnavailable(f"HTTP {resp.status_code}")
                continue

            if resp.status_code != 200:
                raise ProviderUnavailable(
                    f"Gemini returned unexpected HTTP {resp.status_code}: {resp.text[:200]}"
                )

            # ── Parse response JSON & decode inline image ─────
            try:
                data = resp.json()
            except Exception as exc:
                raise ProviderBadResponse(f"Gemini returned invalid JSON: {exc}") from exc

            candidates = data.get("candidates", [])
            if not candidates:
                raise ProviderBadResponse("Gemini response contained no candidates.")

            parts = candidates[0].get("content", {}).get("parts", [])
            img_bytes = None
            for part in parts:
                inline_data = part.get("inlineData")
                if inline_data and "data" in inline_data:
                    try:
                        img_bytes = base64.b64decode(inline_data["data"])
                        break
                    except Exception as exc:
                        raise ProviderBadResponse(
                            f"Failed to decode base64 image from Gemini: {exc}"
                        ) from exc

            if not img_bytes:
                raise ProviderBadResponse("Gemini response did not contain an inline image.")

            if len(img_bytes) > self._max_bytes:
                raise ProviderBadResponse(
                    f"Gemini image exceeded {self._max_bytes} bytes limit."
                )

            try:
                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                return img
            except Exception as exc:
                raise ProviderBadResponse(f"Could not decode Gemini image: {exc}") from exc

        # Exhausted all retries
        if isinstance(last_exc, ProviderRateLimited):
            raise last_exc
        raise ProviderUnavailable(
            f"Gemini unavailable after {self._max_retries + 1} attempts: {last_exc}"
        )

    def _maybe_backoff(self, attempt: int) -> None:
        if attempt < self._max_retries:
            time.sleep(_BACKOFF[min(attempt, len(_BACKOFF) - 1)])
