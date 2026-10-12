# SpriteForge — System Architecture

| Item | Value |
|---|---|
| Version | 1.0 (draft) |
| Source | `SpriteForge_Project_Documentation.docx`, section 3 |
| Related | [srs.md](srs.md) · [frd.md](frd.md) · [data-contracts.md](data-contracts.md) · [security.md](security.md) |

---

## 1. Architecture at a glance

SpriteForge is a **pipeline of five layers**. The Python side (layers 1–4) and the C++ side (layer 5) are separate programs. They are connected **only through files in a shared folder**, which keeps them loosely coupled: either side can be developed, restarted or replaced on its own.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1  Input & Orchestration            (Python · Flask · 127.0.0.1:5000)│
│  ┌──────────────┐   POST /api/generate   ┌───────────────┐   ┌───────────┐  │
│  │  Browser UI  │ ─────────────────────► │  API routes   │──►│ Job queue │  │
│  │ (HTML/JS)    │ ◄───── poll status ─── │ + validation  │   │ (1 worker)│  │
│  └──────────────┘                        └───────────────┘   └─────┬─────┘  │
└────────────────────────────────────────────────────────────────────┼────────┘
                                                                     │ job
┌────────────────────────────────────────────────────────────────────▼────────┐
│  LAYER 2  AI Generation            (provider chosen by config, Day-1 test)  │
│  prompt_builder ──► ImageProvider ─┬─► A Cloudflare Workers AI (FLUX, HTTPS)│
│                                    ├─► B Local CPU model (SD-Turbo, OpenVINO)│
│                                    └─► C Hugging Face paid (HTTPS, optional)│
│                         ◄──────────── raw RGB image ────────────────────    │
└────────────────────────────────────────────────────────────────────┬────────┘
┌────────────────────────────────────────────────────────────────────▼────────┐
│  LAYER 3  Processing             rembg (ONNX)  ──►  Pillow                  │
│  remove bg → alpha check → grid crop/resize → frame align → metadata        │
└────────────────────────────────────────────────────────────────────┬────────┘
┌────────────────────────────────────────────────────────────────────▼────────┐
│  LAYER 4  Persistence            exporter (atomic)                          │
│  .x.png.tmp ─rename─► x.png   then   .x.json.tmp ─rename─► x.json           │
│                         📁  ASSET_DIR = /assets/sprites/                    │
└────────────────────────────────────────────────────────────────────┬────────┘
                                         (only shared interface)      │ files
┌────────────────────────────────────────────────────────────────────▼────────┐
│  LAYER 5  Engine Ingestion        (C++17 · SFML 2.6 · nlohmann/json)        │
│  main loop ─every 500 ms─► AssetWatcher ─► SpriteMetadata (parse+validate)  │
│            ─every frame──► AnimatedSprite::update/draw  ◄── Texture load    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer details

### Layer 1 — Input & orchestration (Flask)
| Item | Detail |
|---|---|
| Responsibility | Serve the UI, validate input, create jobs, report status, serve previews |
| Key modules | `app.py` (app factory), `routes/api.py`, `routes/ui.py`, `validators.py`, `jobs.py` |
| Concurrency | One `ThreadPoolExecutor(max_workers=JOB_WORKERS)` (default **1**). This keeps cloud rate limits / the daily free allowance and CPU-heavy work (rembg, local model) under control. Requests return straight away and the work runs in the background. |
| State | Job store in memory (a dict guarded by a `threading.Lock`), with a TTL clean-up |
| Why not Celery/Redis | Overkill for a single-user local tool. Can be swapped in later behind the same `jobs.py` interface. |

