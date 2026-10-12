# SpriteForge — Developer Setup Guide

Target: a new developer goes from a clean machine to a running prompt → sprite → engine loop in **≤ 30 minutes** (NFR-U1).

| Item | Value |
|---|---|
| Primary OS | Windows 10/11 (native, recommended) |
| Also supported | Ubuntu 22.04+ / WSL2 |
| Source | `SpriteForge_Project_Documentation.docx`, section 5 (updated: pinned versions, CMake FetchContent, rembg model pre-download, atomic hand-off) |
| Related | [architecture.md](architecture.md) · [data-contracts.md](data-contracts.md) · [security.md](security.md) |

---

## 1. Prerequisites

| Tool | Windows | Ubuntu / WSL |
|---|---|---|
| Git | git-scm.com installer | `sudo apt install git` |
| Python 3.11 | python.org installer (tick "Add to PATH") | `sudo apt install python3.11 python3.11-venv` |
| C++ compiler | Visual Studio 2022 Build Tools ("Desktop development with C++") | `sudo apt install build-essential` |
| CMake ≥ 3.20 | cmake.org installer or `winget install Kitware.CMake` | `sudo apt install cmake` |
| SFML build deps | none (built by CMake) | `sudo apt install libx11-dev libxrandr-dev libxcursor-dev libxi-dev libudev-dev libgl1-mesa-dev libfreetype-dev libopenal-dev libflac-dev libvorbis-dev` |
| **Option A** — Cloudflare account + API token | dash.cloudflare.com → free account → note the **Account ID** → My Profile → API Tokens → create a token with **Workers AI** permission only | same |
| **Option B** — local CPU model | Nothing to sign up for; needs ~10 GB free disk and 16 GB RAM (see §3.2) | same |
| Option C — Hugging Face token (only if the paid option is enabled) | huggingface.co → Settings → Access Tokens → **fine-grained**, minimal scope | same |

> Which options you need depends on the Day-1 decision ([provider-evaluation.md](provider-evaluation.md)): normally **A as the default + B as the fallback**. Get tokens from the team password manager, or create your own. Never share it over chat or email, and never paste it into AI tools ([security.md](security.md) S-01).

---

## 2. Clone

```bash
git clone <repo-url> spriteforge
cd spriteforge
mkdir -p assets/sprites        # Windows PowerShell: mkdir assets\sprites -Force
```

---

## 3. Backend (Python)

```bash
cd backend
python -m venv venv
# Windows (PowerShell):  .\venv\Scripts\Activate.ps1
# Ubuntu / WSL:          source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
```

`requirements.txt` (versions are pinned in Phase 0. This is the shape):
```
Flask==3.*
requests==2.*
python-dotenv==1.*
Pillow==10.*            # or newer patched release
rembg[cpu]==2.*         # the [cpu] extra pulls in onnxruntime
jsonschema==4.*
PyYAML==6.*
# dev
pytest
ruff
black
pip-audit
```

### 3.1 Pre-download background-removal models (once, ~170 MB each)
```bash
python -c "from rembg import new_session; new_session('u2net'); new_session('isnet-anime'); print('ok')"
```
This stops the first real request from stalling on a download.

### 3.2 Local CPU model (Option B — only if it is the default or fallback)
```bash
pip install -r requirements-local.txt     # optimum[openvino], diffusers, transformers (pinned in Phase 0)
python scripts/prepare_local_model.py     # downloads stabilityai/sd-turbo (.safetensors), converts to OpenVINO,
                                          # saves to ../models/sd-turbo-ov  (one time, ~5 GB, 10–30 min)
```
Only download from the official model repository ([security.md](security.md) S-10). `models/` is git-ignored.

### 3.3 Configure
```bash
cp .env.example .env          # Windows: copy .env.example .env
```
Edit `.env`:
```dotenv
PROVIDER=cloudflare                 # from the Day-1 decision
FALLBACK_PROVIDER=local_cpu
CF_ACCOUNT_ID=your_account_id
CF_API_TOKEN=your_workers_ai_token
LOCAL_MODEL_DIR=../models/sd-turbo-ov
# HF_TOKEN=hf_...                   # only if the paid Hugging Face option is enabled
ASSET_DIR=../assets/sprites
FLASK_HOST=127.0.0.1
FLASK_PORT=5000
```
Check that it's ignored: `git check-ignore -v .env` should print a match.

### 3.4 Run
```bash
python app.py
# → Running on http://127.0.0.1:5000
```
Open `http://127.0.0.1:5000/api/health` and you should see `"status":"ok"` and `"asset_dir_writable":true`.

### 3.5 Tests
```bash
pytest -q
ruff check . && black --check .
pip-audit
```

---

## 4. Engine (C++)

