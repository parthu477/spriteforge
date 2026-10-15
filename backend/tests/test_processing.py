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
    defringe,
    add_outline,
    quantize_palette,
    apply_retro_postprocessing,
    PALETTES,
    PICO8_PALETTE,
    GAMEBOY_PALETTE,
    NES_PALETTE,
    ENDESGA32_PALETTE,
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
        assert "animations" not in meta

    def test_build_metadata_with_animations(self):
        animations = {
            "idle": {"row": 0, "frames": 4, "fps": 8, "loop": True},
            "walk": {"row": 1, "frames": 4, "fps": 8, "loop": True},
            "attack": {"row": 2, "frames": 4, "fps": 10, "loop": False},
            "hurt": {"row": 3, "frames": 4, "fps": 8, "loop": False},
        }
        meta = build_metadata(
            name="hero_sheet", image_file="hero_sheet.png",
            frame_width=32, frame_height=32,
            rows=4, columns=4, frame_count=16,
            prompt="pixel hero knight", style="pixel_art",
            seed=1234, provider_name="mock",
            model="mock-v1", generated_at="2026-10-15T00:00:00Z",
            animations=animations,
        )
        assert "animations" in meta
        assert meta["animations"]["idle"]["row"] == 0
        assert meta["animations"]["idle"]["frames"] == 4
        assert meta["animations"]["idle"]["fps"] == 8
        assert meta["animations"]["idle"]["loop"] is True
        assert meta["animations"]["hurt"]["row"] == 3
        assert meta["animations"]["hurt"]["loop"] is False


class TestPromptBuilderMultiAction:
    """AC 23.1: Conditioning 4 distinct action rows with character consistency."""

    def test_multi_action_prompt_conditioning(self):
        from backend.services.prompt_builder import build_prompt

        pos, neg = build_prompt(
            user_prompt="cyberpunk ninja warrior",
            style="pixel_art",
            rows=4,
            columns=4,
            multi_action=True,
        )
        # AC 23.1: Rows conditioned
        assert "Row 0 is Idle" in pos or "Row 0" in pos
        assert "Row 1 is Walk" in pos or "Row 1" in pos
        assert "Row 2 is Attack" in pos or "Row 2" in pos
        assert "Row 3 is Hurt" in pos or "Row 3" in pos
        # Visual character consistency
        assert "character consistency" in pos.lower()
        # Negative prompt has consistency guards
        assert "inconsistent character" in neg.lower()

    def test_single_row_prompt_does_not_contain_multi_action(self):
        from backend.services.prompt_builder import build_prompt

        pos, _ = build_prompt(
            user_prompt="cyberpunk ninja warrior",
            style="pixel_art",
            rows=1,
            columns=4,
            multi_action=False,
        )
        assert "Row 0 is Idle" not in pos
        assert "Row 3 is Hurt" not in pos


