# ==============================================================
# SpriteForge — services/providers/local_cpu.py
# US-09: Local CPU Fallback Provider (SD-Turbo via OpenVINO)
# ==============================================================
"""LocalCpuProvider: loads SD-Turbo weights once at startup via
optimum-intel OVStableDiffusionPipeline and generates images
entirely on CPU without internet access.
"""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image

from backend.config import cfg
from .base import ProviderLocalError

log = logging.getLogger(__name__)

_pipeline = None  # module-level singleton (loaded once)


def _load_pipeline() -> "object":
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    try:
        from optimum.intel import OVStableDiffusionPipeline  # type: ignore
    except ImportError as exc:
        raise ProviderLocalError(
            "optimum[openvino] is not installed. "
            "Run: pip install 'optimum[openvino]' diffusers transformers accelerate"
        ) from exc

    model_dir = Path(cfg.LOCAL_MODEL_DIR).resolve()
    if not model_dir.exists() or not any(model_dir.iterdir()):
        raise ProviderLocalError(
            f"Local model directory '{model_dir}' is missing or empty. "
            "Export the model first with the setup guide."
        )

    try:
        log.info("Loading local CPU model from '%s'…", model_dir)
        _pipeline = OVStableDiffusionPipeline.from_pretrained(
            str(model_dir), compile=False
        )
        log.info("Local CPU model loaded successfully.")
        return _pipeline
    except Exception as exc:
        raise ProviderLocalError(f"Failed to load local model: {exc}") from exc


class LocalCpuProvider:
    """Option B — SD-Turbo via OpenVINO, in-process, CPU only."""

    name = "local_cpu"
    supports_negative_prompt = False
    supports_seed = True

    def __init__(self) -> None:
        self.model = cfg.LOCAL_MODEL_ID
        self.max_side = 512
        self._steps = cfg.LOCAL_STEPS
        # Attempt to load the pipeline at provider construction time (startup check)
        try:
            _load_pipeline()
        except ProviderLocalError as exc:
            log.warning("LocalCpuProvider startup check failed: %s", exc)

    def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
    ) -> Image.Image:
        try:
            pipe = _load_pipeline()
        except ProviderLocalError:
            raise

        import torch  # type: ignore
        generator = torch.manual_seed(seed)

        try:
            result = pipe(
                prompt=prompt,
                num_inference_steps=self._steps,
                guidance_scale=0.0,
                width=min(width, self.max_side),
                height=min(height, self.max_side),
                generator=generator,
                output_type="pil",
            )
            img: Image.Image = result.images[0]
            return img.convert("RGB")
        except MemoryError as exc:
            raise ProviderLocalError("Out of memory during local CPU inference.") from exc
        except Exception as exc:
            raise ProviderLocalError(f"Local model inference failed: {exc}") from exc
