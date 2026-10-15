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
    multi_action: bool = False,
) -> tuple[str, str]:
    """Return (positive_prompt, negative_prompt) for the generation call (AC 23.1)."""
    presets = _load_presets()
    style_cfg = presets.get("styles", {}).get(style, {})

    style_prefix = style_cfg.get("prefix", "")
    style_suffix = style_cfg.get("suffix", "")
    negative = style_cfg.get("negative", "")

    if multi_action and rows == 4 and columns == 4:
        multi_cfg = presets.get("multi_action", {})
        grid_note = multi_cfg.get(
            "grid_note",
            "4x4 character sprite sheet state machine with 4 distinct action rows of 4 frames each: "
            "Row 0 is Idle standing animation, Row 1 is Walk cycle animation, "
            "Row 2 is Attack animation, Row 3 is Hurt and Death reaction animation; "
            "visual character consistency with identical costume, colors, and proportions across all rows",
        )
        multi_neg = multi_cfg.get("negative", "")
        if multi_neg:
            negative = f"{negative}, {multi_neg}" if negative else multi_neg
    else:
        grid_note = presets.get("grid_notes", {}).get(f"{rows}x{columns}", "")

    parts = [p for p in [style_prefix, user_prompt, style_suffix, grid_note] if p]
    positive = ", ".join(parts)
    return positive, negative
