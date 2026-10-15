# ==============================================================
# SpriteForge — services/exporter.py
# US-12: Atomic File Export with PNG-Before-JSON Sequencing
# ==============================================================
"""Write sprite assets atomically:
  1. Write .png.tmp → fsync → os.replace (→ .png)
  2. Write .json.tmp → fsync → os.replace (→ .json)
  If step 2 fails, the orphan .png is deleted immediately.
  Path traversal is blocked before any write.
"""
from __future__ import annotations

import json
import logging
import os
from io import BytesIO
from pathlib import Path

import jsonschema
from PIL import Image

log = logging.getLogger(__name__)

_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "shared" / "sprite.schema.json"
)

try:
    import json as _json
    with open(_SCHEMA_PATH, encoding="utf-8") as _f:
        _SPRITE_SCHEMA = _json.load(_f)
except FileNotFoundError:
    _SPRITE_SCHEMA = None
    log.warning("shared/sprite.schema.json not found — skipping schema validation on export.")


def export_sprite(
    *,
    asset_dir: Path,
    slug: str,
    short_id: str,
    image: Image.Image,
    metadata: dict,
) -> tuple[Path, Path]:
    """Write PNG then JSON atomically.  Returns (png_path, json_path).

    Raises:
        ValueError: on path traversal attempt.
        OSError: on disk write failure (with rollback).
    """
    _check_slug(slug)
    _check_slug(short_id)

    stem = f"{slug}_{short_id}"
    png_path = _safe_resolve(asset_dir, f"{stem}.png")
    json_path = _safe_resolve(asset_dir, f"{stem}.json")

    # Validate metadata against schema before writing
    if _SPRITE_SCHEMA is not None:
        try:
            jsonschema.validate(instance=metadata, schema=_SPRITE_SCHEMA)
        except jsonschema.ValidationError as exc:
            raise ValueError(f"Metadata schema validation failed: {exc.message}") from exc

    # ── Step 1: Write PNG atomically ──────────────────────────
    _atomic_write_image(png_path, image)
    log.info("Exported PNG: %s", png_path.name)

    # ── Step 2: Write JSON atomically (rollback PNG on failure)
    try:
        _atomic_write_json(json_path, metadata)
    except Exception:
        # Rollback: remove the already-written PNG (AC 12.2)
        try:
            png_path.unlink(missing_ok=True)
            log.warning("JSON write failed; rolled back orphan PNG: %s", png_path.name)
        except OSError:
            pass
        raise

    log.info("Exported JSON: %s", json_path.name, extra={"job_id": short_id})

    # ── Step 3: Write companion game engine formats (US-24) ────
    try:
        # Godot 4 .tres (AC 24.1)
        tres_path = _safe_resolve(asset_dir, f"{stem}.tres")
        tres_content = generate_godot_tres(metadata)
        _atomic_write_text(tres_path, tres_content)

        # Unity .meta (AC 24.2)
        meta_path = _safe_resolve(asset_dir, f"{stem}.png.meta")
        unity_content = generate_unity_meta(metadata, image.width, image.height)
        _atomic_write_text(meta_path, unity_content)

        # Animated GIF (AC 24.3)
        gif_path = _safe_resolve(asset_dir, f"{stem}.gif")
        gif_bytes = generate_gif(image, metadata)
        _write_tmp_and_replace(asset_dir / f".{stem}.gif.tmp", gif_path, gif_bytes)

        # Aseprite JSON (AC 24.4)
        aseprite_path = _safe_resolve(asset_dir, f"{stem}_aseprite.json")
        aseprite_dict = generate_aseprite_json(metadata, image.width, image.height)
        _atomic_write_json(aseprite_path, aseprite_dict)
    except Exception as exc:
        log.warning("Non-fatal error writing game engine companion formats: %s", exc)

    return png_path, json_path


# ── AC 24.1: Godot 4 Exporter ─────────────────────────────────

