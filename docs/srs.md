# SpriteForge — Software Requirements Specification (SRS)

| Item | Value |
|---|---|
| Document | SRS |
| Version | 1.0 (draft) |
| Source | `SpriteForge_Project_Documentation.docx`, section 1 |
| Related | [frd.md](frd.md) · [user-stories.md](user-stories.md) · [architecture.md](architecture.md) · [data-contracts.md](data-contracts.md) · [security.md](security.md) |

---

## 1. Introduction

### 1.1 Purpose
SpriteForge automates the full path from a **text prompt** to an **animated 2D sprite loaded into a running C++ game**. It generates the image with AI, cleans it up, packages it with metadata and hot-loads it into the engine, with no manual steps.

### 1.2 Intended audience of this document
Developers (Python and C++), the project lead, QA, and the client or stakeholder who signs off the scope.

### 1.3 Product scope
**In scope (MVP):**
- Local web page to enter a prompt and choose generation settings
- Flask backend that runs the pipeline as background jobs
- AI image generation through a **swappable provider**: Cloudflare Workers AI free tier (FLUX.1 schnell), a local CPU model (SD-Turbo via OpenVINO), or Hugging Face paid. The default is chosen by the Day-1 test ([provider-evaluation.md](provider-evaluation.md)); costs are in [costing.md](costing.md).
- Background removal (`rembg`) and image normalisation (Pillow)
- Grid/frame calculation and export of `.png` and `.json` to the engine's asset folder
- C++ game that watches the folder, loads new or changed sprites and plays them as looping animations

**Out of scope (MVP):** see section 7.

### 1.4 Definitions

| Term | Meaning |
|---|---|
| Sprite sheet | One image containing several animation frames arranged in a grid |
| Frame / cell | One image in the grid, of size `frame_width × frame_height` |
| Metadata file | The `.json` file describing a sprite sheet (see [data-contracts.md](data-contracts.md)) |
| Hot-reload | The engine picks up new or changed assets while running, without a restart |
| Job | One generation request moving through the pipeline (queued → done/failed) |
| HF | Hugging Face |
| Provider | The service or local model that generates images (Cloudflare, local CPU or Hugging Face) |
| SD | Stable Diffusion |

---

## 2. Overall description

### 2.1 Product perspective
SpriteForge is a standalone developer tool made of two local programs that share one folder:

```
[Browser] ⇄ [Flask backend] → [Image provider: Cloudflare (HTTPS) | local CPU model | Hugging Face (HTTPS)]
                  │
                  ▼ writes PNG then JSON
           /assets/sprites/
                  ▲ polls
           [C++ game engine]
```

The two programs never talk to each other directly. The asset folder and the JSON schema are the only interface between them.

### 2.2 User classes

| User | Needs | Technical level |
|---|---|---|
| Game developer | Fast placeholder art while prototyping mechanics | High |
| Technical artist | Try styles and prompts quickly, then refine by hand | Medium–high |
| Level designer | Fill a scene with variety without waiting for the art team | Medium |

### 2.3 Operating environment

| Component | Requirement |
|---|---|
| OS | Windows 10/11 (primary — the dev machine), or Ubuntu 22.04+/WSL2 |
| Backend runtime | Python 3.9+ (3.11 recommended), Flask 3.x |
| Image libs | `rembg` (ONNX Runtime, CPU is enough), Pillow 10+ |
| Engine | C++17 compiler (MSVC 2022, MinGW-w64 GCC 11+, or GCC/Clang on Linux), CMake 3.20+ |
| Graphics | SFML 2.6.x (chosen — see [architecture.md](architecture.md), ADR-03) |
| JSON | nlohmann/json 3.11.x (header-only) |
| Network | Outbound HTTPS to the chosen cloud provider (none needed for the local CPU provider after setup); nothing inbound |
| Browser | Any current Chrome, Edge or Firefox |
| Hardware | 8 GB RAM minimum; **16 GB RAM, a modern 6–8+ core CPU and ~10 GB free disk if the local CPU provider is used**; no GPU needed |

### 2.4 Constraints
- **C-1** Cloud image generation is limited by the provider's rate limits, daily free allowance (Cloudflare) and availability; local generation is limited by CPU speed and is 512 px only.
- **C-2** Provider API tokens must never be committed to the repository or shown in the browser.
- **C-6** Target budget for tools and services is **₹0** (free providers; see [costing.md](costing.md)).
- **C-3** Backend and engine must share one asset folder path, set in configuration.
- **C-4** Delivery window is 10–15 days with 1–2 developers.
- **C-5** Pinned dependency versions only, so behaviour is repeatable.

### 2.5 Assumptions & dependencies
- **A-1** A free Cloudflare account with a Workers AI API token is available (Option A); the dev machine can run the local CPU model (Option B).
- **A-2** At least one of the providers gives usable sprite sheets. This is confirmed on Day 1 ([provider-evaluation.md](provider-evaluation.md)); if none does, the scope falls back to single-frame sprites.
- **A-3** Users run the backend and engine on the same machine during the MVP.
- **A-4** Generated art is prototype/placeholder quality. Frame-to-frame consistency is best-effort (see risk R-1 in [overview.md](overview.md)).

---

## 3. System features (summary)

Full detail is in [frd.md](frd.md).

| ID | Feature | Priority |
|---|---|---|
| FR-01 | Prompt ingestion (web UI + API) | Must |
| FR-02 | AI sprite generation (configured provider + fallback) | Must |
| FR-03 | Background removal | Must |
| FR-04 | Grid calculation & normalisation | Must |
| FR-05 | Asset export (atomic PNG → JSON) | Must |
| FR-06 | Engine hot-reloading & animation | Must |
| FR-07 | Job status & preview in UI | Should |
| FR-08 | Configuration management | Must |
| FR-09 | Logging & diagnostics | Should |
| FR-10 | Sprite gallery / regenerate | Could |

