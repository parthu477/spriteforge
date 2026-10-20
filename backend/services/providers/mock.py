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
        prompt_lower = prompt.lower()

        # Parse prompt color keywords
        if any(w in prompt_lower for w in ["red", "crimson", "ruby", "scarlet"]):
            hue_color = (225, 45, 45)
        elif any(w in prompt_lower for w in ["blue", "azure", "navy", "sapphire"]):
            hue_color = (45, 130, 235)
        elif any(w in prompt_lower for w in ["green", "emerald", "lime", "forest"]):
            hue_color = (45, 195, 75)
        elif any(w in prompt_lower for w in ["yellow", "gold", "amber", "lemon"]):
            hue_color = (245, 205, 35)
        elif "orange" in prompt_lower:
            hue_color = (245, 135, 30)
        elif any(w in prompt_lower for w in ["purple", "violet", "magenta"]):
            hue_color = (155, 65, 225)
        elif any(w in prompt_lower for w in ["black", "dark", "shadow", "onyx"]):
            hue_color = (45, 45, 55)
        elif any(w in prompt_lower for w in ["white", "silver", "platinum", "grey", "gray"]):
            hue_color = (215, 220, 230)
        elif "pink" in prompt_lower:
            hue_color = (245, 105, 180)
        elif any(w in prompt_lower for w in ["cyan", "teal", "aqua"]):
            hue_color = (35, 205, 215)
        else:
            h = int(hashlib.md5(prompt.encode("utf-8")).hexdigest(), 16)
            hue_color = ((h & 0xFF), ((h >> 8) & 0xFF), ((h >> 16) & 0xFF))
            if sum(hue_color) < 100:
                hue_color = (220, 100, 80)

        # Detect grid layout from aspect ratio
        ratio = width / max(1, height)
        if ratio >= 7.0:
            cols, rows = 8, 1
        elif ratio >= 5.0:
            cols, rows = 6, 1
        elif ratio >= 3.0:
            cols, rows = 4, 1
        elif ratio >= 1.7:
            cols, rows = 4, 2
        else:
            cols, rows = 4, 4

        cw = width // cols
        ch = height // rows

        is_vehicle = any(w in prompt_lower for w in ["car", "vehicle", "truck", "buggy", "auto", "race", "motor", "f1", "jeep"])
        is_monster = any(w in prompt_lower for w in ["monster", "truck", "heavy", "armored", "4x4", "suv", "jeep"])
        is_sports = any(w in prompt_lower for w in ["sports", "race", "f1", "muscle", "speed", "super", "ferrari", "lamborghini"])
        is_police = any(w in prompt_lower for w in ["police", "cop", "siren"])
        is_spaceship = any(w in prompt_lower for w in ["spaceship", "rocket", "ship", "ufo", "spacecraft", "shuttle", "alien ship"])

        for r in range(rows):
            for c in range(cols):
                cx = c * cw + cw // 2
                cy = r * ch + ch // 2
                frame_idx = c

                if is_vehicle:
                    # Vehicle geometry
                    body_w = int(cw * 0.82)
                    body_h = int(ch * (0.35 if is_monster else (0.24 if is_sports else 0.3)))
                    suspension_bounce = int(math.sin(c / cols * math.pi * 2) * (3 if is_monster else 1.5))
                    car_y = (cy - (ch // 10 if is_monster else (ch // 20 if is_sports else 0))) + suspension_bounce

                    # Lower chassis body
                    draw.rectangle(
                        [cx - body_w // 2, car_y, cx + body_w // 2, car_y + body_h],
                        fill=hue_color,
                    )
                    # Racing stripe for sports car
                    if is_sports:
                        draw.rectangle(
                            [cx - body_w // 2, car_y + body_h // 2 - 2, cx + body_w // 2, car_y + body_h // 2 + 2],
                            fill=(255, 255, 255),
                        )

                    # Cabin / Roof
                    if is_monster:
                        # Truck cab front + open truck bed back
                        draw.polygon(
                            [
                                (cx - body_w // 10, car_y),
                                (cx - body_w // 10, car_y - int(body_h * 0.8)),
                                (cx + body_w // 4, car_y - int(body_h * 0.8)),
                                (cx + body_w // 3, car_y),
                            ],
                            fill=(30, 40, 55),
                        )
                        # Roll cage bars on truck bed
                        draw.line([(cx - body_w // 10, car_y - int(body_h * 0.8)), (cx - body_w // 2 + 4, car_y)], fill=(120, 120, 130), width=3)
                        # Exhaust smoke puff
                        smoke_x = cx - body_w // 2 - 6 - (c * 2)
                        smoke_y = car_y - int(body_h * 0.6) + int(math.sin(c) * 2)
                        draw.ellipse([smoke_x - 3, smoke_y - 3, smoke_x + 3, smoke_y + 3], fill=(160, 160, 170, 180))
                    elif is_sports:
                        # Sleek aerodynamic coupe canopy
                        draw.polygon(
                            [
                                (cx - body_w // 4, car_y),
                                (cx - body_w // 12, car_y - int(body_h * 0.75)),
                                (cx + body_w // 5, car_y - int(body_h * 0.75)),
                                (cx + body_w // 2.5, car_y),
                            ],
                            fill=(25, 30, 45),
                        )
                        # Rear high-mount spoiler
                        draw.line([(cx - body_w // 2, car_y), (cx - body_w // 2, car_y - 12)], fill=(20, 20, 25), width=3)
                        draw.line([(cx - body_w // 2 - 4, car_y - 12), (cx - body_w // 2 + 8, car_y - 12)], fill=hue_color, width=3)
                    else:
                        # Standard sedan / hatchback cabin
                        draw.polygon(
                            [
                                (cx - body_w // 4, car_y),
                                (cx - body_w // 8, car_y - int(body_h * 0.8)),
                                (cx + body_w // 6, car_y - int(body_h * 0.8)),
                                (cx + body_w // 3, car_y),
                            ],
                            fill=(40, 50, 75),
                        )

                    # Windshield glass highlight
                    draw.polygon(
                        [
                            (cx - body_w // 10, car_y - 2),
                            (cx - body_w // 14, car_y - int(body_h * 0.65)),
                            (cx + body_w // 8, car_y - int(body_h * 0.65)),
                            (cx + body_w // 4, car_y - 2),
                        ],
                        fill=(100, 210, 255),
                    )

                    # Police siren
                    if is_police:
                        siren_color = (255, 30, 30) if (c % 2 == 0) else (30, 100, 255)
                        draw.rectangle([cx - 4, car_y - int(body_h * 0.8) - 5, cx + 4, car_y - int(body_h * 0.8)], fill=siren_color)

                    # Headlight / taillight
                    draw.rectangle([cx + body_w // 2 - 4, car_y + 4, cx + body_w // 2, car_y + 10], fill=(255, 240, 90))
                    draw.rectangle([cx - body_w // 2, car_y + 4, cx - body_w // 2 + 4, car_y + 10], fill=(255, 40, 40))

                    # Wheels (two wheels placed at front and rear)
                    wheel_r = max(11 if is_monster else 7, int(body_h * (0.65 if is_monster else 0.45)))
                    w1_x = cx - body_w // 3
                    w2_x = cx + body_w // 3
                    w_y = car_y + body_h + (4 if is_monster else 2)

                    # Outer rubber tires
                    draw.ellipse([w1_x - wheel_r, w_y - wheel_r, w1_x + wheel_r, w_y + wheel_r], fill=(20, 20, 25))
                    draw.ellipse([w2_x - wheel_r, w_y - wheel_r, w2_x + wheel_r, w_y + wheel_r], fill=(20, 20, 25))

                    # Inner rim alloy
                    inner_r = max(3, int(wheel_r * 0.55))
                    draw.ellipse([w1_x - inner_r, w_y - inner_r, w1_x + inner_r, w_y + inner_r], fill=(180, 185, 200))
                    draw.ellipse([w2_x - inner_r, w_y - inner_r, w2_x + inner_r, w_y + inner_r], fill=(180, 185, 200))

                    # Animated spinning rim spokes
                    spin_angle = (c / max(1, cols)) * math.pi * 2
                    for spoke_offset in [0, math.pi / 2, math.pi, math.pi * 1.5]:
                        ang = spoke_offset + spin_angle
                        spoke_len = inner_r * 0.85
                        draw.line([(w1_x, w_y), (int(w1_x + math.cos(ang) * spoke_len), int(w_y + math.sin(ang) * spoke_len))], fill=(60, 60, 75), width=2)
                        draw.line([(w2_x, w_y), (int(w2_x + math.cos(ang) * spoke_len), int(w_y + math.sin(ang) * spoke_len))], fill=(60, 60, 75), width=2)

                    continue

                if is_spaceship:
                    # Spaceship body
                    ship_w = int(cw * 0.75)
                    ship_h = int(ch * 0.3)
                    hover = int(math.sin(c / cols * math.pi * 2) * 3)
                    sy = cy + hover

                    # Rocket thruster fire (animated flickering flame)
                    flame_len = 8 + (c % 3) * 6
                    draw.polygon([(cx - ship_w // 2, sy), (cx - ship_w // 2 - flame_len, sy + ship_h // 2), (cx - ship_w // 2, sy + ship_h)], fill=(255, 120 + (c % 2) * 50, 0))

                    # Main fuselage
                    draw.polygon(
                        [
                            (cx - ship_w // 2, sy + ship_h // 6),
                            (cx + ship_w // 3, sy + ship_h // 6),
                            (cx + ship_w // 2, sy + ship_h // 2),
                            (cx + ship_w // 3, sy + ship_h * 5 // 6),
                            (cx - ship_w // 2, sy + ship_h * 5 // 6),
                        ],
                        fill=hue_color,
                    )
                    # Cockpit dome
                    draw.ellipse([cx, sy + ship_h // 4, cx + ship_w // 3, sy + ship_h * 3 // 4], fill=(80, 220, 255))
                    # Wings
                    draw.polygon([(cx - ship_w // 4, sy + ship_h // 6), (cx - ship_w // 2, sy - 8), (cx, sy + ship_h // 6)], fill=(50, 50, 70))
                    draw.polygon([(cx - ship_w // 4, sy + ship_h * 5 // 6), (cx - ship_w // 2, sy + ship_h + 8), (cx, sy + ship_h * 5 // 6)], fill=(50, 50, 70))
                    continue

                # Row 0: Idle (subtle bob) — but a single-row (non multi-action) sheet
                #         IS the walk cycle, so treat rows==1 as walking too.
                # Row 1: Walk (leg swing)
                # Row 2: Attack (thrust / slash arm)
                # Row 3: Hurt (recoil tilt)
                is_walk_row = (rows == 1) or (r == 1)
                bob = int(math.sin(c / cols * math.pi * 2) * 2) if (r == 0 and not is_walk_row) else 0
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

                # Legs + arms (swing opposite each other for a natural walk/run cycle)
                if is_walk_row:
                    phase = (c / max(1, cols)) * math.pi * 2
                    leg_swing = int(math.sin(phase) * (cw // 10))
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

                # Arms — swing opposite the legs; skip on the attack row (arm is the weapon slash instead)
                if r != 2:
                    arm_swing = -leg_swing if is_walk_row else 0
                    skin = (255, 220, 180) if r != 3 else (255, 180, 180)
                    draw.rectangle(
                        [cx - cw // 5 + arm_swing - recoil, cy - ch // 14 + bob, cx - cw // 9 + arm_swing - recoil, cy + ch // 5 + bob],
                        fill=skin,
                    )
                    draw.rectangle(
                        [cx + cw // 9 - arm_swing - recoil, cy - ch // 14 + bob, cx + cw // 5 - arm_swing - recoil, cy + ch // 5 + bob],
                        fill=skin,
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