def generate_godot_tres(metadata: dict) -> str:
    """Generate Godot 4 .tres (SpriteFrames) resource with pre-configured animation tracks, frames, and FPS."""
    name = metadata.get("name", "sprite")
    image_file = metadata.get("image_file", f"{name}.png")
    fw = int(metadata.get("frame_width", 128))
    fh = int(metadata.get("frame_height", 128))
    cols = int(metadata.get("columns", 4))
    frame_count = int(metadata.get("frame_count", 4))
    fps = float(metadata.get("fps", 8))
    loop = "true" if metadata.get("loop", True) else "false"

    load_steps = frame_count + 2
    sub_resources = []
    anim_frames = []

    for i in range(frame_count):
        col = i % cols
        row = i // cols
        x = col * fw
        y = row * fh
        sub_resources.append(
            f'[sub_resource type="AtlasTexture" id="AtlasTexture_{i}"]\n'
            f'atlas = ExtResource("1_tex")\n'
            f'region = Rect2({x}, {y}, {fw}, {fh})\n'
        )
        anim_frames.append(
            f'{{\n"duration": 1.0,\n"texture": SubResource("AtlasTexture_{i}")\n}}'
        )

    sub_res_block = "\n".join(sub_resources)
    frames_block = ", ".join(anim_frames)

    return (
        f'[gd_resource type="SpriteFrames" load_steps={load_steps} format=3]\n\n'
        f'[ext_resource type="Texture2D" path="res://{image_file}" id="1_tex"]\n\n'
        f'{sub_res_block}\n'
        f'[resource]\n'
        f'animations = [{{\n'
        f'"frames": [{frames_block}],\n'
        f'"loop": {loop},\n'
        f'"name": &"{name}",\n'
        f'"speed": {fps:.1f}\n'
        f'}}]\n'
    )


# ── AC 24.2: Unity Exporter ───────────────────────────────────

