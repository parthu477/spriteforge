# SpriteForge — Project Overview

> Source: `SpriteForge_Project_Documentation.docx` (SRS, FRD, architecture, phases, setup, QA checklists)

## Documents

| File | Purpose |
|---|---|
| [overview.md](overview.md) | This file: short summary, scope, estimate, top risks |
| [srs.md](srs.md) | Software requirements: scope, environment, constraints, non-functional requirements |
| [frd.md](frd.md) | Functional requirements FR-01 – FR-10 with acceptance criteria and traceability |
| [architecture.md](architecture.md) | Layers, flows, repo structure, deployment, design decisions (ADRs) |
| [data-contracts.md](data-contracts.md) | REST API, sprite JSON schema, file naming, config keys (the shared Python ⇄ C++ contract) |
| [implementation-plan.md](implementation-plan.md) | All phases (0–5) with tasks, checklists, exit criteria, schedule, test matrix, release checklist, risks |
| [security.md](security.md) | Threats, controls, secure config, security release checklist |
| [setup-guide.md](setup-guide.md) | Developer setup on Windows / Ubuntu / WSL, smoke tests, troubleshooting |
| [costing.md](costing.md) | Free vs paid items; three image-generation options (Cloudflare free tier, local CPU, Hugging Face paid) with MVP and monthly costs |
| [provider-evaluation.md](provider-evaluation.md) | Day-1 test (~5–6 h) that picks the default and fallback image provider, with rubric and results template |
| [user-stories.md](user-stories.md) | Agile user stories (US-01 to US-20) with acceptance criteria, personas & traceability matrix |

---

## 1. What the project is

SpriteForge is a tool that turns a **text prompt into a working, animated 2D game sprite inside a running C++ game**, with no manual steps in between.

```
"knight walking, 4 frames"  →  AI image  →  remove background  →  PNG + JSON  →  game picks it up live
```

**Who it's for:** game developers, technical artists and level designers who want quick placeholder or prototype art.

**Tech stack**

| Part | Technology |
|---|---|
| Prompt UI + orchestration | Python 3.9+, Flask, simple HTML/CSS |
| AI generation | Swappable provider, chosen on Day 1: **Cloudflare Workers AI free tier** (FLUX.1 schnell), **local CPU model** (SD-Turbo), or Hugging Face paid. See [costing.md](costing.md). |
| Image processing | `rembg` (background removal) + Pillow (RGBA, grid maths) |
| Hand-off | Local folder `/assets/sprites/` (PNG first, then JSON) |
| Game engine | C++17, SFML or Raylib, `nlohmann/json`, `std::filesystem` watcher |
| OS | Windows 10/11 or WSL/Ubuntu |

---

## 2. How it works (5 layers)

1. **Input & orchestration (Flask):** a local web page takes the prompt and settings and sends a POST to Flask, which runs the whole pipeline.
2. **AI generation (provider):** Flask wraps the prompt in a "sprite sheet" template and calls the configured image provider (Cloudflare free tier by default, local CPU model as fallback), which returns a raw RGB image.
3. **Processing (rembg + Pillow):** removes the background to get a transparent PNG, then works out frame width, height, rows, columns and frame count.
4. **Persistence (file system):** writes `name.png` first and `name.json` second. The JSON acts as the "ready" signal.
5. **Engine ingestion (C++):** once per frame of the game loop, the engine checks the folder for new `.json` files. For each one it parses the metadata, loads the PNG as a texture and creates an `AnimatedSprite` that plays on screen.

**Metadata contract (JSON)** — this is the one interface both sides must agree on:

```json
{
  "image_file": "knight_walk.png",
  "frame_width": 128,
  "frame_height": 128,
  "rows": 1,
  "columns": 4,
  "frame_count": 4
}
```

---

## 3. What needs to be implemented

