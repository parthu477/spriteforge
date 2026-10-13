#!/usr/bin/env python3
"""
US-19 Fuzz Test — Native Engine Malformed Asset Hardening

Bombards ASSET_DIR with random/truncated/corrupted files for 5 minutes
while the SpriteEngine is expected to be running alongside.

Usage:
    python tests/fuzz_asset_dir.py --asset-dir /path/to/assets/sprites
"""
import argparse, json, os, pathlib, random, string, time, threading

parser = argparse.ArgumentParser()
parser.add_argument("--asset-dir", default="../assets/sprites")
parser.add_argument("--duration", type=int, default=300, help="Seconds to run (default 300)")
args = parser.parse_args()

ASSET_DIR = pathlib.Path(args.asset_dir).resolve()
ASSET_DIR.mkdir(parents=True, exist_ok=True)
DURATION = args.duration
stop_event = threading.Event()

created_files: list[pathlib.Path] = []

def rand_str(n=8):
    return "".join(random.choices(string.ascii_lowercase, k=n))

def write_truncated_json():
    valid = json.dumps({"schema_version":1,"name":"fuzz","image_file":"fuzz_aabbcc.png",
                        "frame_width":64,"frame_height":64,"rows":1,"columns":4,"frame_count":4})
    truncated = valid[:random.randint(1, len(valid)-1)]
    path = ASSET_DIR / f"fuzz_{rand_str()}.json"
    path.write_text(truncated)
    created_files.append(path)

def write_random_binary_json():
    path = ASSET_DIR / f"fuzz_{rand_str()}.json"
    path.write_bytes(os.urandom(random.randint(16, 2048)))
    created_files.append(path)

def write_deeply_nested_json():
    obj: dict = {"schema_version":1,"name":"n","image_file":"n_aabbcc.png",
                 "frame_width":1,"frame_height":1,"rows":1,"columns":1,"frame_count":1}
    for _ in range(200):
        obj = {"nested": obj}
    path = ASSET_DIR / f"fuzz_{rand_str()}.json"
    path.write_text(json.dumps(obj))
    created_files.append(path)

def write_overflow_values():
    obj = {"schema_version":1,"name":"n","image_file":"n_aabbcc.png",
           "frame_width":2**31,"frame_height":2**31,"rows":65535,"columns":65535,"frame_count":2**31}
    path = ASSET_DIR / f"fuzz_{rand_str()}.json"
    path.write_text(json.dumps(obj))
    created_files.append(path)

def write_non_image_as_png():
    path = ASSET_DIR / f"fuzz_{rand_str()}.png"
    path.write_bytes(b"this is not a png file at all, just random text " * 20)
    created_files.append(path)

def rapid_create_modify_delete():
    name = f"fuzz_{rand_str()}"
    p = ASSET_DIR / f"{name}.json"
    obj = {"schema_version":1,"name":name,"image_file":f"{name}_xx.png",
           "frame_width":64,"frame_height":64,"rows":1,"columns":1,"frame_count":1}
    p.write_text(json.dumps(obj))
    time.sleep(0.01)
    p.write_text(json.dumps({**obj, "frame_width": random.randint(0, 9999)}))
    time.sleep(0.01)
    p.unlink(missing_ok=True)

fuzzers = [
    write_truncated_json,
    write_random_binary_json,
    write_deeply_nested_json,
    write_overflow_values,
    write_non_image_as_png,
    rapid_create_modify_delete,
]

print(f"[FUZZ] Starting {DURATION}s fuzzing against {ASSET_DIR}")
t0 = time.time()
count = 0
try:
    while time.time() - t0 < DURATION:
        fn = random.choice(fuzzers)
        try:
            fn()
        except Exception as exc:
            print(f"[FUZZ] Fuzzer error: {exc}")
        count += 1
        time.sleep(random.uniform(0.05, 0.3))
finally:
    # Cleanup
    for f in created_files:
        f.unlink(missing_ok=True)
    print(f"[FUZZ] Done. {count} operations. All temp files cleaned.")
    print("[FUZZ] Check engine.log for error entries (AC 19.3)")