def generate_unity_meta(
    metadata: dict,
    image_width: int | None = None,
    image_height: int | None = None,
) -> str:
    """Generate sliced spritesheet .meta YAML with exact cell rects and Point/Pixelated filter mode."""
    import hashlib
    name = metadata.get("name", "sprite")
    image_file = metadata.get("image_file", f"{name}.png")
    fw = int(metadata.get("frame_width", 128))
    fh = int(metadata.get("frame_height", 128))
    cols = int(metadata.get("columns", 4))
    rows = int(metadata.get("rows", 1))
    frame_count = int(metadata.get("frame_count", cols * rows))

    sheet_w = image_width if image_width else cols * fw
    sheet_h = image_height if image_height else rows * fh

    guid = hashlib.md5(f"{name}_{image_file}".encode()).hexdigest()
    sprites = []

    for i in range(frame_count):
        col = i % cols
        row = i // cols
        x = col * fw
        # In Unity texture coordinates, (0, 0) is bottom-left corner
        y = sheet_h - (row + 1) * fh
        sprite_id = hashlib.md5(f"{name}_{i}".encode()).hexdigest()
        internal_id = 10000000 + i * 2

        sprites.append(
            f"      - serializedVersion: 2\n"
            f"        name: {name}_{i}\n"
            f"        rect:\n"
            f"          serializedVersion: 2\n"
            f"          x: {x}\n"
            f"          y: {y}\n"
            f"          width: {fw}\n"
            f"          height: {fh}\n"
            f"        alignment: 0\n"
            f"        pivot: {{x: 0.5, y: 0.5}}\n"
            f"        border: {{x: 0, y: 0, z: 0, w: 0}}\n"
            f"        outline: []\n"
            f"        physicsShape: []\n"
            f"        tessellationDetail: 0\n"
            f"        bones: []\n"
            f"        spriteID: {sprite_id}\n"
            f"        internalID: {internal_id}\n"
            f"        vertices: []\n"
            f"        indices: \n"
            f"        edges: []\n"
            f"        weights: []"
        )

    sprites_yaml = "\n".join(sprites)

    return (
        f"fileFormatVersion: 2\n"
        f"guid: {guid}\n"
        f"TextureImporter:\n"
        f"  internalIDToNameTable: []\n"
        f"  externalObjects: {{}}\n"
        f"  serializedVersion: 12\n"
        f"  mipmaps:\n"
        f"    mipMapMode: 0\n"
        f"    enableMipMap: 0\n"
        f"    linearTexture: 0\n"
        f"    correctGamma: 0\n"
        f"    fadeOut: 0\n"
        f"    borderMipMap: 0\n"
        f"    mipMapsPreserveCoverage: 0\n"
        f"    alphaTestReferenceValue: 0.5\n"
        f"    mipMapFadeDistanceStart: 1\n"
        f"    mipMapFadeDistanceEnd: 3\n"
        f"  bumpmap:\n"
        f"    convertToNormalMap: 0\n"
        f"    externalNormalMap: 0\n"
        f"    heightScale: 0.25\n"
        f"    normalMapFilter: 0\n"
        f"  isReadable: 0\n"
        f"  streamingMipmaps: 0\n"
        f"  streamingMipmapsPriority: 0\n"
        f"  vTOnly: 0\n"
        f"  ignoreMasterTextureLimit: 0\n"
        f"  grayScaleToAlpha: 0\n"
        f"  generateCubemap: 6\n"
        f"  cubemapConvolution: 0\n"
        f"  seamlessCubemap: 0\n"
        f"  textureFormat: 1\n"
        f"  maxTextureSize: 2048\n"
        f"  textureSettings:\n"
        f"    serializedVersion: 2\n"
        f"    filterMode: 0\n"
        f"    aniso: 1\n"
        f"    mipBias: 0\n"
        f"    wrapU: 1\n"
        f"    wrapV: 1\n"
        f"    wrapW: 1\n"
        f"  nPOTScale: 0\n"
        f"  lightmap: 0\n"
        f"  compressionQuality: 50\n"
        f"  spriteMode: 2\n"
        f"  spriteExtrude: 1\n"
        f"  spriteMeshType: 0\n"
        f"  alignment: 0\n"
        f"  spritePivot: {{x: 0.5, y: 0.5}}\n"
        f"  spritePixelsToUnits: 100\n"
        f"  spriteBorder: {{x: 0, y: 0, z: 0, w: 0}}\n"
        f"  spriteGenerateFallbackPhysicsShape: 1\n"
        f"  alphaUsage: 1\n"
        f"  alphaIsTransparency: 1\n"
        f"  spriteTessellationDetail: -1\n"
        f"  textureType: 8\n"
        f"  textureShape: 1\n"
        f"  singleChannelComponent: 0\n"
        f"  flipbook: 0\n"
        f"  ignorePngGamma: 0\n"
        f"  spriteSheet:\n"
        f"    serializedVersion: 2\n"
        f"    sprites:\n"
        f"{sprites_yaml}\n"
        f"    outline: []\n"
        f"    physicsShape: []\n"
        f"    bones: []\n"
        f"    spriteID: \n"
        f"    internalID: 0\n"
        f"    vertices: []\n"
        f"    indices: \n"
        f"    edges: []\n"
        f"    weights: []\n"
    )


# ── AC 24.3: Animated GIF Exporter ────────────────────────────

def generate_gif(image: Image.Image, metadata: dict) -> bytes:
    """Compile sliced frames into a looping, background-transparent .gif image at target FPS."""
    fw = int(metadata.get("frame_width", 128))
    fh = int(metadata.get("frame_height", 128))
    cols = int(metadata.get("columns", 4))
    frame_count = int(metadata.get("frame_count", 4))
    fps = max(1, int(metadata.get("fps", 8)))
    duration_ms = max(20, int(1000 / fps))

    # Slice frames
    frames = []
    for i in range(frame_count):
        col = i % cols
        row = i // cols
        box = (col * fw, row * fh, (col + 1) * fw, (row + 1) * fh)
        frame_img = image.crop(box)
        frames.append(frame_img)

    if not frames:
        frames = [image]

    gif_frames = []
    for f in frames:
        if f.mode != "RGBA":
            f = f.convert("RGBA")
        alpha = f.getchannel("A")
        # Palette mode with reserved transparent index 255
        p_frame = f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        # Transparent mask
        mask = Image.eval(alpha, lambda a: 255 if a <= 128 else 0)
        p_frame.paste(255, mask)
        p_frame.info["transparency"] = 255
        p_frame.info["duration"] = duration_ms
        p_frame.info["disposal"] = 2
        gif_frames.append(p_frame)

    buf = BytesIO()
    gif_frames[0].save(
        buf,
        format="GIF",
        save_all=True,
        append_images=gif_frames[1:],
        duration=duration_ms,
        loop=0,
        transparency=255,
        disposal=2,
    )
    return buf.getvalue()


