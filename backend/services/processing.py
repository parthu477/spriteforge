# ==============================================================
# SpriteForge — services/processing.py
# US-10: Automated Background Removal & Alpha Verification
# US-11: User-Defined Grid Snapping, Frame Trimming & Alignment
# ==============================================================
"""Pure functions for image processing pipeline:
  1. Background removal via rembg (ONNX)
  2. Alpha channel verification
  3. Grid normalisation & frame alignment
  4. Metadata assembly
"""
from __future__ import annotations

import logging
import math
from io import BytesIO
from typing import Any

from PIL import Image

log = logging.getLogger(__name__)

# Module-level rembg session singleton (loaded once)
_rembg_session: Any = None


def _get_rembg_session(model: str = "u2net") -> Any:
    global _rembg_session
    if _rembg_session is None:
        import rembg  # type: ignore
        log.info("Initialising rembg session with model '%s'…", model)
        _rembg_session = rembg.new_session(model)
    return _rembg_session


# ── Background removal (US-10) ────────────────────────────────

def remove_background(
    img: Image.Image,
    rembg_model: str = "u2net",
    alpha_threshold: int = 16,
) -> Image.Image:
    """Strip solid background with rembg, clean near-transparent edges.

    Raises ValueError if alpha coverage is outside [0.01, 0.95].
    """
    import rembg  # type: ignore

    session = _get_rembg_session(rembg_model)

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    raw_out = rembg.remove(buf.read(), session=session)
    result = Image.open(BytesIO(raw_out)).convert("RGBA")

    # Alpha threshold clean-up: clamp near-transparent pixels to 0
    if alpha_threshold > 0:
        r, g, b, a = result.split()
        import PIL.ImageOps as _ops  # noqa: F401 – silence unused warning
        from PIL import ImageChops
        mask = a.point(lambda px: 0 if px < alpha_threshold else px)
        result.putalpha(mask)

    _check_alpha(result)
    return result


def _check_alpha(img: Image.Image) -> None:
    """Raise ValueError if alpha coverage is extreme (AC 10.2)."""
    a = img.getchannel("A")
    raw = a.tobytes()
    total = len(raw)
    foreground = sum(1 for px in raw if px > 0)
    coverage = foreground / total
    if coverage < 0.01 or coverage > 0.95:
        raise ValueError(
            f"bg_removal_failed: alpha coverage {coverage:.3f} is outside "
            f"[0.01, 0.95] — image appears blank or fully opaque."
        )


# ── Grid normalisation (US-11) ────────────────────────────────

def normalise_grid(
    img: Image.Image,
    rows: int,
    columns: int,
    cell_size: int = 0,
    style: str = "pixel_art",
    max_texture_size: int = 4096,
) -> tuple[Image.Image, int, int, int]:
    """Slice image into grid, trim trailing empty frames, centre bounding boxes.

    Returns (normalised_image, frame_width, frame_height, frame_count).
    """
    # Compute integer frame dimensions (AC 11.1, 11.2)
    frame_width = img.width // columns
    frame_height = img.height // rows

    # Crop to exact multiple (removes odd pixels)
    target_w = frame_width * columns
    target_h = frame_height * rows
    if (target_w, target_h) != (img.width, img.height):
        img = img.crop((0, 0, target_w, target_h))

    # Optional cell-size snapping
    if cell_size > 0:
        resample = Image.NEAREST if style == "pixel_art" else Image.LANCZOS
        new_w = cell_size * columns
        new_h = cell_size * rows
        if new_w > max_texture_size or new_h > max_texture_size:
            raise ValueError(
                f"processing_failed: requested cell_size {cell_size} would produce "
                f"{new_w}×{new_h}, exceeding MAX_TEXTURE_SIZE {max_texture_size}."
            )
        img = img.resize((new_w, new_h), resample)
        frame_width = cell_size
        frame_height = cell_size

    total_frames = rows * columns
    frames = _extract_frames(img, rows, columns, frame_width, frame_height)

    # Trim trailing empty frames (AC 11.3)
    frame_count = total_frames
    for i in range(total_frames - 1, -1, -1):
        if _alpha_density(frames[i]) < 0.005:
            frame_count = i
        else:
            break
    frame_count = max(1, frame_count)

    # Centre bounding boxes to eliminate jitter
    centred = [_centre_frame(f, frame_width, frame_height) for f in frames]

    # Reconstruct sprite sheet
    out = Image.new("RGBA", (frame_width * columns, frame_height * rows), (0, 0, 0, 0))
    for i, frame in enumerate(centred):
        col = i % columns
        row = i // columns
        out.paste(frame, (col * frame_width, row * frame_height))

    return out, frame_width, frame_height, frame_count


def _extract_frames(
    img: Image.Image,
    rows: int,
    columns: int,
    fw: int,
    fh: int,
) -> list[Image.Image]:
    frames = []
    for r in range(rows):
        for c in range(columns):
            box = (c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)
            frames.append(img.crop(box))
    return frames


def _alpha_density(frame: Image.Image) -> float:
    if frame.mode != "RGBA":
        return 1.0
    a = frame.getchannel("A")
    raw = a.tobytes()
    return sum(1 for px in raw if px > 0) / len(raw)


def _centre_frame(
    frame: Image.Image, fw: int, fh: int
) -> Image.Image:
    """Centre the opaque bounding box of *frame* within a fw×fh canvas."""
    if frame.mode != "RGBA":
        return frame
    bbox = frame.getbbox()
    if bbox is None:
        return frame  # empty frame — leave as-is
    cropped = frame.crop(bbox)
    out = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    x = (fw - cropped.width) // 2
    y = (fh - cropped.height) // 2
    out.paste(cropped, (x, y), cropped)
    return out


# ── Metadata assembly ─────────────────────────────────────────

def build_metadata(
    *,
    name: str,
    image_file: str,
    frame_width: int,
    frame_height: int,
    rows: int,
    columns: int,
    frame_count: int,
    fps: int = 8,
    loop: bool = True,
    prompt: str,
    style: str,
    seed: int,
    provider_name: str,
    model: str,
    generated_at: str,
    seed_applied: bool = True,
) -> dict:
    return {
        "schema_version": 1,
        "name": name,
        "image_file": image_file,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "rows": rows,
        "columns": columns,
        "frame_count": frame_count,
        "fps": fps,
        "loop": loop,
        "source": {
            "prompt": prompt,
            "style": style,
            "seed": seed,
            "provider": provider_name,
            "model": model,
            "generated_at": generated_at,
            "seed_applied": seed_applied,
        },
    }
