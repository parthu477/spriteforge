# ==============================================================
# SpriteForge — services/providers/mock.py
# Procedural Mock Provider for local testing & demos without API keys
# ==============================================================
from __future__ import annotations

import math
import random
from PIL import Image, ImageDraw


class MockProvider:
    """Generates procedural pixel-art character sprite sheets for testing."""

    name = "mock"
    model = "procedural-mock-v1"
    max_side = 1024
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
        rng = random.Random(seed)

        # Detect columns and rows from dimensions or default to 4 frames horizontal
        cols = 4
        rows = 1
        if width > 0 and height > 0:
            ratio = width / height
            if ratio >= 3.5:
                cols, rows = 4, 1
            elif ratio >= 1.8:
                cols, rows = 4, 2
            elif ratio >= 0.9:
                cols, rows = 2, 2
            else:
                cols, rows = 1, 4

        fw = width // cols
        fh = height // rows

        # Base character colours based on prompt keywords & seed
        prompt_lower = prompt.lower()
        if "wizard" in prompt_lower or "mage" in prompt_lower:
            cloak_color = (130, 60, 220)
            trim_color = (240, 210, 60)
            char_type = "wizard"
        elif "goblin" in prompt_lower or "orc" in prompt_lower:
            cloak_color = (80, 160, 60)
            trim_color = (160, 100, 40)
            char_type = "goblin"
        elif "skeleton" in prompt_lower or "undead" in prompt_lower:
            cloak_color = (220, 220, 220)
            trim_color = (60, 60, 60)
            char_type = "skeleton"
        elif "dragon" in prompt_lower or "monster" in prompt_lower:
            cloak_color = (200, 50, 50)
            trim_color = (240, 140, 30)
            char_type = "monster"
        else:
            # Default Knight
            cloak_color = (60, 110, 210)
            trim_color = (180, 190, 210)
            char_type = "knight"

        # Create canvas with transparent background
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        total_frames = cols * rows
        for i in range(total_frames):
            col = i % cols
            row = i // cols
            cx = col * fw + fw // 2
            cy = row * fh + fh // 2

            # Walking bobbing motion based on frame
            walk_phase = (i / total_frames) * math.pi * 2
            bob = int(math.sin(walk_phase * 2) * (fh * 0.04))
            leg_swing = int(math.sin(walk_phase) * (fw * 0.12))

            char_h = int(fh * 0.65)
            char_w = int(fw * 0.35)
            top_y = cy - char_h // 2 + bob

            # Body / Cloak
            body_top = top_y + int(char_h * 0.3)
            body_bottom = top_y + int(char_h * 0.75)
            draw.rectangle(
                [cx - char_w // 2, body_top, cx + char_w // 2, body_bottom],
                fill=cloak_color,
                outline=(30, 30, 30),
                width=max(1, fw // 64),
            )

            # Head / Helmet
            head_size = int(char_w * 0.8)
            head_x = cx - head_size // 2
            head_y = top_y
            draw.rectangle(
                [head_x, head_y, head_x + head_size, head_y + head_size],
                fill=trim_color,
                outline=(30, 30, 30),
                width=max(1, fw // 64),
            )

            # Visor / Eyes
            draw.rectangle(
                [head_x + head_size // 4, head_y + head_size // 3,
                 head_x + head_size * 3 // 4, head_y + head_size // 2],
                fill=(20, 20, 20),
            )

            # Left Leg
            leg_w = max(2, char_w // 4)
            leg_y_top = body_bottom
            leg_y_bottom = top_y + char_h
            draw.rectangle(
                [cx - char_w // 2 + leg_swing, leg_y_top,
                 cx - char_w // 2 + leg_w + leg_swing, leg_y_bottom],
                fill=(40, 40, 50),
                outline=(20, 20, 20),
            )

            # Right Leg
            draw.rectangle(
                [cx + char_w // 2 - leg_w - leg_swing, leg_y_top,
                 cx + char_w // 2 - leg_swing, leg_y_bottom],
                fill=(40, 40, 50),
                outline=(20, 20, 20),
            )

            # Weapon / Staff
            sword_x = cx + char_w // 2 + max(2, fw // 32)
            sword_top = top_y + int(char_h * 0.15) - bob
            sword_bottom = body_bottom + int(char_h * 0.1)
            draw.line(
                [(sword_x, sword_top), (sword_x, sword_bottom)],
                fill=(200, 200, 210),
                width=max(2, fw // 48),
            )
            # Crossguard
            draw.line(
                [(sword_x - max(2, fw // 40), sword_top + int(char_h * 0.2)),
                 (sword_x + max(2, fw // 40), sword_top + int(char_h * 0.2))],
                fill=(180, 140, 40),
                width=max(2, fw // 48),
            )

        return img
