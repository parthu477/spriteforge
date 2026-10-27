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
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image

log = logging.getLogger(__name__)

# ── US-22: Retro Color Palettes (AC 22.1) ──────────────────────

# PICO-8 (16 authentic colors)
PICO8_PALETTE: list[tuple[int, int, int]] = [
    (0, 0, 0),        # 0 Black
    (29, 43, 83),     # 1 Dark Blue
    (126, 37, 83),    # 2 Dark Purple
    (0, 135, 81),     # 3 Dark Green
    (171, 82, 54),    # 4 Brown
    (95, 87, 79),     # 5 Dark Gray
    (194, 195, 199),  # 6 Light Gray
    (255, 241, 232),  # 7 White
    (255, 0, 77),     # 8 Red
    (255, 163, 0),    # 9 Orange
    (255, 236, 39),   # 10 Yellow
    (0, 228, 54),     # 11 Green
    (41, 173, 255),   # 12 Blue
    (131, 118, 156),  # 13 Indigo
    (255, 119, 168),  # 14 Pink
    (255, 204, 170),  # 15 Peach
]

# Game Boy DMG-01 (4 authentic green shades)
GAMEBOY_PALETTE: list[tuple[int, int, int]] = [
    (15, 56, 15),     # #0f380f Darkest green
    (48, 98, 48),     # #306230 Dark green
    (139, 172, 15),   # #8bac0f Light green
    (155, 188, 15),   # #9bbc0f Lightest green
]

# NES 2C02 PPU (54 authentic colors)
NES_PALETTE: list[tuple[int, int, int]] = [
    (102, 102, 102), (0, 42, 136), (20, 18, 167), (59, 0, 164),
    (92, 0, 126), (110, 0, 64), (108, 6, 0), (86, 29, 0),
    (51, 53, 0), (11, 72, 0), (0, 82, 0), (0, 79, 8),
    (0, 64, 77), (0, 0, 0),
    (173, 173, 173), (21, 95, 217), (66, 64, 255), (117, 39, 254),
    (160, 26, 204), (183, 30, 123), (181, 49, 32), (153, 78, 0),
    (107, 109, 0), (56, 135, 0), (12, 147, 0), (0, 143, 50),
    (0, 124, 141), (0, 0, 0),
    (255, 255, 255), (100, 176, 255), (146, 144, 255), (198, 118, 255),
    (243, 106, 255), (254, 110, 204), (254, 129, 112), (234, 158, 34),
    (188, 190, 0), (136, 216, 0), (92, 228, 48), (69, 224, 130),
    (72, 205, 222), (79, 79, 79),
    (255, 255, 255), (192, 223, 255), (211, 210, 255), (232, 200, 255),
    (251, 194, 255), (254, 196, 234), (254, 204, 197), (247, 216, 165),
    (228, 229, 148), (207, 239, 150), (189, 244, 171), (179, 243, 204),
    (181, 235, 242), (184, 184, 184),
]

# Endesga-32 (32 authentic colors)
ENDESGA32_PALETTE: list[tuple[int, int, int]] = [
    (190, 74, 47),   # #be4a2f
    (215, 118, 67),  # #d77643
    (234, 212, 170), # #ead4aa
    (228, 166, 114), # #e4a672
    (184, 111, 80),  # #b86f50
    (115, 62, 57),   # #733e39
    (62, 39, 49),    # #3e2731
    (162, 38, 51),   # #a22633
    (228, 59, 68),   # #e43b44
    (247, 118, 34),  # #f77622
    (254, 174, 52),  # #feae34
    (254, 231, 97),  # #fee761
    (99, 199, 77),   # #63c74d
    (62, 137, 72),   # #3e8948
    (38, 92, 66),    # #265c42
    (25, 60, 62),    # #193c3e
    (18, 78, 137),   # #124e89
    (0, 153, 219),   # #0099db
    (44, 232, 245),  # #2ce8f5
    (255, 255, 255), # #ffffff
    (192, 203, 220), # #c0cbdc
    (139, 155, 180), # #8b9bb4
    (90, 105, 136),  # #5a6988
    (58, 68, 102),   # #3a4466
    (38, 43, 68),    # #262b44
    (24, 20, 37),    # #181425
    (255, 0, 68),    # #ff0044
    (104, 56, 108),  # #68386c
    (181, 80, 136),  # #b55088
    (246, 117, 122), # #f6757a
    (232, 183, 150), # #e8b796
    (194, 133, 105), # #c28569
]