### 4.1 CMake (already in the repo, shown for reference)
```cmake
cmake_minimum_required(VERSION 3.20)
project(SpriteEngine LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
set(BUILD_SHARED_LIBS OFF)
set(SFML_BUILD_AUDIO OFF)
set(SFML_BUILD_NETWORK OFF)
FetchContent_Declare(SFML
  GIT_REPOSITORY https://github.com/SFML/SFML.git
  GIT_TAG 2.6.2)                       # pin exact tag (ADR-03)
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
FetchContent_MakeAvailable(SFML json)

file(GLOB SRC src/*.cpp)
add_executable(SpriteEngine ${SRC})
target_link_libraries(SpriteEngine PRIVATE sfml-graphics nlohmann_json::nlohmann_json)

if(MSVC)
  target_compile_options(SpriteEngine PRIVATE /W4 /WX)
else()
  target_compile_options(SpriteEngine PRIVATE -Wall -Wextra -Werror)
endif()
```
The original document downloaded `json.hpp` with `wget`. `FetchContent` replaces that and pins the version for every developer and for CI.

### 4.2 Configure the asset path
`engine/config.json`: set `asset_dir` to the **absolute** path of `spriteforge/assets/sprites`. Use forward slashes on Windows too:
```json
{ "asset_dir": "C:/Users/<you>/.../spriteforge/assets/sprites", "scan_interval_ms": 500, "default_fps": 8 }
```

### 4.3 Build & run
```bash
cd engine
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
# Windows:  .\build\Release\SpriteEngine.exe
# Linux:    ./build/SpriteEngine
```
The first build downloads and compiles SFML, which takes a few minutes. Later builds are fast.

### 4.4 Smoke test without the backend
```bash
# from repo root
cp shared/fixtures/valid_1x4.* assets/sprites/
```
The sprite should appear within ~1 s. Then copy an `invalid_*.json` in. The engine should log a rejection and keep running.

### 4.5 Tests
```bash
ctest --test-dir build -C Release --output-on-failure
```

---

## 5. End-to-end check

1. Start the engine (window opens, empty scene).
2. Start the backend.
3. Open `http://127.0.0.1:5000`, enter *"a small green slime bouncing"*, grid `1x4`, style `pixel_art`, then **Generate**.
4. Watch the stages in the UI. When it reaches **done**, the sprite appears in the engine window without a restart.

---

## 6. WSL + Windows split (only if needed)

Recommended: run **both on Windows** for the MVP. If the backend must run in WSL:
- Put the repo, or at least `assets/sprites`, on the Windows drive and set `ASSET_DIR=/mnt/c/Users/<you>/.../assets/sprites` in WSL.
- The engine's `asset_dir` uses the Windows form of the same folder: `C:/Users/<you>/.../assets/sprites`.
- Temp file and final file are in the same folder, so the rename stays atomic.
- Browse to `http://localhost:5000` from Windows. WSL2 forwards localhost by default.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend exits: "CF_API_TOKEN missing" (or another provider setting) | `.env` not created, venv not active, or the provider in `PROVIDER` isn't configured | Step 3.3; activate the venv |
| Job fails `provider_auth` | Wrong or expired token, or token lacks permission | Cloudflare: token needs the **Workers AI** permission and the right Account ID. HF: token needs inference access. |
| Job fails `provider_quota_exceeded` | Cloudflare daily free allowance used up | Wait for the daily reset, or set `FALLBACK_PROVIDER=local_cpu` |
| Job fails `provider_local_error` | Local model folder missing, or out of memory | Run step 3.2 again; close other heavy apps; keep `JOB_WORKERS=1` |
| Local CPU generation very slow | Older CPU or the model wasn't converted to OpenVINO | Check that `LOCAL_MODEL_DIR` points to the converted model; compare with the Day-1 timing |
| Job fails `provider_unavailable` repeatedly | Provider outage, no network, or (HF) model cold-starting | Wait and retry; check the model id against the Day-1 notes; make sure a fallback provider is set |
| Job fails `bg_removal_failed` | Busy background in the generated image | Use a style with "plain solid background"; try `REMBG_MODEL=isnet-anime` |
| First job very slow | rembg model downloading | Run step 3.1 |
| `Activate.ps1 cannot be loaded` (Windows) | PowerShell execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| CMake can't find a compiler (Windows) | Build Tools not installed or wrong shell | Use "Developer PowerShell for VS 2022" |
| SFML build fails on Linux | Missing X11/GL dev packages | Install the deps from §1 |
| Engine shows nothing | `asset_dir` mismatch | Compare `ASSET_DIR` (backend log at startup) with `asset_dir` (engine log at startup). They must be the same folder. |
| Engine logs "png missing" repeatedly | JSON written by hand without its PNG, or a wrong `image_file` | Check the file names; the exporter always writes the PNG first |
| `Address already in use :5000` | Another process on that port | Change `FLASK_PORT`; leave the host as `127.0.0.1` |