### Layer 2 — AI generation
| Item | Detail |
|---|---|
| Responsibility | Build the final prompt and call the model |
| Key modules | `services/prompt_builder.py`, `services/providers/{base,cloudflare,local_cpu,huggingface}.py`, `prompts/presets.yaml` |
| Interface | `generate(prompt: str, negative: str, width: int, height: int, seed: int) -> PIL.Image` ([data-contracts.md §5](data-contracts.md)) |
| Providers | **A** `CloudflareProvider`: Workers AI free tier, FLUX.1 schnell, HTTPS. **B** `LocalCpuProvider`: SD-Turbo/SDXL-Turbo through OpenVINO, in-process, loaded once at startup and reused. **C** `HuggingFaceProvider`: paid, built only if needed. Costs are in [costing.md](costing.md). |
| Selection | `PROVIDER` (default) and `FALLBACK_PROVIDER` in config. The default is chosen by the Day-1 test ([provider-evaluation.md](provider-evaluation.md)). |
| Resilience | Cloud providers: timeout, retries with exponential backoff on 429/503, `Retry-After` respected, size and content-type checks. All providers: on quota exhaustion, outage or no network, one retry through the fallback provider. |
| Output size | Cloud providers 1024 px; local CPU 512 px. Layer 3 reads the actual image size, so the grid maths works for both. |

### Layer 3 — Processing
| Item | Detail |
|---|---|
| Responsibility | Background removal, alpha check, grid normalisation, frame alignment, metadata |
| Key modules | `services/processing.py` (pure functions, easy to unit-test) |
| Libraries | `rembg` (one shared `new_session(REMBG_MODEL)` reused across jobs), Pillow |
| Safety | `Image.MAX_IMAGE_PIXELS` capped; the decoded image is checked against max dimensions |

### Layer 4 — Persistence
| Item | Detail |
|---|---|
| Responsibility | Atomic export of PNG then JSON into `ASSET_DIR` |
| Key modules | `services/exporter.py` |
| Protocol | temp file → `flush` + `os.fsync` → `os.replace` (atomic on the same volume on Windows and POSIX). Then the same for the JSON. |
| Guarantee | When `x.json` exists, `x.png` is complete (ADR-02) |

### Layer 5 — Engine ingestion (C++)
| Item | Detail |
|---|---|
| Responsibility | Find, validate, load, hot-reload and draw sprites |
| Classes | `Config`, `AssetWatcher`, `SpriteMetadata`, `AnimatedSprite`, `SpriteRegistry`, `Scene`, `Log` |
| Threading | **Single-threaded.** The scan runs in the main loop, throttled to `scan_interval_ms`. SFML textures must be created on the thread that owns the OpenGL context, and one thread keeps that simple (ADR-04). |
| Load budget | At most one asset loaded per scan tick, so bursts of files don't stutter the frame rate |

---

## 3. Main flows

### 3.1 Generate sprite (happy path)

```
User        Browser UI        Flask API         Job worker           Provider     ASSET_DIR      Engine
 │ type+click   │                 │                  │                   │            │             │
 │─────────────►│ POST /generate  │                  │                   │            │             │
 │              │────────────────►│ validate, enqueue│                   │            │             │
 │              │◄── 202 job_id ──│─────────────────►│                   │            │             │
 │              │ poll /jobs/id   │                  │ build prompt      │            │             │
 │              │────────────────►│ {generating}     │──── POST ────────►│            │             │
 │              │                 │                  │◄─── image ────────│            │             │
 │              │                 │                  │ rembg → grid → meta            │             │
 │              │                 │                  │ write png.tmp→png ────────────►│             │
 │              │                 │                  │ write json.tmp→json ──────────►│             │
 │              │ poll /jobs/id   │ {done, metadata} │                   │            │  scan tick  │
 │              │◄────────────────│                  │                   │            │◄────────────│
 │◄─ preview ───│                 │                  │                   │            │ parse+load  │
 │                                                                                    │  draw ──►   │
```

### 3.2 Engine scan tick