# ── AC 24.4: Aseprite JSON Exporter ───────────────────────────

def generate_aseprite_json(
    metadata: dict,
    image_width: int | None = None,
    image_height: int | None = None,
) -> dict:
    """Output industry-standard Aseprite JSON spritesheet metadata."""
    name = metadata.get("name", "sprite")
    image_file = metadata.get("image_file", f"{name}.png")
    fw = int(metadata.get("frame_width", 128))
    fh = int(metadata.get("frame_height", 128))
    cols = int(metadata.get("columns", 4))
    rows = int(metadata.get("rows", 1))
    frame_count = int(metadata.get("frame_count", cols * rows))
    fps = max(1, int(metadata.get("fps", 8)))
    duration_ms = max(20, int(1000 / fps))

    sheet_w = image_width if image_width else cols * fw
    sheet_h = image_height if image_height else rows * fh

    frames = []
    for i in range(frame_count):
        col = i % cols
        row = i // cols
        x = col * fw
        y = row * fh
        frames.append({
            "filename": f"{name}_{i}.png",
            "frame": {"x": x, "y": y, "w": fw, "h": fh},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": fw, "h": fh},
            "sourceSize": {"w": fw, "h": fh},
            "duration": duration_ms,
        })

    return {
        "frames": frames,
        "meta": {
            "app": "SpriteForge",
            "version": "1.0",
            "image": image_file,
            "format": "RGBA8888",
            "size": {"w": sheet_w, "h": sheet_h},
            "scale": "1",
            "frameTags": [
                {
                    "name": name,
                    "from": 0,
                    "to": max(0, frame_count - 1),
                    "direction": "forward",
                }
            ],
            "layers": [
                {
                    "name": "Layer 1",
                    "opacity": 255,
                    "blendMode": "normal",
                }
            ],
        },
    }


def _atomic_write_image(final: Path, image: Image.Image) -> None:
    tmp = final.parent / f".{final.name}.tmp"
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=False)
    _write_tmp_and_replace(tmp, final, buf.getvalue())


def _atomic_write_json(final: Path, data: dict) -> None:
    tmp = final.parent / f".{final.name}.tmp"
    payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    _write_tmp_and_replace(tmp, final, payload)


def _atomic_write_text(final: Path, text: str) -> None:
    tmp = final.parent / f".{final.name}.tmp"
    _write_tmp_and_replace(tmp, final, text.encode("utf-8"))


def _write_tmp_and_replace(tmp: Path, final: Path, data: bytes) -> None:
    """Write *data* to *tmp*, fsync, then atomically replace *final* (AC 12.1, 12.3)."""
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, final)


def _safe_resolve(asset_dir: Path, filename: str) -> Path:
    """Reject path traversal attempts (AC 12.4)."""
    resolved = (asset_dir / filename).resolve()
    try:
        resolved.relative_to(asset_dir.resolve())
    except ValueError:
        raise ValueError(
            f"security: path '{filename}' resolves outside ASSET_DIR."
        )
    return resolved


import re as _re
_SLUG_RE = _re.compile(r"^[a-z0-9][a-z0-9_.-]{0,70}$")


def _check_slug(value: str) -> None:
    if not _SLUG_RE.match(value):
        raise ValueError(f"security: invalid slug/id component: {value!r}")


def delete_sprite(asset_dir: Path, slug: str) -> None:
    """Delete all files associated with this sprite slug."""
    for pattern in (
        f"{slug}_*.json",
        f"{slug}_*.png",
        f"{slug}_*.tres",
        f"{slug}_*.meta",
        f"{slug}_*.gif",
        f"{slug}.json",
        f"{slug}.png",
        f"{slug}.tres",
        f"{slug}.png.meta",
        f"{slug}.gif",
    ):
        for f in asset_dir.glob(pattern):
            f.unlink(missing_ok=True)