---

## 4. External interface requirements

### 4.1 User interface
- One page at `http://127.0.0.1:5000/` with:
  - a prompt field
  - a sprite name field
  - a grid preset (1×4, 1×6, 1×8, 2×4, 4×4)
  - a style preset (pixel art, cartoon, painterly)
  - a seed field (optional)
  - a Generate button
- Shows job progress (queued → generating → processing → exporting → done/failed), a preview of the result and any error in plain language.
- The C++ engine opens its own window. It shows every loaded sprite animating and has a small on-screen list of names.

### 4.2 Software interfaces
| Interface | Protocol | Detail |
|---|---|---|
| Browser ⇄ Flask | HTTP/JSON on localhost | [data-contracts.md §1](data-contracts.md) |
| Flask → image provider | Cloudflare / Hugging Face: HTTPS + bearer token. Local CPU: in-process call. | [data-contracts.md §4–5](data-contracts.md) |
| Flask → Engine | Files in the shared folder | [data-contracts.md §2](data-contracts.md) |

### 4.3 Hardware interfaces
None beyond a standard display and GPU-capable graphics driver for SFML.

### 4.4 Communication interfaces
- Outbound HTTPS only, with TLS certificate verification on.
- Flask listens on `127.0.0.1` only (see [security.md](security.md)).

---

## 5. Non-functional requirements

### 5.1 Performance
| ID | Requirement | Target |
|---|---|---|
| NFR-P1 | Local processing time (rembg + Pillow + export) per sprite | ≤ 10 s on CPU for a 1024×1024 image (first run may be longer while the rembg model downloads) |
| NFR-P2 | End-to-end time, prompt → on screen (warm model) | ≤ 90 s typical |
| NFR-P3 | Engine detects a new JSON after it is written | ≤ 1 s |
| NFR-P4 | Engine frame rate while scanning the folder | Stays ≥ 55 FPS with up to 50 sprites loaded |
| NFR-P5 | Folder scan cost | Scan runs at most every 500 ms, never every frame |

### 5.2 Reliability & availability
| ID | Requirement |
|---|---|
| NFR-R1 | The engine never crashes on a missing, partial, oversized or malformed asset. It logs the problem and skips the asset. |
| NFR-R2 | The engine never reads a half-written file (atomic temp-file + rename, PNG before JSON). |
| NFR-R3 | Provider errors (429, 503, timeouts, daily cap reached) are retried with backoff up to a limit, then sent to the fallback provider if configured, otherwise shown to the user as a clear failure. |
| NFR-R4 | A failed job leaves no partial files in the asset folder. |
| NFR-R5 | Backend restarts don't break the engine. Assets already exported stay valid. |

### 5.3 Usability
| ID | Requirement |
|---|---|
| NFR-U1 | A new developer can install and run both parts in ≤ 30 minutes by following [setup-guide.md](setup-guide.md). |
| NFR-U2 | Every error message in the UI says what failed and what to do next, e.g. "Model is loading, retry in ~30 s". |
| NFR-U3 | Default settings produce a usable result without tuning. |

### 5.4 Maintainability
| ID | Requirement |
|---|---|
| NFR-M1 | The AI provider sits behind one client module, so the model or provider can be swapped without changing other code. |
| NFR-M2 | Prompt templates live in a config/data file, not hard-coded in route handlers. |
| NFR-M3 | The JSON schema has a `schema_version` field. The engine ignores unknown keys. |
| NFR-M4 | Python is formatted and linted (ruff/black). C++ compiles with `-Wall -Wextra` (or `/W4`) and no warnings. |
| NFR-M5 | Unit tests cover processing, grid maths, schema validation and the engine's metadata parser. |

### 5.5 Portability
| ID | Requirement |
|---|---|
| NFR-PT1 | Both parts build and run on Windows 10/11 and Ubuntu 22.04+. |
| NFR-PT2 | Paths are handled with `pathlib` (Python) and `std::filesystem` (C++), never string concatenation. |

### 5.6 Security
Summarised here. Full detail is in [security.md](security.md).
- NFR-S1: secrets only from the environment or `.env`, which is git-ignored.
- NFR-S2: the server binds to localhost only, with debug mode off.
- NFR-S3: every user input that becomes part of a file name is restricted to a safe pattern.
- NFR-S4: the engine treats asset files as untrusted. It checks sizes, numbers and file names before using them.

---

## 6. Data requirements
- **Assets:** `<name>.png` (RGBA) and `<name>.json` per sprite in the shared folder.
- **Job state:** kept in memory for the MVP and lost on restart, which is acceptable.
- **Logs:** rotating log files in `backend/logs/` and engine output to the console or `engine.log`.
- **No personal data** is collected or stored.

---

## 7. Out of scope (MVP)
- Keeping the same character consistent across separate generations
- Multiple animation states (idle/walk/attack) inside one asset
- Editing or regenerating individual frames
- Hosting on a server, user accounts, asset library or history in a database
- Local GPU inference (allowed later as an alternative provider)
- Packaging the engine as a reusable library or plugin

---

## 8. Acceptance (MVP sign-off)
1. All "Must" requirements in [frd.md](frd.md) pass their acceptance criteria.
2. All NFRs marked P, R and S pass.
3. Every item on the release checklist in [implementation-plan.md](implementation-plan.md) and the checklist in [security.md](security.md) is ticked.
4. A recorded demo shows prompt → animated sprite in a running engine without a restart.