```
every frame:
    elapsed += dt
    if elapsed >= scan_interval:
        elapsed = 0
        for entry in directory_iterator(asset_dir):
            skip if not regular file, not *.json, or hidden/tmp
            t = last_write_time(entry)
            if seen[path] == t: continue           # already loaded or already failed at this version
            queue path (newest first)
        pop ONE path from queue:
            meta = SpriteMetadata::parse(path)      # size cap, try/catch, validation
            if !meta: seen[path]=t, log, continue
            png = asset_dir / meta.image_file       # file name only, checked
            if !exists(png): log "png missing", do NOT mark seen (retry next tick, max N)
            texture.loadFromFile(png); check dims vs meta
            registry.upsert(name, AnimatedSprite(texture, meta))
            seen[path] = t
    also: drop sprites whose json disappeared
    scene.update(dt); scene.draw()
```

### 3.3 Failure paths

| Where | Failure | Behaviour |
|---|---|---|
| L1 | Invalid input | 400 with field errors; no job created |
| L1 | Queue full | 429 "busy, try again" |
| L2 | 401/403 | Job fails straight away: "check the provider token" |
| L2 | 429/503/timeout | Retry with backoff up to the limit, then try the fallback provider (if configured); otherwise the job fails with the reason |
| L2 | Daily free allowance used up (Cloudflare) | Switch to the fallback provider (local CPU); if none, fail with "free limit reached, resets daily" |
| L2 | Local model can't load / out of memory | Job fails with `provider_local_error`; the startup log shows the cause |
| L2 | Wrong content type / too large | Job fails: "unexpected response from model" |
| L3 | Alpha check fails | Job fails: "background removal produced empty/full image — try a plainer background" |
| L4 | Disk write error | Temp files cleaned up, orphan PNG removed, job fails |
| L5 | Bad JSON / missing PNG / bad dimensions | Logged and skipped; the engine keeps running |

---

## 4. Repository structure

```
spriteforge/
├── backend/
│   ├── app.py                  # create_app(), bind 127.0.0.1
│   ├── config.py               # env/.env loading + validation (fail fast)
│   ├── logging_setup.py
│   ├── jobs.py                 # JobStore, executor, TTL cleanup
│   ├── validators.py           # prompt/name/grid/style/seed validation, slugify
│   ├── routes/
│   │   ├── api.py              # /api/generate, /api/jobs/<id>, /api/sprites, /api/health
│   │   └── ui.py               # GET /
│   ├── services/
│   │   ├── prompt_builder.py
│   │   ├── providers/
│   │   │   ├── base.py         # ImageProvider protocol, exceptions, get_provider()
│   │   │   ├── cloudflare.py   # Option A — Workers AI free tier
│   │   │   ├── local_cpu.py    # Option B — SD-Turbo via OpenVINO
│   │   │   └── huggingface.py  # Option C — paid (only if enabled)
│   │   ├── processing.py       # rembg, alpha check, grid, align, metadata
│   │   └── exporter.py         # atomic write, path containment, orphan cleanup
│   ├── prompts/presets.yaml    # style + grid templates, negative prompts
│   ├── templates/index.html
│   ├── static/{app.js, style.css}
│   ├── tests/                  # pytest: validators, processing, exporter, providers (mocked)
│   ├── requirements.txt        # pinned
│   └── .env.example
├── engine/
│   ├── CMakeLists.txt          # FetchContent: SFML 2.6.x, nlohmann/json 3.11.x
│   ├── config.json
│   ├── src/
│   │   ├── main.cpp
│   │   ├── Config.{h,cpp}
│   │   ├── Log.{h,cpp}
│   │   ├── AssetWatcher.{h,cpp}
│   │   ├── SpriteMetadata.{h,cpp}
│   │   ├── AnimatedSprite.{h,cpp}
│   │   ├── SpriteRegistry.{h,cpp}
│   │   └── Scene.{h,cpp}
│   └── tests/                  # metadata parser tests (doctest/Catch2)
├── shared/
│   ├── sprite.schema.json      # JSON Schema v1 — single source of truth
│   └── fixtures/               # valid + invalid sample sprites used by BOTH test suites
├── assets/sprites/             # ASSET_DIR (git-ignored except .gitkeep)
├── docs/                       # this documentation
├── .gitignore
└── README.md
```

