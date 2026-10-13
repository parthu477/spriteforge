# ==============================================================
# SpriteForge — services/prompt_builder.py
# Builds the final generation prompt from user input + style presets
# ==============================================================
from __future__ import annotations

import logging
from pathlib import Path

import yaml

log = logging.getLogger(__name__)

_PRESETS_PATH = Path(__file__).parent.parent / "prompts" / "presets.yaml"
_presets: dict | None = None


def _load_presets() -> dict:
    global _presets
    if _presets is None:
        with open(_PRESETS_PATH) as f:
            _presets = yaml.safe_load(f)
    return _presets


def build_prompt(
    user_prompt: str,
    style: str,
    rows: int,
    columns: int,
) -> tuple[str, str]:
    """Return (positive_prompt, negative_prompt) for the generation call."""
    presets = _load_presets()
    style_cfg = presets.get("styles", {}).get(style, {})

    style_prefix = style_cfg.get("prefix", "")
    style_suffix = style_cfg.get("suffix", "")
    negative = style_cfg.get("negative", "")
    grid_note = presets.get("grid_notes", {}).get(f"{rows}x{columns}", "")

    parts = [p for p in [style_prefix, user_prompt, style_suffix, grid_note] if p]
    positive = ", ".join(parts)
    return positive, negative
