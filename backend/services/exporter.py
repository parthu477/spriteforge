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
    return png_path, json_path


def _atomic_write_image(final: Path, image: Image.Image) -> None:
    tmp = final.parent / f".{final.name}.tmp"
    buf = BytesIO()
    image.save(buf, format="PNG", optimize=False)
    _write_tmp_and_replace(tmp, final, buf.getvalue())


def _atomic_write_json(final: Path, data: dict) -> None:
    tmp = final.parent / f".{final.name}.tmp"
    payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    _write_tmp_and_replace(tmp, final, payload)


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
_SLUG_RE = _re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _check_slug(value: str) -> None:
    if not _SLUG_RE.match(value):
        raise ValueError(f"security: invalid slug/id component: {value!r}")


def delete_sprite(asset_dir: Path, slug: str) -> None:
    """Delete JSON then PNG (US-18 AC 18.3, data-contracts §3)."""
    # Find files matching the slug prefix
    json_files = list(asset_dir.glob(f"{slug}_*.json"))
    png_files = list(asset_dir.glob(f"{slug}_*.png"))
    for jf in json_files:
        jf.unlink(missing_ok=True)
    for pf in png_files:
        pf.unlink(missing_ok=True)
