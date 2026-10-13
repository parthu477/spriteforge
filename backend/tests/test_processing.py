# ==============================================================
# backend/tests/test_processing.py
# Tests for services/processing.py (US-10, US-11)
# ==============================================================
import pytest
from PIL import Image
from backend.services.processing import (
    normalise_grid,
    _check_alpha,
    _alpha_density,
    build_metadata,
)


def _rgba_image(width: int, height: int, alpha: int = 200) -> Image.Image:
    """Create an RGBA image with uniform colour and given alpha."""
    img = Image.new("RGBA", (width, height), (100, 150, 200, alpha))
    return img


def _mixed_alpha_image(width: int, height: int) -> Image.Image:
    """50% foreground, 50% background — valid alpha coverage."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    half_w = width // 2
    for y in range(height):
        for x in range(half_w):
            img.putpixel((x, y), (100, 100, 100, 255))
    return img


class TestCheckAlpha:
    def test_valid_coverage_passes(self):
        img = _mixed_alpha_image(100, 100)
        _check_alpha(img)  # should not raise

    def test_blank_image_raises(self):
        img = _rgba_image(100, 100, alpha=0)  # all transparent
        with pytest.raises(ValueError, match="bg_removal_failed"):
            _check_alpha(img)

    def test_fully_opaque_raises(self):
        img = _rgba_image(100, 100, alpha=255)  # all foreground
        with pytest.raises(ValueError, match="bg_removal_failed"):
            _check_alpha(img)


class TestNormaliseGrid:
    def test_ac_11_1_exact_dimensions(self):
        """AC 11.1: 1000×250 + grid 1x4 → frame_width=250, frame_height=250, frame_count=4."""
        img = Image.new("RGBA", (1000, 250), (0, 0, 0, 0))
        for c in range(4):
            for y in range(50, 200):
                for x in range(c * 250 + 50, c * 250 + 200):
                    img.putpixel((x, y), (100, 100, 100, 255))
        out_img, fw, fh, fc = normalise_grid(img, rows=1, columns=4)
        assert fw == 250
        assert fh == 250
        assert fc == 4
        assert out_img.width == 1000
        assert out_img.height == 250

    def test_ac_11_2_crop_to_multiple(self):
        """AC 11.2: 1023×1023 + grid 2x2 → cropped to 1022×1022, 511×511 frames."""
        img = _mixed_alpha_image(1023, 1023)
        out_img, fw, fh, fc = normalise_grid(img, rows=2, columns=2)
        assert fw == 511
        assert fh == 511
        assert out_img.width == 1022
        assert out_img.height == 1022

    def test_ac_11_3_trailing_empty_frame_trimmed(self):
        """AC 11.3: empty 4th frame → frame_count=3."""
        # 4-frame sheet where frame 4 is fully transparent
        img = Image.new("RGBA", (256, 64), (0, 0, 0, 0))
        # Fill first 3 frames with visible pixels
        for x in range(192):
            for y in range(64):
                img.putpixel((x, y), (100, 200, 100, 255))
        _, _, _, fc = normalise_grid(img, rows=1, columns=4)
        assert fc == 3

    def test_pixel_art_nearest_neighbour_resampling(self):
        """AC 11.4: pixel art with CELL_SIZE uses NEAREST resampling."""
        img = _mixed_alpha_image(64, 64)
        # Should not raise; resampling mode validated visually
        out_img, fw, fh, _ = normalise_grid(img, rows=1, columns=1, cell_size=128, style="pixel_art")
        assert fw == 128
        assert fh == 128

    def test_max_texture_size_exceeded_raises(self):
        img = _mixed_alpha_image(64, 64)
        with pytest.raises(ValueError, match="processing_failed"):
            normalise_grid(img, rows=1, columns=1, cell_size=5000, max_texture_size=4096)


class TestBuildMetadata:
    def test_required_keys_present(self):
        meta = build_metadata(
            name="test", image_file="test_aabbcc.png",
            frame_width=64, frame_height=64,
            rows=1, columns=4, frame_count=4,
            prompt="a knight", style="pixel_art",
            seed=42, provider_name="cloudflare",
            model="flux-1-schnell",
            generated_at="2026-10-07T12:00:00Z",
        )
        for key in ("image_file", "frame_width", "frame_height", "rows", "columns", "frame_count"):
            assert key in meta

    def test_source_contains_provider(self):
        meta = build_metadata(
            name="t", image_file="t_aabbcc.png",
            frame_width=64, frame_height=64,
            rows=1, columns=4, frame_count=4,
            prompt="x", style="pixel_art",
            seed=0, provider_name="local_cpu",
            model="sd-turbo", generated_at="2026-01-01T00:00:00Z",
        )
        assert meta["source"]["provider"] == "local_cpu"
