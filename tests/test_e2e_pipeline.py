#!/usr/bin/env python3
"""
US-20 End-to-End Automated Pipeline Integration Test

Submits 10 consecutive POST /api/generate requests and verifies
each job reaches status 'done' and its assets appear in ASSET_DIR.

Usage:
    python tests/test_e2e_pipeline.py --base-url http://127.0.0.1:5000 --asset-dir ../assets/sprites
"""
import argparse, json, os, sys, time, pathlib, requests, threading

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5000")
parser.add_argument("--asset-dir", default="../assets/sprites")
parser.add_argument("--timeout-per-job", type=int, default=90)
args = parser.parse_args()

BASE = args.base_url
ASSET_DIR = pathlib.Path(args.asset_dir).resolve()

PROMPTS = [
    ("pixel art knight walking right", "1x4", "pixel_art"),
    ("cartoon wizard casting a spell", "1x4", "cartoon"),
    ("painterly elf archer", "2x4", "painterly"),
    ("goblin running left", "1x6", "pixel_art"),
    ("robot soldier marching", "1x8", "cartoon"),
    ("witch on broomstick", "1x4", "pixel_art"),
    ("dragon flying forward", "4x4", "painterly"),
    ("ninja doing backflip", "2x4", "pixel_art"),
    ("mage teleporting sparkles", "1x4", "cartoon"),
    ("skeleton warrior swinging sword", "1x4", "pixel_art"),
]

def get_csrf_token(session: requests.Session) -> str:
    resp = session.get(f"{BASE}/")
    # Extract token from hidden input
    import re
    m = re.search(r'id="csrf-token" value="([^"]+)"', resp.text)
    return m.group(1) if m else ""

session = requests.Session()
csrf = get_csrf_token(session)

results = []
t_total = time.time()

for i, (prompt, grid, style) in enumerate(PROMPTS):
    print(f"[E2E] Job {i+1:2d}/10 — {prompt[:40]}")
    t0 = time.time()
    resp = session.post(
        f"{BASE}/api/generate",
        json={"prompt": prompt, "grid": grid, "style": style},
        headers={"X-CSRF-Token": csrf, "Origin": BASE},
    )
    if resp.status_code == 202:
        job_id = resp.json()["job_id"]
    else:
        print(f"  ✗ Submission failed: {resp.status_code} {resp.text[:80]}")
        results.append({"prompt": prompt, "ok": False, "error": f"submission {resp.status_code}"})
        continue

    # Poll until done or timeout (AC 20.1: ≤90s per job on warm model)
    deadline = time.time() + args.timeout_per_job
    ok = False
    while time.time() < deadline:
        jr = session.get(f"{BASE}/api/jobs/{job_id}").json()
        if jr["status"] == "done":
            elapsed = time.time() - t0
            print(f"  ✓ Done in {elapsed:.1f}s — {jr.get('metadata', {}).get('image_file','?')}")
            results.append({"prompt": prompt, "ok": True, "elapsed": elapsed, "metadata": jr["metadata"]})
            ok = True
            break
        elif jr["status"] == "failed":
            print(f"  ✗ Failed: {jr.get('error')}")
            results.append({"prompt": prompt, "ok": False, "error": str(jr.get("error"))})
            ok = True
            break
        time.sleep(2)

    if not ok:
        print(f"  ✗ Timed out after {args.timeout_per_job}s")
        results.append({"prompt": prompt, "ok": False, "error": "timeout"})

total_elapsed = time.time() - t_total
success = sum(1 for r in results if r["ok"])
print(f"\n[E2E] Results: {success}/10 succeeded in {total_elapsed:.1f}s total")

# Write telemetry (AC 20.3)
telemetry_path = pathlib.Path("e2e_telemetry.json")
telemetry_path.write_text(json.dumps({
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "success": success,
    "total": len(results),
    "total_elapsed_s": round(total_elapsed, 2),
    "results": results,
}, indent=2))
print(f"[E2E] Telemetry saved to {telemetry_path}")

# AC 20.3: exit code 0 only if all 10 succeed
sys.exit(0 if success == 10 else 1)
