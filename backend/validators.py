# ==============================================================
# SpriteForge Backend — validators.py
# Input validation + slugification (used by routes/api.py)
# ==============================================================
from __future__ import annotations

import re
import unicodedata
from typing import Any

VALID_GRIDS = {"1x4", "1x6", "1x8", "2x4", "4x4"}
VALID_STYLES = {"pixel_art", "cartoon", "painterly"}
VALID_PALETTES = {
    "original",
    "pico-8",
    "pico8",
    "pico_8",
    "gameboy",
    "game-boy",
    "game_boy",
    "nes",
    "endesga-32",
    "endesga32",
    "endesga_32",
}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
MAX_SEED = 4_294_967_295


def validate_generate(data: dict[str, Any]) -> dict[str, str]:
    """Return a dict of field → error message.  Empty dict = valid."""
    errors: dict[str, str] = {}

    # prompt
    prompt = data.get("prompt", "")
    if not isinstance(prompt, str):
        errors["prompt"] = "Prompt must be a string."
    else:
        prompt = prompt.strip()
        if len(prompt) < 3 or len(prompt) > 300:
            errors["prompt"] = "Prompt must be 3–300 characters."
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", prompt):
            errors["prompt"] = "Prompt must not contain control characters."

    # name (optional)
    name = data.get("name")
    if name is not None:
        if not isinstance(name, str):
            errors["name"] = "Name must be a string."
        else:
            slugged = slugify(name)
            if not slugged:
                errors["name"] = "Name could not be converted to a valid slug."
            elif not SLUG_RE.match(slugged):
                errors["name"] = (
                    "Name slug must match ^[a-z0-9][a-z0-9_-]{0,47}$."
                )

    # grid
    grid = data.get("grid")
    if grid not in VALID_GRIDS:
        errors["grid"] = f"Grid must be one of: {', '.join(sorted(VALID_GRIDS))}."

    # style
    style = data.get("style")
    if style not in VALID_STYLES:
        errors["style"] = f"Style must be one of: {', '.join(sorted(VALID_STYLES))}."

    # seed (optional)
    seed = data.get("seed")
    if seed is not None:
        if not isinstance(seed, int) or isinstance(seed, bool):
            errors["seed"] = "Seed must be an integer."
        elif not (0 <= seed <= MAX_SEED):
            errors["seed"] = f"Seed must be 0–{MAX_SEED}."

    # multi_action (optional, US-23)
    multi_action = data.get("multi_action")
    if multi_action is not None:
        if not isinstance(multi_action, bool):
            errors["multi_action"] = "multi_action must be a boolean."
        elif multi_action and grid != "4x4":
            errors["grid"] = "Multi-action mode requires a 4x4 grid."

    # palette (optional, US-22)
    palette = data.get("palette")
    if palette is not None:
        if not isinstance(palette, str):
            errors["palette"] = "Palette must be a string."
        elif palette.lower().strip() not in VALID_PALETTES:
            errors["palette"] = f"Palette must be one of: {', '.join(sorted(VALID_PALETTES))}."

    # outline (optional, US-22)
    outline = data.get("outline")
    if outline is not None:
        if not isinstance(outline, bool):
            errors["outline"] = "Outline must be a boolean."

    return errors


def slugify(text: str, max_len: int = 48) -> str:
    """Convert arbitrary text to a safe slug."""
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^a-z0-9_\-]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_-")
    text = text[:max_len].rstrip("_-")
    if not text:
        return ""
    if not re.match(r"^[a-z0-9]", text):
        text = "s" + text
    return text


def grid_to_rows_cols(grid: str) -> tuple[int, int]:
    """Parse 'RxC' → (rows, cols). Raises ValueError on bad input."""
    parts = grid.split("x")
    if len(parts) != 2:
        raise ValueError(f"Invalid grid format: {grid!r}")
    return int(parts[0]), int(parts[1])