### A. Python backend
- [ ] Flask app with `GET /` (prompt form) and `POST /generate`
- [ ] Prompt form fields: prompt, sprite name, frames/grid (rows × cols), style preset
- [ ] Input validation (no empty prompt, safe file names)
- [ ] Provider token (`CF_API_TOKEN`) read from an environment variable or `.env` file, never hard-coded
- [ ] Provider classes behind one interface (default + fallback): timeout, retry with backoff, handling for 429 / 503 / daily cap
- [ ] Prompt wrapper templates that push the model toward evenly spaced sprite sheets
- [ ] Return status or errors to the UI, plus a preview of the generated sprite

### B. Image processing
- [ ] Convert API bytes to a Pillow image
- [ ] Remove the background with `rembg` and check the alpha channel
- [ ] Slice the image into the grid and calculate frame width and height (see risk #2)
- [ ] Optional: resize or snap to a fixed cell size (e.g. 64/128 px) and apply nearest-neighbour scaling for pixel art
- [ ] **Atomic write:** write to `*.tmp`, then `os.replace()` for the PNG, then the same for the JSON

### C. C++ engine
- [ ] Project and CMake setup with SFML or Raylib and `nlohmann/json.hpp`
- [ ] Folder watcher using `std::filesystem::directory_iterator` that only looks at `.json` files and is throttled to run every ~250–500 ms, not every frame
- [ ] A `processed` set so each asset loads only once (or reloads when its modified time changes, for true hot-reload)
- [ ] Check that the matching PNG exists before loading the texture
- [ ] Wrap JSON parsing in try/catch: log the error and keep running
- [ ] `AnimatedSprite` class: texture, frame rectangles, frame timer, `update(dt)` and `draw()`
- [ ] Simple scene that lays out every loaded sprite on screen and animates them

### D. Integration & QA
- [ ] End-to-end test: prompt to sprite on screen
- [ ] Run both QA checklists from the document (backend and engine)
- [ ] Tune prompts for a consistent style and palette
- [ ] README, `requirements.txt`, build steps and a demo video or GIF

---

## 4. How we plan to run it

The document splits the work across **4 engineers in 4 phases**. With **1–2 developers** we merge them into two parallel tracks that meet at the JSON contract.

| Track | Owner | Covers doc phases |
|---|---|---|
| **Python track** | Dev 1 | Phase 1 (Flask + image provider) and Phase 2 (rembg + Pillow + export) |
| **Engine track** | Dev 2 | Phase 3 (C++ watcher, JSON, AnimatedSprite) |
| **Shared** | Both | Phase 4 (prompt engineering, end-to-end tests, tuning) |

**Rule for Day 1:** freeze the JSON schema and the folder path. After that, the engine can be built and tested with **hand-made sample sprite sheets** without waiting for the AI side.

---

## 5. Timeline — 12 working days, 2 developers (with AI coding tools)

| Day | Dev 1 — Python | Dev 2 — C++ |
|---|---|---|
| 1 | Repo setup, venv, **provider evaluation: Cloudflare vs local CPU** ([provider-evaluation.md](provider-evaluation.md), main risk) | CMake + SFML/Raylib window running, add json.hpp |
| 2 | Flask app, prompt form, `/generate` route | Freeze JSON contract, build 3–4 sample sprite sheets by hand |
| 3 | Default provider client: retries, timeouts, error messages to the UI | `AnimatedSprite` class plays the sample sheets |
| 4 | rembg + alpha check | Folder watcher, processed set, PNG existence check |
| 5 | Grid calculation, atomic PNG→JSON export | Error handling for bad JSON/PNG, reload on modified time |
| 6 | Prompt wrapper templates and style presets | Scene layout and basic controls (cycle sprites, change speed) |
| 7 | **First end-to-end run: prompt → on-screen sprite** | ← same |
| 8–9 | Prompt tuning, grid cleanup / frame alignment | Edge cases: file locks on Windows, large textures, many sprites |
| 10 | Both QA checklists, bug fixes | ← same |
| 11 | README, setup scripts, demo | ← same |
| 12 | Buffer | Buffer |

**With 1 developer:** do the same steps one after another (C++ basics on days 1–4 using sample sheets, Python on days 5–9, integration and QA on days 10–15). It fits in about **15 days**, with little room for surprises.

---

## 6. Is 10–15 days with 1–2 devs + AI tools realistic?

**Yes, for a working MVP.** The amount of code is small:

| Component | Rough size |
|---|---|
| Flask + provider classes + UI | ~350–500 lines |
| rembg/Pillow pipeline + export | ~150–250 lines |
| C++ watcher + JSON + AnimatedSprite + scene | ~400–600 lines |

AI coding tools will write most of the boilerplate quickly (Flask routes, CMake, the sprite class, retry logic). **Writing the code is not the hard part.** The hard part is **getting the AI to produce usable art**, and AI tools don't make that faster. Tuning it is trial and error.

| Scenario | Estimate |
|---|---|
| 2 devs, MVP (pipeline works, sprites animate, output is "usable-ish") | **8–12 days** ✅ |
| 1 dev, MVP | **13–15 days** ⚠️ tight |
| Production-quality, consistent animation frames | **Not realistic** in 15 days with plain Stable Diffusion text-to-image (see risk #1) |

---

## 7. Key risks & how to handle them

| # | Risk | Why it matters | Mitigation |
|---|---|---|---|
| 1 | **SD frames aren't consistent** | Plain Stable Diffusion is good at single images, but it rarely draws the same character across 4–8 cells of a grid. Animations may jitter or change design from frame to frame. | Set expectations: MVP = "prototype art". Use pixel-art / sprite-sheet fine-tuned models or LoRAs, fix the grid in the prompt, and consider img2img or ControlNet with a grid template as a later upgrade. |
| 2 | **Grid can't be reliably detected from image size alone** | The FRD says rows and columns come from the image dimensions, but a 1024×1024 image could be 4×4, 2×2 or 1×4. | Let the **user choose the grid** in the UI and put it in the prompt. Optionally, auto-detect empty columns/rows from the alpha channel as a cleanup step. |
| 3 | **Provider availability / free-tier limits** | Cloudflare's daily free allowance or terms may change; cloud outages and rate limits happen; the local model is slower and lower quality. | Day-1 evaluation picks the default; the **local CPU model is the fallback**; the paid Hugging Face option is documented as a last resort ([costing.md](costing.md)). |
| 4 | **rembg removes parts of the character** | It can cut out light or thin details, and the first run downloads a model (~170 MB). | Prompt for a plain solid background, try different rembg models (`u2net`, `isnet-anime`), and pre-download the model during setup. |
| 5 | **Engine reads a half-written file** | The doc suggests adding "write delays". Delays are fragile. | Use temp file + `os.replace()` (atomic). Write PNG, then JSON. The engine only reacts to JSON and checks the PNG exists. |
| 6 | **Windows/WSL path & file-lock issues** | Flask in WSL writing to a folder the Windows engine reads (or the other way round) can cause path and locking problems. | Run both on the same OS for the MVP, and share one config value for the asset folder path. |
| 7 | **Scope creep** | Editing, palettes, multiple animations per character and so on can each add days. | Keep the MVP to: one prompt → one sprite sheet → one looping animation. |

---

## 8. Definition of done (MVP)

- Type a prompt in the browser, and within about a minute a transparent, animated sprite appears in the running C++ window without a restart.
- Bad input, API failures and malformed JSON are reported clearly and never crash the server or the engine.
- No API key in the repo. Both QA checklists pass. A README lets a new developer run the project in under 30 minutes.

## 9. Out of scope for this 10–15 day window (later phases)
- Character consistency across separate generations (same hero, different animations)
- Multiple animation states per character (idle/walk/attack) in one asset
- Editing or regenerating individual frames in the UI
- Deploying the backend to a server, user accounts, asset library or history
