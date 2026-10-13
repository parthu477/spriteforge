# ==============================================================
# SpriteForge — services/providers/huggingface.py
# Option C — HuggingFace Inference (paid, built only if needed)
# ==============================================================
from __future__ import annotations

import io
import logging

import requests
from PIL import Image

from backend.config import cfg
from .base import (
    ProviderAuthError,
    ProviderBadResponse,
    ProviderUnavailable,
)

log = logging.getLogger(__name__)


class HuggingFaceProvider:
    """Option C — HuggingFace Inference API (paid tier)."""

    name = "huggingface"
    supports_negative_prompt = True
    supports_seed = False

    def __init__(self) -> None:
        self.model = cfg.HF_MODEL_ID
        self.max_side = 1024
        if not cfg.HF_TOKEN:
            raise ValueError("HF_TOKEN is required for HuggingFaceProvider.")
        if not cfg.HF_API_URL:
            raise ValueError("HF_API_URL is required for HuggingFaceProvider.")

    def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
    ) -> Image.Image:
        headers = {"Authorization": f"Bearer {cfg.HF_TOKEN}"}
        payload = {
            "inputs": prompt,
            "parameters": {
                "negative_prompt": negative_prompt,
                "width": width,
                "height": height,
            },
        }
        try:
            resp = requests.post(
                cfg.HF_API_URL,
                json=payload,
                headers=headers,
                timeout=cfg.PROVIDER_TIMEOUT_S,
            )
        except requests.RequestException as exc:
            raise ProviderUnavailable(f"HuggingFace request failed: {exc}") from exc

        if resp.status_code in (401, 403):
            raise ProviderAuthError("HuggingFace token invalid or not authorised.")
        if not resp.ok:
            raise ProviderUnavailable(f"HuggingFace returned HTTP {resp.status_code}.")

        try:
            img = Image.open(io.BytesIO(resp.content)).convert("RGB")
            return img
        except Exception as exc:
            raise ProviderBadResponse(f"Could not decode HF response: {exc}") from exc
