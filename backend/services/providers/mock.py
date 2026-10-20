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

        is_bike = any(w in prompt_lower for w in [
            "bike", "bicycle", "dirt bike", "motocross", "moto", 
            "motorcycle", "chopper", "scooter", "bmx", "cyclist", "rider"
        ])
        is_vehicle = not is_bike and any(w in prompt_lower for w in ["car", "vehicle", "truck", "buggy", "auto", "race", "motor", "f1", "jeep"])
        is_monster = any(w in prompt_lower for w in ["monster", "truck", "heavy", "armored", "4x4", "suv", "jeep"])
        is_sports = any(w in prompt_lower for w in ["sports", "race", "f1", "muscle", "speed", "super", "ferrari", "lamborghini"])
        is_police = any(w in prompt_lower for w in ["police", "cop", "siren"])
        is_spaceship = any(w in prompt_lower for w in ["spaceship", "rocket", "ship", "ufo", "spacecraft", "shuttle", "alien ship"])

        for r in range(rows):
            for c in range(cols):
                cx = c * cw + cw // 2
                cy = r * ch + ch // 2
                frame_idx = c
                scale = min(cw, ch) / 95.0

                if is_bike:
                    # Subtle engine & suspension vibration
                    bounce = int(math.sin(c / cols * math.pi * 2) * (1.8 * scale))
                    wheelie = -1 if c == 2 else 0  # subtle dynamic action on frame 2
                    bike_y = cy + int(4 * scale) + bounce
                    
                    # --- WHEELS ---
                    wr = int(14.5 * scale)
                    w1_x = cx - int(24 * scale)  # Rear wheel
                    w2_x = cx + int(24 * scale)  # Front wheel
                    w1_y = cy + int(19 * scale)
                    w2_y = cy + int(19 * scale) + wheelie

                    for (wx, wy, is_front) in [(w1_x, w1_y, False), (w2_x, w2_y, True)]:
                        # Outer knobby tire (black rubber)
                        draw.ellipse([wx - wr, wy - wr, wx + wr, wy + wr], fill=(25, 26, 30), outline=(15, 15, 18), width=2)
                        
                        # Motocross knobby tire treads
                        tread_step = math.pi / 6
                        spin = (c / max(1, cols)) * math.pi * 2
                        for i in range(12):
                            ang = spin + i * tread_step
                            tx1 = wx + math.cos(ang) * (wr - 1)
                            ty1 = wy + math.sin(ang) * (wr - 1)
                            tx2 = wx + math.cos(ang) * (wr + 2 * scale)
                            ty2 = wy + math.sin(ang) * (wr + 2 * scale)
                            draw.line([(int(tx1), int(ty1)), (int(tx2), int(ty2))], fill=(15, 15, 18), width=int(max(1, 2 * scale)))

                        # Inner rim
                        rim_r = int(wr * 0.65)
                        draw.ellipse([wx - rim_r, wy - rim_r, wx + rim_r, wy + rim_r], fill=(195, 200, 210), outline=(120, 125, 135), width=1)
                        
                        # Central hub
                        hub_r = int(wr * 0.28)
                        draw.ellipse([wx - hub_r, wy - hub_r, wx + hub_r, wy + hub_r], fill=(50, 55, 65))
                        
                        # Wire spokes
                        for a_off in [0, math.pi/4, math.pi/2, 3*math.pi/4]:
                            ang = spin + a_off
                            sx1 = wx + math.cos(ang) * (rim_r - 1)
                            sy1 = wy + math.sin(ang) * (rim_r - 1)
                            sx2 = wx - math.cos(ang) * (rim_r - 1)
                            sy2 = wy - math.sin(ang) * (rim_r - 1)
                            draw.line([(int(sx1), int(sy1)), (int(sx2), int(sy2))], fill=(80, 85, 95), width=1)

                    # --- REAR SWINGARM & DRIVE CHAIN ---
                    engine_x = cx - int(1 * scale)
                    engine_y = bike_y + int(11 * scale)
                    # Swingarm
                    draw.line([(w1_x, w1_y), (engine_x - int(5 * scale), engine_y + int(2 * scale))], fill=(160, 165, 175), width=int(max(2, 3 * scale)))
                    # Rear shock absorber / spring
                    draw.line([(w1_x + int(8 * scale), w1_y - int(3 * scale)), (engine_x - int(2 * scale), bike_y + int(1 * scale))], fill=(240, 200, 30), width=int(max(2, 3 * scale)))

                    # --- FRONT FORKS (Telescopic suspension) ---
                    head_x = cx + int(15 * scale)
                    head_y = bike_y - int(4 * scale) + wheelie
                    # Stanchions (gold/silver dual suspension tubes)
                    draw.line([(w2_x, w2_y), (head_x, head_y)], fill=(210, 175, 45), width=int(max(2, 3.5 * scale)))
                    draw.line([(w2_x - int(2 * scale), w2_y), (head_x - int(2 * scale), head_y)], fill=(55, 60, 70), width=int(max(1, 2 * scale)))

                    # --- ENGINE BLOCK & EXHAUST ---
                    # Engine crankcase
                    draw.rounded_rectangle([engine_x - int(8 * scale), engine_y - int(5 * scale), engine_x + int(7 * scale), engine_y + int(7 * scale)], radius=int(3 * scale), fill=(55, 60, 70), outline=(30, 32, 38))
                    # Cylinder cooling fins
                    for fin in range(3):
                        fy = engine_y - int((3 - fin * 3) * scale)
                        draw.line([(engine_x - int(6 * scale), fy), (engine_x + int(5 * scale), fy)], fill=(90, 95, 105), width=1)
                    
                    # Exhaust pipe sweeping back into high-mount muffler
                    draw.line([(engine_x + int(4 * scale), engine_y), (engine_x - int(4 * scale), engine_y + int(5 * scale)), (w1_x + int(6 * scale), bike_y + int(2 * scale))], fill=(180, 185, 195), width=int(max(1, 2.5 * scale)))
                    # High-mount muffler under rear fender
                    draw.rounded_rectangle([w1_x - int(4 * scale), bike_y - int(1 * scale), w1_x + int(10 * scale), bike_y + int(4 * scale)], radius=int(2 * scale), fill=(100, 105, 115), outline=(50, 55, 65))
                    
                    # Animated exhaust puff
                    if c % 2 == 0:
                        ex_x = w1_x - int(8 * scale) - (c * 2)
                        ex_y = bike_y + int(1 * scale)
                        draw.ellipse([ex_x - int(3 * scale), ex_y - int(2 * scale), ex_x + int(3 * scale), ex_y + int(2 * scale)], fill=(210, 215, 225, 160))

                    # --- DIRT BIKE BODYWORK / FAIRINGS ---
                    # Main gas tank & radiator shrouds in hue_color (Red)
                    tank_poly = [
                        (head_x - int(3 * scale), head_y + int(1 * scale)),
                        (head_x + int(2 * scale), head_y + int(3 * scale)),
                        (cx + int(5 * scale), bike_y + int(8 * scale)),
                        (cx - int(7 * scale), bike_y + int(7 * scale)),
                        (cx - int(5 * scale), bike_y - int(2 * scale)),
                    ]
                    draw.polygon(tank_poly, fill=hue_color, outline=(140, 20, 20))
                    
                    # Racing decal/graphics on shroud
                    draw.polygon([
                        (cx - int(1 * scale), bike_y + int(2 * scale)),
                        (cx + int(4 * scale), bike_y + int(3 * scale)),
                        (cx + int(1 * scale), bike_y + int(7 * scale)),
                    ], fill=(255, 255, 255))

                    # High front motocross fender / beak
                    front_fender = [
                        (head_x, head_y + int(2 * scale)),
                        (head_x + int(15 * scale), head_y - int(1 * scale) + wheelie),
                        (head_x + int(16 * scale), head_y + int(2 * scale) + wheelie),
                        (head_x + int(2 * scale), head_y + int(6 * scale)),
                    ]
                    draw.polygon(front_fender, fill=hue_color, outline=(140, 20, 20))

                    # High upswept rear motocross fender
                    rear_fender = [
                        (cx - int(4 * scale), bike_y - int(2 * scale)),
                        (w1_x - int(10 * scale), bike_y - int(5 * scale)),
                        (w1_x - int(8 * scale), bike_y - int(1 * scale)),
                        (cx - int(7 * scale), bike_y + int(4 * scale)),
                    ]
                    draw.polygon(rear_fender, fill=hue_color, outline=(140, 20, 20))

                    # Dirt bike seat (long, contoured black saddle)
                    seat_poly = [
                        (cx - int(14 * scale), bike_y - int(3 * scale)),
                        (cx + int(3 * scale), bike_y - int(4 * scale)),
                        (cx + int(2 * scale), bike_y - int(1 * scale)),
                        (cx - int(12 * scale), bike_y + int(0 * scale)),
                    ]
                    draw.polygon(seat_poly, fill=(28, 30, 35), outline=(15, 15, 18))

                    # Handlebars & crossbar
                    bar_top_x = head_x - int(1 * scale)
                    bar_top_y = head_y - int(7 * scale) + wheelie
                    draw.line([(head_x, head_y), (bar_top_x, bar_top_y)], fill=(70, 75, 85), width=int(max(1, 2.5 * scale)))
                    draw.line([(bar_top_x - int(5 * scale), bar_top_y - int(2 * scale)), (bar_top_x + int(3 * scale), bar_top_y - int(1 * scale))], fill=(40, 42, 48), width=int(max(2, 3 * scale)))

                    # --- BOY / RIDER ---
                    # 1. Footpeg & Boot (Motocross riding boot)
                    foot_x = engine_x - int(2 * scale)
                    foot_y = engine_y + int(7 * scale)
                    # Footpeg
                    draw.line([(foot_x - int(3 * scale), foot_y), (foot_x + int(3 * scale), foot_y)], fill=(180, 185, 195), width=2)
                    # Boot (angled on peg)
                    boot_poly = [
                        (foot_x - int(3 * scale), foot_y - int(5 * scale)),
                        (foot_x + int(3 * scale), foot_y - int(4 * scale)),
                        (foot_x + int(6 * scale), foot_y),
                        (foot_x - int(4 * scale), foot_y),
                    ]
                    draw.polygon(boot_poly, fill=(30, 32, 38), outline=(220, 225, 235))
                    
                    # 2. Leg (Riding pants with knee flexed forward)
                    knee_x = cx + int(3 * scale)
                    knee_y = bike_y + int(4 * scale)
                    hip_x = cx - int(7 * scale)
                    hip_y = bike_y - int(3 * scale)
                    # Thigh & Shin
                    draw.line([(hip_x, hip_y), (knee_x, knee_y)], fill=(40, 48, 65), width=int(max(3, 5.5 * scale)))
                    draw.line([(knee_x, knee_y), (foot_x, foot_y - int(2 * scale))], fill=(35, 42, 58), width=int(max(3, 5 * scale)))
                    # Knee guard
                    draw.ellipse([knee_x - int(2.5 * scale), knee_y - int(2.5 * scale), knee_x + int(2.5 * scale), knee_y + int(2.5 * scale)], fill=(20, 22, 28))

                    # 3. Torso / Rider Jacket (Leaning forward into the ride)
                    shoulder_x = cx + int(1 * scale)
                    shoulder_y = bike_y - int(17 * scale)
                    torso_poly = [
                        (hip_x - int(2 * scale), hip_y),
                        (hip_x + int(4 * scale), hip_y),
                        (shoulder_x + int(4 * scale), shoulder_y),
                        (shoulder_x - int(4 * scale), shoulder_y),
                    ]
                    # Rider jacket
                    draw.polygon(torso_poly, fill=hue_color, outline=(130, 15, 15))
                    # Jacket racing stripes
                    draw.line([(hip_x + int(1 * scale), hip_y), (shoulder_x, shoulder_y)], fill=(255, 255, 255), width=int(max(1, 2 * scale)))

                    # 4. Arm reaching forward to handlebars
                    hand_x = bar_top_x - int(1 * scale)
                    hand_y = bar_top_y - int(1 * scale)
                    elbow_x = cx + int(4 * scale)
                    elbow_y = bike_y - int(10 * scale)
                    draw.line([(shoulder_x + int(1 * scale), shoulder_y + int(2 * scale)), (elbow_x, elbow_y)], fill=(195, 25, 25), width=int(max(2, 3.5 * scale)))
                    draw.line([(elbow_x, elbow_y), (hand_x, hand_y)], fill=(195, 25, 25), width=int(max(2, 3 * scale)))
                    # Glove on handlebar grip
                    draw.ellipse([hand_x - int(2 * scale), hand_y - int(2 * scale), hand_x + int(2 * scale), hand_y + int(2 * scale)], fill=(30, 32, 38))

                    # 5. Head & Motocross Helmet
                    neck_x = shoulder_x + int(1 * scale)
                    neck_y = shoulder_y - int(2 * scale)
                    draw.rectangle([neck_x - int(2 * scale), neck_y - int(3 * scale), neck_x + int(2 * scale), neck_y], fill=(230, 190, 160))
                    
                    helmet_cx = shoulder_x + int(2 * scale)
                    helmet_cy = shoulder_y - int(8 * scale)
                    hr = int(7.5 * scale)
                    
                    # Helmet shell (motocross helmet matching hue_color)
                    draw.ellipse([helmet_cx - hr, helmet_cy - hr, helmet_cx + hr, helmet_cy + hr], fill=hue_color, outline=(120, 15, 15))
                    
                    # Motocross helmet visor / peak extending forward
                    visor_poly = [
                        (helmet_cx - int(1 * scale), helmet_cy - hr + int(1 * scale)),
                        (helmet_cx + hr + int(6 * scale), helmet_cy - hr - int(2 * scale)),
                        (helmet_cx + hr + int(5 * scale), helmet_cy - hr + int(2 * scale)),
                        (helmet_cx + int(3 * scale), helmet_cy - int(2 * scale)),
                    ]
                    draw.polygon(visor_poly, fill=(28, 30, 35))

                    # Chin bar extending forward
                    chin_poly = [
                        (helmet_cx + int(1 * scale), helmet_cy + int(1 * scale)),
                        (helmet_cx + hr + int(4 * scale), helmet_cy + int(2 * scale)),
                        (helmet_cx + hr + int(3 * scale), helmet_cy + hr - int(1 * scale)),
                        (helmet_cx, helmet_cy + hr),
                    ]
                    draw.polygon(chin_poly, fill=hue_color, outline=(120, 15, 15))

                    # Goggles (tinted reflective cyan / blue racing lens with black frame)
                    goggle_x1 = helmet_cx + int(1 * scale)
                    goggle_y1 = helmet_cy - int(3 * scale)
                    goggle_x2 = helmet_cx + hr + int(2 * scale)
                    goggle_y2 = helmet_cy + int(2 * scale)
                    draw.rounded_rectangle([goggle_x1, goggle_y1, goggle_x2, goggle_y2], radius=int(1.5 * scale), fill=(35, 195, 245), outline=(20, 22, 28))
                    # Goggle reflection shine
                    draw.line([(goggle_x1 + int(2 * scale), goggle_y1 + int(1 * scale)), (goggle_x2 - int(2 * scale), goggle_y1 + int(1 * scale))], fill=(220, 250, 255), width=1)
                    # Goggle strap around back of helmet
                    draw.line([(helmet_cx - hr, helmet_cy), (goggle_x1, helmet_cy)], fill=(20, 22, 28), width=int(max(1, 2 * scale)))

                    continue

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
