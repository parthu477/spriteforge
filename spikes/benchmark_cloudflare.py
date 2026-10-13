#!/usr/bin/env python3
"""
US-01 Day-1 Provider Evaluation Spike — Option A: Cloudflare Workers AI

Benchmarks FLUX.1 schnell across 30 prompts (10 × 3 grid layouts).
Results are saved to spikes/results_cloudflare.json.

Usage:
    python spikes/benchmark_cloudflare.py
"""
import os, json, time, datetime, pathlib, io
from dotenv import load_dotenv
import requests
from PIL import Image

load_dotenv(pathlib.Path(__file__).parent.parent / "backend" / ".env")

CF_ACCOUNT_ID = os.environ["CF_ACCOUNT_ID"]
CF_API_TOKEN = os.environ["CF_API_TOKEN"]
MODEL = os.environ.get("CF_MODEL_ID", "@cf/black-forest-labs/flux-1-schnell")

PROMPTS = [
    "a pixel art knight walking right",
    "a cartoon wizard casting a spell",
    "a painterly elf archer drawing a bow",
    "a goblin running with a club",
    "a robot soldier marching",
    "a witch riding a broomstick",
    "a dragon breathing fire",
    "a ninja doing a backflip",
    "a mage teleporting with sparkles",
    "a skeleton warrior swinging a sword",
]
GRIDS = ["1x4", "2x4", "4x4"]
OUTPUT_DIR = pathlib.Path(__file__).parent / "output_cloudflare"
OUTPUT_DIR.mkdir(exist_ok=True)

results = []
for prompt in PROMPTS:
    for grid in GRIDS:
        rows, cols = int(grid.split("x")[0]), int(grid.split("x")[1])
        seed = int(time.time()) % 100000
        url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{MODEL}"
        headers = {"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"}
        payload = {"prompt": f"sprite sheet {grid} grid: {prompt}, transparent background", "steps": 4, "seed": seed}

        t0 = time.perf_counter()
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=120)
            latency = time.perf_counter() - t0
            success = resp.ok
            error = None if success else f"HTTP {resp.status_code}"
            if success:
                img = Image.open(io.BytesIO(resp.content))
                fname = OUTPUT_DIR / f"{prompt[:20].replace(' ', '_')}_{grid}_{seed}.png"
                img.save(fname)
        except Exception as exc:
            latency = time.perf_counter() - t0
            success = False
            error = str(exc)

        result = {
            "prompt": prompt, "grid": grid, "seed": seed,
            "latency_s": round(latency, 2),
            "success": success, "error": error,
            "grid_adherence": None, "char_consistency": None, "bg_cleanability": None,
        }
        results.append(result)
        status = "✓" if success else f"✗ {error}"
        print(f"[CF] {grid:4s} | {prompt[:30]:30s} | {latency:.1f}s | {status}")

out_path = pathlib.Path(__file__).parent / "results_cloudflare.json"
out_path.write_text(json.dumps(results, indent=2))
print(f"\nResults saved → {out_path}")
print(f"Success rate: {sum(r['success'] for r in results)}/{len(results)}")
print("Next: fill in the grid_adherence / char_consistency / bg_cleanability scores (1–5) then run score_summary.py")