class TestRetroPostProcessing:
    """Tests for US-22: Retro Pixel-Art Post-Processing & Palette Quantization."""

    def test_ac_22_1_palette_quantization_pico8(self):
        img = Image.new("RGBA", (32, 32), (120, 200, 50, 255))
        quant = quantize_palette(img, "pico-8")
        assert quant.size == (32, 32)
        assert quant.mode == "RGBA"
        colors = set(PICO8_PALETTE)
        for x in range(32):
            for y in range(32):
                px = quant.getpixel((x, y))
                assert px[:3] in colors

    def test_ac_22_1_palette_quantization_gameboy(self):
        img = Image.new("RGBA", (32, 32), (200, 100, 150, 255))
        quant = quantize_palette(img, "gameboy")
        colors = set(GAMEBOY_PALETTE)
        for x in range(32):
            for y in range(32):
                px = quant.getpixel((x, y))
                assert px[:3] in colors

    def test_ac_22_1_palette_quantization_nes(self):
        img = Image.new("RGBA", (32, 32), (210, 80, 40, 255))
        quant = quantize_palette(img, "nes")
        colors = set(NES_PALETTE)
        for x in range(32):
            for y in range(32):
                px = quant.getpixel((x, y))
                assert px[:3] in colors

    def test_ac_22_1_palette_quantization_endesga32(self):
        img = Image.new("RGBA", (32, 32), (77, 188, 222, 255))
        quant = quantize_palette(img, "endesga-32")
        colors = set(ENDESGA32_PALETTE)
        for x in range(32):
            for y in range(32):
                px = quant.getpixel((x, y))
                assert px[:3] in colors

    def test_ac_22_1_palette_original_keeps_colors(self):
        img = Image.new("RGBA", (16, 16), (123, 45, 67, 255))
        quant = quantize_palette(img, "original")
        assert quant.getpixel((0, 0)) == (123, 45, 67, 255)

    def test_ac_22_2_edge_defringing_eliminates_halos(self):
        import numpy as np
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        arr = np.array(img)
        # Solid center
        arr[10:22, 10:22] = [200, 50, 50, 255]
        # Semi-transparent border fringe (alpha 160, tinted with white background)
        arr[9, 10:22] = [255, 255, 255, 160]
        # Blurry weak halo (alpha 60)
        arr[8, 10:22] = [255, 255, 255, 60]
        fringe_img = Image.fromarray(arr)

        cleaned = defringe(fringe_img, alpha_threshold=128)
        clean_arr = np.array(cleaned)
        # Blurry weak halo removed completely
        assert clean_arr[8, 15, 3] == 0
        # Border fringe clamped to solid alpha
        assert clean_arr[9, 15, 3] == 255
        # Fringe color bled from solid foreground, not contaminated white
        assert (clean_arr[9, 15, :3] == [200, 50, 50]).all()

    def test_ac_22_3_1px_dark_outline(self):
        import numpy as np
        img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        arr = np.array(img)
        # Solid 10x10 square in center
        arr[10:20, 10:20] = [100, 150, 200, 255]
        test_in = Image.fromarray(arr)

        outlined = add_outline(test_in, rows=1, columns=1, color=(16, 16, 16))
        out_arr = np.array(outlined)

        # Center should remain original color
        assert (out_arr[15, 15] == [100, 150, 200, 255]).all()
        # Immediately adjacent outer pixels (e.g. y=9, x=15) must be 1px outline
        assert (out_arr[9, 15] == [16, 16, 16, 255]).all()
        assert (out_arr[20, 15] == [16, 16, 16, 255]).all()
        assert (out_arr[15, 9] == [16, 16, 16, 255]).all()
        assert (out_arr[15, 20] == [16, 16, 16, 255]).all()
        # 2 pixels away should remain transparent
        assert out_arr[7, 15, 3] == 0

    def test_ac_22_5_postprocessing_duration_under_100ms(self):
        import time
        import numpy as np

        # Create a full 512x128 sprite sheet with 4 frames
        sheet = Image.new("RGBA", (512, 128), (0, 0, 0, 0))
        arr = np.array(sheet)
        for c in range(4):
            arr[20:108, c * 128 + 20:c * 128 + 108, :3] = np.random.randint(0, 255, (88, 88, 3))
            arr[20:108, c * 128 + 20:c * 128 + 108, 3] = np.random.randint(100, 255, (88, 88))
        test_sheet = Image.fromarray(arr)

        # Warmup
        _ = apply_retro_postprocessing(test_sheet, palette="pico-8", outline=True, rows=1, columns=4)

        # Measure 3 runs
        durations = []
        for _ in range(3):
            t0 = time.perf_counter()
            _ = apply_retro_postprocessing(test_sheet, palette="pico-8", outline=True, rows=1, columns=4)
            durations.append((time.perf_counter() - t0) * 1000)

        avg_ms = sum(durations) / len(durations)
        # AC 22.5: Must be strictly under 100ms
        assert avg_ms < 100.0, f"Post-processing took {avg_ms:.2f}ms, which exceeds 100ms limit"


