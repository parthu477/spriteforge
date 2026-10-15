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

from backend.services.exporter import (
    export_sprite,
    delete_sprite,
    _safe_resolve,
    generate_godot_tres,
    generate_unity_meta,
    generate_gif,
    generate_aseprite_json,
)


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


class TestGameEngineExporters:
    """Unit tests for US-24: 1-Click Game Engine Exporters."""

    def test_ac_24_1_godot_tres_generation(self):
        meta = {
            "name": "warrior_run",
            "image_file": "warrior_run.png",
            "frame_width": 32,
            "frame_height": 32,
            "rows": 1,
            "columns": 4,
            "frame_count": 4,
            "fps": 12,
            "loop": True,
        }
        tres = generate_godot_tres(meta)
        assert '[gd_resource type="SpriteFrames"' in tres
        assert "format=3" in tres
        assert 'res://warrior_run.png' in tres
        assert '"name": &"warrior_run"' in tres
        assert '"speed": 12.0' in tres
        assert '"loop": true' in tres
        # Verify AtlasTexture sub_resources with proper Rect2 regions
        assert "Rect2(0, 0, 32, 32)" in tres
        assert "Rect2(32, 0, 32, 32)" in tres
        assert "Rect2(64, 0, 32, 32)" in tres
        assert "Rect2(96, 0, 32, 32)" in tres

    def test_ac_24_2_unity_meta_generation(self):
        meta = {
            "name": "hero_slash",
            "image_file": "hero_slash.png",
            "frame_width": 64,
            "frame_height": 64,
            "rows": 2,
            "columns": 2,
            "frame_count": 4,
            "fps": 8,
        }
        meta_yaml = generate_unity_meta(meta, image_width=128, image_height=128)
        assert "fileFormatVersion: 2" in meta_yaml
        assert "TextureImporter:" in meta_yaml
        assert "spriteMode: 2" in meta_yaml
        # Point/Pixelated filter mode (AC 24.2)
        assert "filterMode: 0" in meta_yaml
        assert "textureType: 8" in meta_yaml
        assert "hero_slash_0" in meta_yaml
        assert "hero_slash_3" in meta_yaml
        # Verify Unity coordinates (bottom-left origin):
        # Row 0 (top row): y = 128 - (0 + 1) * 64 = 64
        # Row 1 (bottom row): y = 128 - (1 + 1) * 64 = 0
        assert "y: 64" in meta_yaml
        assert "y: 0" in meta_yaml

    def test_ac_24_3_animated_gif_generation(self):
        meta = {
            "name": "slime_idle",
            "image_file": "slime_idle.png",
            "frame_width": 32,
            "frame_height": 32,
            "rows": 1,
            "columns": 2,
            "frame_count": 2,
            "fps": 10,
        }
        sheet = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
        sheet.paste((255, 0, 0, 255), (0, 0, 32, 32))
        sheet.paste((0, 255, 0, 255), (32, 0, 64, 32))

        gif_bytes = generate_gif(sheet, meta)
        assert gif_bytes.startswith(b"GIF89a")
        from io import BytesIO
        with Image.open(BytesIO(gif_bytes)) as gif:
            assert gif.is_animated
            assert gif.n_frames == 2
            assert gif.info.get("loop", 0) == 0

    def test_ac_24_4_aseprite_json_generation(self):
        meta = {
            "name": "mage_cast",
            "image_file": "mage_cast.png",
            "frame_width": 48,
            "frame_height": 48,
            "rows": 1,
            "columns": 3,
            "frame_count": 3,
            "fps": 10,
        }
        ase = generate_aseprite_json(meta, image_width=144, image_height=48)
        assert "frames" in ase
        assert len(ase["frames"]) == 3
        assert ase["frames"][0]["filename"] == "mage_cast_0.png"
        assert ase["frames"][0]["frame"] == {"x": 0, "y": 0, "w": 48, "h": 48}
        assert ase["frames"][1]["frame"] == {"x": 48, "y": 0, "w": 48, "h": 48}
        assert ase["frames"][0]["duration"] == 100

        assert "meta" in ase
        assert ase["meta"]["app"] == "SpriteForge"
        assert ase["meta"]["image"] == "mage_cast.png"
        assert ase["meta"]["format"] == "RGBA8888"
        assert ase["meta"]["size"] == {"w": 144, "h": 48}
        assert ase["meta"]["frameTags"][0]["name"] == "mage_cast"
        assert ase["meta"]["frameTags"][0]["to"] == 2

    def test_export_sprite_creates_and_deletes_companion_formats(self):
        tmpdir = Path(tempfile.mkdtemp())
        meta = _minimal_metadata("test_comp.png")
        meta["fps"] = 8
        png, js = export_sprite(
            asset_dir=tmpdir,
            slug="test_comp",
            short_id="112233",
            image=_small_rgba_image(),
            metadata=meta,
        )
        stem = "test_comp_112233"
        assert (tmpdir / f"{stem}.tres").exists()
        assert (tmpdir / f"{stem}.png.meta").exists()
        assert (tmpdir / f"{stem}.gif").exists()
        assert (tmpdir / f"{stem}_aseprite.json").exists()

        delete_sprite(tmpdir, "test_comp")
        assert not (tmpdir / f"{stem}.tres").exists()
        assert not (tmpdir / f"{stem}.png.meta").exists()
        assert not (tmpdir / f"{stem}.gif").exists()
        assert not (tmpdir / f"{stem}_aseprite.json").exists()