---

## 5. Deployment view (MVP)

```
┌────────────────────────── Developer machine (Windows 10/11) ──────────────────────────┐
│                                                                                        │
│   Browser ──http──► Flask (python, 127.0.0.1:5000) ──https──► Cloudflare Workers AI    │
│                          │   └── or in-process local CPU model (models/sd-turbo-ov/)   │
│                          │                                                             │
│                          ▼ writes                                                      │
│                    C:\...\spriteforge\assets\sprites\                                  │
│                          ▲ reads                                                       │
│                    SpriteEngine.exe (SFML window)                                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Recommended:** run both natively on Windows for the MVP.
- If the backend runs in WSL and the engine on Windows, put `ASSET_DIR` on the Windows drive (`/mnt/c/...`). Writes across that boundary are slower, and `os.replace` is still atomic within the same drive. Test this setup in Phase 4.

---

## 6. Architecture decision records (ADRs)

| ADR | Decision | Reason | Alternatives rejected |
|---|---|---|---|
| ADR-01 | Use **files in a shared folder** as the only interface between backend and engine | Simple, language-neutral, debuggable (you can drop files in by hand), and the engine works without the backend | Socket/HTTP push to the engine: more code and more coupling |
| ADR-02 | **Atomic temp + rename, PNG before JSON**; JSON is the "ready" signal | Removes partial-read crashes without fragile sleeps | The doc's "write delays": timing-dependent and not reliable |
| ADR-03 | **SFML 2.6.x**, pinned and fetched via CMake `FetchContent` | Mature 2D API with built-in `Sprite`/`IntRect`, same build on Windows and Linux; pinning avoids SFML 3 API changes | Raylib (also fine; can switch if the team prefers C-style APIs). The choice is made once, in Phase 0. |
| ADR-04 | **Polling** with `std::filesystem` every 500 ms in the main loop | Portable, no OS-specific watcher APIs, keeps texture loads on the GL thread | `ReadDirectoryChangesW`/`inotify`: platform-specific, and events can arrive before the write finishes |
| ADR-05 | **Provider interface** around image generation, with three implementations (Cloudflare free tier, local CPU, Hugging Face paid) | Hosted model availability and free tiers change; lets the project run at ₹0 and switch provider by config | Calling one API directly from routes |
| ADR-09 | **Default provider chosen by a Day-1 test**, with a **fallback provider** | The choice is based on real output for our prompts; the fallback covers the daily cap, outages and offline work | Choosing up front without testing; a single provider with no fallback |
| ADR-06 | **User-chosen grid** (presets) instead of inferring it from image size | Image size alone can't tell 2×2 from 1×4 | Auto-detect only: unreliable with SD output |
| ADR-07 | **In-memory job queue, one worker** | Single local user; rembg and the local model are CPU-heavy; cloud rate limits | Celery + Redis: infrastructure overhead not justified for the MVP |
| ADR-08 | **Shared JSON Schema + fixtures** in `/shared` used by both test suites | Stops Python and C++ drifting apart on the contract | Each side keeping its own copy of the rules |

---

## 7. Extension points (post-MVP)
- **New providers:** add a class that implements `ImageProvider` (local GPU with diffusers, Replicate, other HF Inference Providers).
- **Consistency upgrades:** img2img or ControlNet with a grid/pose template, character reference images, LoRA for a fixed art style.
- **Multi-animation assets:** extend the schema (v2) with `animations: {walk:[0..3], idle:[4..7]}`. The engine already ignores unknown keys, so v1 assets keep working.
- **Push notifications to the engine:** optional local socket, in addition to polling.
