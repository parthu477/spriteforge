# ==============================================================
# SpriteForge — services/providers/mock.py
# Mock / Demo provider for local testing without cloud credentials
# ==============================================================
from __future__ import annotations

import hashlib
import math
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

        # Detect grid layout from aspect ratio
        cols = 4
        if width >= height * 3.5:
            rows = 1
        elif width >= height * 1.8:
            rows = 2
        else:
            rows = 4

        cw = width // cols
        ch = height // rows

        for r in range(rows):
            for c in range(cols):
                cx = c * cw + cw // 2
                cy = r * ch + ch // 2
                frame_idx = c

                # Row 0: Idle (subtle bob)
                # Row 1: Walk (leg swing)
                # Row 2: Attack (thrust / slash arm)
                # Row 3: Hurt (recoil tilt)
                bob = int(math.sin(c / cols * math.pi * 2) * 2) if r == 0 else 0
                recoil = 4 if r == 3 else 0

                # Draw head
                draw.ellipse(
                    [cx - cw // 6 - recoil, cy - ch // 3 + bob, cx + cw // 6 - recoil, cy - ch // 12 + bob],
                    fill=(255, 220, 180) if r != 3 else (255, 180, 180),
                )
                # Draw body
                draw.rectangle(
                    [cx - cw // 6 - recoil, cy - ch // 12 + bob, cx + cw // 6 - recoil, cy + ch // 6 + bob],
                    fill=hue_color,
                )

                # Legs
                if r == 1:
                    # Walk cycle
                    leg_swing = (c % 2) * 8 - 4
                else:
                    leg_swing = 0

                draw.rectangle(
                    [cx - cw // 8 + leg_swing - recoil, cy + ch // 6 + bob, cx - 2 + leg_swing - recoil, cy + ch // 3 + bob],
                    fill=(40, 40, 80),
                )
                draw.rectangle(
                    [cx + 2 - leg_swing - recoil, cy + ch // 6 + bob, cx + cw // 8 - leg_swing - recoil, cy + ch // 3 + bob],
                    fill=(40, 40, 80),
                )

                # Face/eyes
                draw.rectangle(
                    [cx + cw // 16 - recoil, cy - ch // 4 + bob, cx + cw // 10 - recoil, cy - ch // 5 + bob],
                    fill=(20, 20, 20) if r != 3 else (180, 40, 40),
                )

                # Row 2: Attack weapon/slash
                if r == 2:
                    slash_x = cx + cw // 4 + c * 4
                    draw.line(
                        [(cx + cw // 8, cy), (slash_x, cy - ch // 6)],
                        fill=(240, 240, 100),
                        width=3,
                    )

                # Row 3: Hurt sparks
                if r == 3:
                    draw.line([(cx - cw // 4, cy - ch // 4), (cx - cw // 8, cy - ch // 8)], fill=(255, 80, 80), width=2)
                    draw.line([(cx + cw // 8, cy - ch // 4), (cx + cw // 4, cy - ch // 8)], fill=(255, 80, 80), width=2)

        return img
