# ==============================================================
# backend/tests/test_exporter.py
# Tests for services/exporter.py (US-12)
# ==============================================================
import json
import os
import tempfile
from pathlib import Path

import pytest
from PIL import Image

from backend.services.exporter import export_sprite, delete_sprite, _safe_resolve


def _small_rgba_image() -> Image.Image:
    return Image.new("RGBA", (64, 64), (100, 150, 200, 200))


def _minimal_metadata(image_file: str) -> dict:
    return {
        "schema_version": 1,
        "name": "test",
        "image_file": image_file,
        "frame_width": 64,
        "frame_height": 64,
        "rows": 1,
        "columns": 1,
        "frame_count": 1,
    }


class TestAtomicExport:
    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def test_png_and_json_created(self):
        meta = _minimal_metadata("test_aabbcc.png")
        png, js = export_sprite(
            asset_dir=self.tmpdir,
            slug="test",
            short_id="aabbcc",
            image=_small_rgba_image(),
            metadata=meta,
        )
        assert png.exists()
        assert js.exists()

    def test_ac_12_1_json_newer_than_png(self):
        """AC 12.1: JSON mtime >= PNG mtime."""
        meta = _minimal_metadata("test_aabbcc.png")
        png, js = export_sprite(
            asset_dir=self.tmpdir, slug="test", short_id="aabbcc",
            image=_small_rgba_image(), metadata=meta,
        )
        assert js.stat().st_mtime >= png.stat().st_mtime

    def test_ac_12_3_no_tmp_files_remaining(self):
        """AC 12.3: No .*.tmp files left after successful export."""
        meta = _minimal_metadata("test_aabbcc.png")
        export_sprite(
            asset_dir=self.tmpdir, slug="test", short_id="aabbcc",
            image=_small_rgba_image(), metadata=meta,
        )
        tmp_files = list(self.tmpdir.glob(".*.tmp"))
        assert tmp_files == []

    def test_ac_12_4_path_traversal_blocked(self):
        """AC 12.4: slug with ../  raises ValueError."""
        meta = _minimal_metadata("test_aabbcc.png")
        with pytest.raises(ValueError, match="security"):
            export_sprite(
                asset_dir=self.tmpdir, slug="../../system32", short_id="aabbcc",
                image=_small_rgba_image(), metadata=meta,
            )

    def test_json_contains_valid_metadata(self):
        meta = _minimal_metadata("test_aabbcc.png")
        _, js = export_sprite(
            asset_dir=self.tmpdir, slug="test", short_id="aabbcc",
            image=_small_rgba_image(), metadata=meta,
        )
        loaded = json.loads(js.read_text())
        assert loaded["frame_width"] == 64

    def test_safe_resolve_blocks_traversal(self):
        with pytest.raises(ValueError):
            _safe_resolve(self.tmpdir, "../../etc/passwd")

    def test_safe_resolve_allows_valid(self):
        path = _safe_resolve(self.tmpdir, "valid_name.png")
        assert path.parent == self.tmpdir


class TestDeleteSprite:
    def setup_method(self):
        self.tmpdir = Path(tempfile.mkdtemp())

    def test_delete_removes_files(self):
        # Create dummy files
        (self.tmpdir / "mysprite_abc123.json").write_text("{}")
        (self.tmpdir / "mysprite_abc123.png").write_bytes(b"\x89PNG")
        delete_sprite(self.tmpdir, "mysprite")
        assert not (self.tmpdir / "mysprite_abc123.json").exists()
        assert not (self.tmpdir / "mysprite_abc123.png").exists()