PALETTES: dict[str, list[tuple[int, int, int]]] = {
    "pico8": PICO8_PALETTE,
    "pico-8": PICO8_PALETTE,
    "pico_8": PICO8_PALETTE,
    "gameboy": GAMEBOY_PALETTE,
    "game-boy": GAMEBOY_PALETTE,
    "game_boy": GAMEBOY_PALETTE,
    "nes": NES_PALETTE,
    "endesga32": ENDESGA32_PALETTE,
    "endesga-32": ENDESGA32_PALETTE,
    "endesga_32": ENDESGA32_PALETTE,
}

_PALETTE_IMAGES: dict[str, Image.Image] = {}


def _get_palette_image(palette_key: str) -> Image.Image | None:
    norm = palette_key.lower().strip()
    if norm not in PALETTES:
        return None
    if norm not in _PALETTE_IMAGES:
        colors = PALETTES[norm]
        pal_img = Image.new("P", (1, 1))
        flat = []
        for r, g, b in colors:
            flat.extend([r, g, b])
        flat.extend([0] * (768 - len(flat)))
        pal_img.putpalette(flat)
        _PALETTE_IMAGES[norm] = pal_img
    return _PALETTE_IMAGES[norm]


# ── AC 22.2: Edge Defringing ──────────────────────────────────

