# ==============================================================
# SpriteForge — services/providers/mock.py
# Mock / Demo provider for local testing without cloud credentials
# ==============================================================
from __future__ import annotations

import hashlib
import random
from PIL import Image, ImageDraw


class MockProvider:
    name = "mock"
    model = "spriteforge-mock-v1"
    max_side = 512
    supports_negative_prompt = True
    supports_seed = True

    def generate(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        seed: int,
    ) -> Image.Image:
        # Create transparent RGBA image so no external model download is required
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        rng = random.Random(seed if seed is not None else 42)
        h = int(hashlib.md5(prompt.encode("utf-8")).hexdigest(), 16)
        hue_color = (
            (h & 0xFF),
            ((h >> 8) & 0xFF),
            ((h >> 16) & 0xFF),
        )
        if sum(hue_color) < 100:
            hue_color = (220, 100, 80)

        # Draw a character / sprite representation across the sheet
        cols = 4
        rows = 1
        cw = width // cols
        ch = height // rows

        for r in range(rows):
            for c in range(cols):
                cx = c * cw + cw // 2
                cy = r * ch + ch // 2
                frame_idx = r * cols + c

                # Draw head
                draw.ellipse(
                    [cx - cw // 6, cy - ch // 3, cx + cw // 6, cy - ch // 12],
                    fill=(255, 220, 180),
                )
                # Draw body
                draw.rectangle(
                    [cx - cw // 6, cy - ch // 12, cx + cw // 6, cy + ch // 6],
                    fill=hue_color,
                )
                # Walking legs (animated by frame)
                leg_swing = (frame_idx % 2) * 8 - 4
                draw.rectangle(
                    [cx - cw // 8 + leg_swing, cy + ch // 6, cx - 2 + leg_swing, cy + ch // 3],
                    fill=(40, 40, 80),
                )
                draw.rectangle(
                    [cx + 2 - leg_swing, cy + ch // 6, cx + cw // 8 - leg_swing, cy + ch // 3],
                    fill=(40, 40, 80),
                )
                # Face/eyes
                draw.rectangle(
                    [cx + cw // 16, cy - ch // 4, cx + cw // 10, cy - ch // 5],
                    fill=(20, 20, 20),
                )

        return img