def defringe(img: Image.Image, alpha_threshold: int = 128) -> Image.Image:
    """Eliminate semi-transparent blurry halo pixels left behind by background removal (AC 22.2).

    1. Bleeds adjacent solid foreground color into semi-transparent fringe pixels.
    2. Zeroes out weak halo pixels (< alpha_threshold).
    3. Clamps remaining foreground alpha to 255 for crisp pixel-art edges.
    """
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    arr = np.array(img).copy()
    alpha = arr[..., 3]

    # Core solid foreground vs fringe halo boundary
    solid = alpha >= 230
    fringe = (alpha >= alpha_threshold) & (~solid)

    # Color bleed: replace background-contaminated edge color with solid neighbor color
    if np.any(fringe) and np.any(solid):
        h, w = alpha.shape
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted_solid = np.zeros_like(solid)
            y_src = max(0, -dy)
            y_dst = max(0, dy)
            x_src = max(0, -dx)
            x_dst = max(0, dx)
            y_len = h - abs(dy)
            x_len = w - abs(dx)
            shifted_solid[y_dst:y_dst + y_len, x_dst:x_dst + x_len] = solid[y_src:y_src + y_len, x_src:x_src + x_len]
            can_fill = fringe & shifted_solid
            if np.any(can_fill):
                y_idx, x_idx = np.where(can_fill)
                arr[y_idx, x_idx, :3] = arr[y_idx - dy, x_idx - dx, :3]
                fringe[can_fill] = False

    # Crisp pixel art alpha: 0 below threshold, 255 above
    mask = alpha >= alpha_threshold
    arr[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
    arr[~mask, :3] = 0

    return Image.fromarray(arr)


# ── AC 22.3: 1-Pixel Dark Outline Generator ───────────────────

def add_outline(
    img: Image.Image,
    rows: int = 1,
    columns: int = 4,
    color: tuple[int, int, int] = (16, 16, 16),
) -> Image.Image:
    """Add an optional 1-pixel dark outline around character silhouette per frame (AC 22.3)."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    fw = img.width // columns
    fh = img.height // rows
    frames = _extract_frames(img, rows, columns, fw, fh)

    outlined_frames = []
    for f in frames:
        arr = np.array(f).copy()
        alpha = arr[..., 3]
        mask = alpha > 0
        if not np.any(mask):
            outlined_frames.append(f)
            continue

        # 8-connectivity dilation to generate a crisp 1px outline
        dilated = mask.copy()
        dilated[1:, :] |= mask[:-1, :]
        dilated[:-1, :] |= mask[1:, :]
        dilated[:, 1:] |= mask[:, :-1]
        dilated[:, :-1] |= mask[:, 1:]
        dilated[1:, 1:] |= mask[:-1, :-1]
        dilated[1:, :-1] |= mask[:-1, 1:]
        dilated[:-1, 1:] |= mask[1:, :-1]
        dilated[:-1, :-1] |= mask[1:, 1:]

        outline_mask = dilated & (~mask)
        arr[outline_mask] = [color[0], color[1], color[2], 255]
        outlined_frames.append(Image.fromarray(arr))

    out = Image.new("RGBA", (img.width, img.height), (0, 0, 0, 0))
    for i, frame in enumerate(outlined_frames):
        c = i % columns
        r = i // columns
        out.paste(frame, (c * fw, r * fh))
    return out


# ── AC 22.1: Palette Quantization ─────────────────────────────

def quantize_palette(img: Image.Image, palette_name: str) -> Image.Image:
    """Quantize sprite sheet to authentic retro color palette (AC 22.1)."""
    pal_key = palette_name.lower().strip()
    if pal_key in ("original", "none", "", "default"):
        return img

    pal_img = _get_palette_image(pal_key)
    if pal_img is None:
        log.warning("Unknown palette '%s', keeping original colors.", palette_name)
        return img

    if img.mode != "RGBA":
        img = img.convert("RGBA")

    alpha = img.getchannel("A")
    rgb = img.convert("RGB")
    quant = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE).convert("RGBA")
    quant.putalpha(alpha)
    return quant


# ── Unified Retro Post-Processing (AC 22.1, 22.2, 22.3, 22.5) ──

def apply_retro_postprocessing(
    img: Image.Image,
    *,
    palette: str = "original",
    outline: bool = False,
    rows: int = 1,
    columns: int = 4,
    alpha_threshold: int = 128,
) -> Image.Image:
    """Execute retro post-processing (defringe, outline, palette quantization) under 100ms (AC 22.5)."""
    # 1. Defringe halo pixels (AC 22.2)
    img = defringe(img, alpha_threshold=alpha_threshold)

    # 2. Optional 1px dark outline (AC 22.3)
    if outline:
        img = add_outline(img, rows=rows, columns=columns)

    # 3. Authentic palette quantization (AC 22.1)
    if palette and palette.lower().strip() not in ("original", "none", ""):
        img = quantize_palette(img, palette)

    return img

# Module-level rembg session singleton (loaded once)
_rembg_session: Any = None
_rembg_model_name: str | None = None
_rembg_lock = threading.Lock()


def _get_rembg_session(model: str = "u2netp") -> Any:
    global _rembg_session, _rembg_model_name
    with _rembg_lock:
        if _rembg_session is None or _rembg_model_name != model:
            import rembg  # type: ignore
            import onnxruntime as ort

            sess_opts = ort.SessionOptions()
            sess_opts.intra_op_num_threads = 1
            sess_opts.inter_op_num_threads = 1
            sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

            log.info("Initialising rembg session with model '%s' (single-threaded for cloud)…", model)
            _rembg_session = rembg.new_session(model, sess_opts=sess_opts)
            _rembg_model_name = model
        return _rembg_session


# ── Background removal (US-10) ────────────────────────────────

def _vectorized_chroma_key(img: Image.Image) -> Image.Image:
    """Fast vectorized corner-based chroma keying fallback."""
    arr = np.array(img.convert("RGBA"))
    corners = np.array([arr[0, 0, :3], arr[0, -1, :3], arr[-1, 0, :3], arr[-1, -1, :3]], dtype=np.float32)
    avg_corner = np.mean(corners, axis=0)
    dist = np.sqrt(np.sum((arr[..., :3].astype(np.float32) - avg_corner) ** 2, axis=-1))

    # Try thresholds to ensure valid alpha coverage in [0.01, 0.95]
    for thresh in (32.0, 48.0, 64.0, 24.0):
        mask = dist >= thresh
        cov = float(np.count_nonzero(mask)) / mask.size
        if 0.01 <= cov <= 0.95:
            arr_copy = arr.copy()
            arr_copy[~mask, 3] = 0
            return Image.fromarray(arr_copy)

    arr[dist < 32.0, 3] = 0
    return Image.fromarray(arr)


def remove_background(
    img: Image.Image,
    rembg_model: str = "u2netp",
    alpha_threshold: int = 16,
    timeout_s: float = 10.0,
) -> Image.Image:
    """Strip solid background with rembg, clean near-transparent edges.

    Wraps rembg execution in a ThreadPoolExecutor with a strict timeout (default 10s).
    If rembg exceeds the timeout or encounters an error, aborts and immediately
    falls back to fast vectorized corner-based chroma-keying.

    Raises ValueError if alpha coverage is outside [0.01, 0.95].
    """
    if img.mode == "RGBA":
        a = np.array(img.getchannel("A"))
        total = a.size
        foreground = int(np.count_nonzero(a))
        coverage = foreground / total
        if 0.01 <= coverage <= 0.95:
            _check_alpha(img)
            return img

    result: Image.Image | None = None

    def _run_rembg() -> Image.Image:
        import rembg  # type: ignore

        session = _get_rembg_session(rembg_model)
        # Pass PIL image directly to eliminate costly PNG compression/decompression overhead
        return rembg.remove(img, session=session).convert("RGBA")

    # Strict timeout execution via ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_run_rembg)
    try:
        result = future.result(timeout=timeout_s)
    except TimeoutError:
        log.warning(
            "rembg background removal timed out after %.1fs; using fast vectorized keying fallback.",
            timeout_s,
        )
        result = _vectorized_chroma_key(img)
    except Exception as exc:
        log.warning("rembg unavailable or failed (%s); using fast vectorized keying fallback.", exc)
        result = _vectorized_chroma_key(img)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    # Alpha threshold clean-up: clamp near-transparent pixels to 0 using fast LUT
    if alpha_threshold > 0:
        lut = [0 if px < alpha_threshold else px for px in range(256)]
        r, g, b, a = result.split()
        mask = a.point(lut)
        result.putalpha(mask)

    _check_alpha(result)
    return result


def _check_alpha(img: Image.Image) -> None:
    """Raise ValueError if alpha coverage is extreme (AC 10.2)."""
    a = np.array(img.getchannel("A"))
    total = a.size
    foreground = int(np.count_nonzero(a))
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
    animations: dict[str, dict[str, Any]] | None = None,
    palette: str = "original",
    outline: bool = False,
) -> dict:
    is_static = (rows == 1 and columns == 1) or frame_count <= 1
    actual_fps = 1 if is_static else fps
    actual_loop = False if is_static else loop
    meta: dict[str, Any] = {
        "schema_version": 1,
        "name": name,
        "image_file": image_file,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "rows": rows,
        "columns": columns,
        "frame_count": frame_count,
        "fps": actual_fps,
        "loop": actual_loop,
        "is_static": is_static,
        "source": {
            "prompt": prompt,
            "style": style,
            "seed": seed,
            "provider": provider_name,
            "model": model,
            "generated_at": generated_at,
            "seed_applied": seed_applied,
            "palette": palette,
            "outline": outline,
        },
    }
    if animations:
        meta["animations"] = animations
    return meta
