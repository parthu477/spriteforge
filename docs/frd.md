# SpriteForge — Functional Requirements Document (FRD)

| Item | Value |
|---|---|
| Document | FRD |
| Version | 1.0 (draft) |
| Source | `SpriteForge_Project_Documentation.docx`, section 2 (FR-01 – FR-06). FR-07 – FR-10 are additions. |
| Related | [srs.md](srs.md) · [user-stories.md](user-stories.md) · [data-contracts.md](data-contracts.md) · [implementation-plan.md](implementation-plan.md) |

**Priority key:** Must = MVP blocker · Should = expected in MVP · Could = if time allows

---

## Requirement summary

| ID | Feature | Input → Output | Priority | Owner track |
|---|---|---|---|---|
| FR-01 | Prompt ingestion | User text + settings → `POST /api/generate` | Must | Python |
| FR-02 | AI sprite generation | Wrapped prompt → raw RGB image | Must | Python |
| FR-03 | Background removal | Raw RGB → transparent RGBA | Must | Python |
| FR-04 | Grid calculation | RGBA + chosen grid → normalised sheet + frame numbers | Must | Python |
| FR-05 | Asset export | PNG bytes + metadata → `.png` then `.json` on disk | Must | Python |
| FR-06 | Engine hot-reload | New/changed `.json` → `AnimatedSprite` on screen | Must | C++ |
| FR-07 | Job status & preview | Job id → status, progress, preview | Should | Python |
| FR-08 | Configuration | `.env` / `config.json` → runtime settings for both sides | Must | Both |
| FR-09 | Logging & diagnostics | Pipeline events → log files / console | Should | Both |
| FR-10 | Sprite gallery & regenerate | Asset folder → list + "regenerate with new seed" | Could | Python |

---

## FR-01 Prompt ingestion

**Description:** A local web page collects a prompt and generation settings and sends them to Flask. Flask validates them, creates a job and returns a job id straight away.

| Sub-ID | Requirement |
|---|---|
| FR-01.1 | The UI provides these fields: `prompt` (text), `name` (text), `grid` (preset select), `style` (preset select), `seed` (optional int). |
| FR-01.2 | The UI sends `POST /api/generate` with a JSON body (schema in [data-contracts.md §1.2](data-contracts.md)). |
| FR-01.3 | `prompt` is required, trimmed, 3–300 characters. Control characters are rejected. |
| FR-01.4 | `name` is optional. If empty, it is built from the prompt. It is turned into a slug matching `^[a-z0-9][a-z0-9_-]{0,47}$`. |
| FR-01.5 | `grid` must be one of the allowed presets: `1x4`, `1x6`, `1x8`, `2x4`, `4x4`. |
| FR-01.6 | `style` must be one of the configured presets. |
| FR-01.7 | `seed`, if given, is an integer from 0 to 2³²−1. |
| FR-01.8 | Valid requests get `202 Accepted` with `{job_id, status:"queued"}`. Invalid ones get `400` with field-level errors. |
| FR-01.9 | If the job queue is full (> `MAX_QUEUED_JOBS`), the server returns `429` with a "try again later" message. |
| FR-01.10 | The Generate button is disabled while a submit is in flight, to avoid double submits. |

**Acceptance criteria**
- [ ] Empty, whitespace-only or 301-character prompts return 400 with a message for the `prompt` field. The server never crashes.
- [ ] A name like `../../evil` becomes a safe slug (`evil`) or is rejected. It never reaches the file system unchanged.
- [ ] A valid request returns 202 in under 200 ms, without waiting for generation.

---

## FR-02 AI sprite generation

**Description:** The backend wraps the user prompt in a sprite-sheet template and calls the configured **image provider**: A Cloudflare Workers AI free tier, B local CPU model, or C Hugging Face paid ([costing.md](costing.md)). The default and fallback are chosen on Day 1 ([provider-evaluation.md](provider-evaluation.md)).

| Sub-ID | Requirement |
|---|---|
| FR-02.1 | The prompt builder combines: style preset prefix + user prompt + grid instruction (e.g. "sprite sheet, 4 frames in a single row, evenly spaced, same character in every frame") + "plain solid white background" + a negative prompt. |
| FR-02.2 | Output resolution is chosen from the grid so each cell is square, e.g. 1×4 → 1024×256 if the model supports it, otherwise 1024×1024 followed by cropping in FR-04. |
| FR-02.3 | The model id, endpoint URL, timeout and retry settings come from configuration (FR-08). |
| FR-02.4 | Cloud providers use `Authorization: Bearer <CF_API_TOKEN or HF_TOKEN>`, a timeout of `PROVIDER_TIMEOUT_S` (default 120 s) and TLS verification. The local CPU provider makes no network calls; its model loads once at startup. |
| FR-02.5 | On `503` (model loading) or `429` (rate limit), the backend retries with exponential backoff (2 s, 4 s, 8 s …) up to `PROVIDER_MAX_RETRIES` (default 3). It respects any `Retry-After` header. |
| FR-02.6 | On `401/403` it fails immediately with "Invalid or unauthorised provider token". |
| FR-02.7 | The response must be an image content type and at most `MAX_IMAGE_BYTES` (default 10 MB). Anything else fails the job. |
| FR-02.8 | The raw image is kept in memory only. Raw images are not written to the asset folder. |
| FR-02.9 | The seed (given or random) is recorded in the metadata so a result can be reproduced. If the provider ignores seeds, this is recorded too. |
| FR-02.10 | **Fallback:** if the default provider hits its daily free allowance, is unavailable after retries, or there is no network, the job is retried once with `FALLBACK_PROVIDER` (if set). The provider actually used is recorded in `metadata.source.provider`. |
| FR-02.11 | Output size comes from the provider (`max_side`: 1024 cloud, 512 local). Later stages use the actual image size, never a hard-coded one. |

**Acceptance criteria**
- [ ] A successful call produces a Pillow `Image` in RGB mode.
- [ ] Simulated 503 → 503 → 200 succeeds after the retries.
- [ ] A simulated timeout fails the job with a clear message within `PROVIDER_TIMEOUT_S × (retries + 1)`.
- [ ] A simulated "daily allowance reached" response sends the job to the fallback provider, and the result records which provider was used.
- [ ] With the network off and `FALLBACK_PROVIDER=local_cpu`, generation still succeeds.
- [ ] The token never appears in logs, error messages or API responses.

---

## FR-03 Background removal

**Description:** Remove the background so only the character remains on a transparent canvas.

| Sub-ID | Requirement |
|---|---|
| FR-03.1 | Run `rembg.remove()` using one shared session that is reused across jobs. The model is set by `REMBG_MODEL` (default `u2net`; try `isnet-anime` for cartoon styles). |
| FR-03.2 | The output is RGBA. |
| FR-03.3 | **Alpha check:** if fewer than 1% or more than 95% of pixels are non-transparent, mark the result as suspicious and fail the job with "Background removal produced an empty/full image". |
| FR-03.4 | Optional alpha clean-up: pixels with alpha < `ALPHA_THRESHOLD` (default 16) become fully transparent, to remove halos. |
| FR-03.5 | The rembg model is downloaded during setup, not during the first user request (see [setup-guide.md](setup-guide.md)). |

**Acceptance criteria**
- [ ] Given a test image of a character on a white background, the output has transparent corners and keeps the inside of the character (eyes, outlines).
- [ ] An all-white input fails at the alpha check instead of exporting an empty sprite.

---

## FR-04 Grid calculation & normalisation

**Description:** Turn the cleaned image into a sheet with an exact grid and work out the frame numbers.

| Sub-ID | Requirement |
|---|---|
| FR-04.1 | Rows and columns come from the **user-selected grid**, not guessed from the image size. |
| FR-04.2 | `frame_width = floor(image_width / columns)` and `frame_height = floor(image_height / rows)`. |
| FR-04.3 | The image is cropped (centred) or resized so that `width = frame_width × columns` and `height = frame_height × rows` exactly. |
| FR-04.4 | Optional `CELL_SIZE` (e.g. 64, 128): each cell is resized to `CELL_SIZE × CELL_SIZE`, using nearest-neighbour for the pixel-art style and Lanczos for the others. |
| FR-04.5 | `frame_count = rows × columns`, minus trailing empty cells (alpha coverage < 0.5%). Empty cells are only dropped from the end, never from the middle. |
| FR-04.6 | Optional alignment: centre each frame's bounding box within its cell so the character doesn't jitter between frames. |
| FR-04.7 | Final sheet dimensions must not exceed `MAX_TEXTURE_SIZE` (default 4096) on either side. |

**Acceptance criteria**
- [ ] For a 1000×250 input with grid 1×4, the output is 1000×250 with `frame_width=250`, `frame_height=250`, `frame_count=4`.
- [ ] For a 1023×1023 input with grid 2×2, the output is 1022×1022 (511×511 frames).
- [ ] If the last cell is empty, `frame_count` is 3, while `rows` and `columns` stay unchanged.
- [ ] Unit tests cover all of the above with synthetic images.

---

## FR-05 Asset export

**Description:** Write the sprite and its metadata to the shared asset folder so the engine never sees a partial file.

| Sub-ID | Requirement |
|---|---|
| FR-05.1 | Final file names are `<slug>_<shortid>.png` and `<slug>_<shortid>.json`, where `shortid` is the first 6 hex characters of the job id. |
| FR-05.2 | **Write order:** PNG → temp file `.<file>.png.tmp` → flush + `fsync` → `os.replace` to the final name. Then the same for the JSON. |
| FR-05.3 | The JSON follows schema v1 ([data-contracts.md §2](data-contracts.md)). Required keys: `image_file`, `frame_width`, `frame_height`, `rows`, `columns`, `frame_count`. |
| FR-05.4 | `image_file` holds the **file name only** (no folders), and it must match the PNG written in FR-05.2. |
| FR-05.5 | The export path is resolved, and the code checks it is inside `ASSET_DIR` before writing. |
| FR-05.6 | If the JSON write fails after the PNG was written, the PNG is deleted (no orphan files). |
| FR-05.7 | Temp files left over from a crash (`.*.tmp`) are removed when the backend starts. |

**Acceptance criteria**
- [ ] The JSON file's modified time is never earlier than the PNG's.
- [ ] Killing the process during export never leaves a final-named JSON without its PNG.
- [ ] The engine-side parser accepts every exported JSON (shared test fixtures).

---

## FR-06 Engine hot-reloading & animation

**Description:** The C++ game finds new or changed metadata files in the asset folder, loads them safely and plays them as looping animations.

| Sub-ID | Requirement |
|---|---|
| FR-06.1 | `AssetWatcher` scans `ASSET_DIR` with `std::filesystem::directory_iterator` at most every `SCAN_INTERVAL_MS` (default 500 ms), from the main loop. |
| FR-06.2 | Only regular files ending in `.json` are considered. Hidden or temp files (starting with `.` or ending in `.tmp`) are skipped. |
| FR-06.3 | A map `{path → last_write_time}` tracks loaded assets. New paths are loaded. Paths with a changed time are reloaded (true hot-reload). Already-processed paths are skipped. |
| FR-06.4 | A JSON file larger than 64 KB is rejected. Parsing is wrapped in try/catch: on failure, log, mark the file as failed (keyed by its time, so it is retried only if the file changes) and continue. |
| FR-06.5 | Validation: required keys are present and are integers; `1 ≤ rows, columns ≤ 16`; `1 ≤ frame_count ≤ rows × columns`; `1 ≤ frame_width, frame_height ≤ 4096`. |
| FR-06.6 | `image_file` must be a plain file name (no `/`, `\`, `..` or drive letter), must end in `.png`, and must exist in `ASSET_DIR`. Otherwise reject. |
| FR-06.7 | After loading the texture, check `columns × frame_width ≤ texture.width` and `rows × frame_height ≤ texture.height`. |
| FR-06.8 | `AnimatedSprite` builds frame rectangles row by row, plays at `fps` (default 8) and loops. |
| FR-06.9 | On reload, the existing sprite's texture and frames are replaced in place, keeping its position on screen. |
| FR-06.10 | Loading happens on the main thread. Only one asset is loaded per scan tick, so the frame rate doesn't stutter when many files arrive at once. |
| FR-06.11 | Sprites are arranged in an auto-layout grid with the name shown under each. Keys: `R` forces a rescan, `+`/`-` change the playback speed, `Esc` quits. |

**Acceptance criteria**
- [ ] Dropping a valid PNG and JSON into the folder makes the sprite appear within 1 s.
- [ ] A malformed JSON, missing PNG, `image_file: "../x.png"` or `frame_count: 999` is logged and ignored. The engine keeps running.
- [ ] Changing an existing JSON or PNG reloads that sprite. Nothing reloads in an endless loop.
- [ ] Holds ≥ 55 FPS with 50 sprites loaded.

---

## FR-07 Job status & preview *(addition)*

| Sub-ID | Requirement |
|---|---|
| FR-07.1 | `GET /api/jobs/<job_id>` returns `status`, `stage`, `error` (if any) and, when done, `metadata` plus a `preview_url`. |
| FR-07.2 | Stages, in order: `queued`, `generating`, `removing_background`, `processing`, `exporting`, then `done` or `failed`. |
| FR-07.3 | The UI polls every 1.5 s until `done` or `failed`, then shows the preview (animated in the browser with CSS/JS using the metadata) or the error. |
| FR-07.4 | Unknown job ids return 404. |
| FR-07.5 | Finished jobs stay in memory for `JOB_TTL_MIN` (default 60 minutes). |

## FR-08 Configuration *(addition)*

| Sub-ID | Requirement |
|---|---|
| FR-08.1 | The backend reads settings from environment variables, with a `.env` file for local development (keys in [data-contracts.md §3](data-contracts.md)). |
| FR-08.2 | `.env.example` is committed. `.env` is git-ignored. |
| FR-08.3 | The engine reads `engine/config.json` (`asset_dir`, `scan_interval_ms`, `default_fps`, window size). It falls back to defaults if the file is missing. |
| FR-08.4 | Startup fails fast with a clear message if the selected provider's settings are missing (e.g. `CF_API_TOKEN` for Cloudflare, the model folder for local CPU), or if `ASSET_DIR` doesn't exist or isn't writable. |

## FR-09 Logging & diagnostics *(addition)*

| Sub-ID | Requirement |
|---|---|
| FR-09.1 | The backend logs one line per job stage: job id, stage, how long it took and the result. Logs never contain the token. |
| FR-09.2 | The engine logs every load, reload, skip and failure with the file name and reason. |
| FR-09.3 | `GET /api/health` returns `{status:"ok", model, asset_dir_writable}`. |

## FR-10 Sprite gallery & regenerate *(addition, optional)*

| Sub-ID | Requirement |
|---|---|
| FR-10.1 | `GET /api/sprites` lists exported sprites (name, metadata, preview URL). |
| FR-10.2 | "Regenerate" re-submits the same prompt and settings with a new seed. |
| FR-10.3 | "Delete" removes the JSON first, then the PNG. The engine drops the sprite once its JSON is gone. |

---

## Traceability

| FR | Architecture component | Plan phase | Security controls |
|---|---|---|---|
| FR-01 | `routes/api.py`, `validators.py` | Phase 1 | S-03, S-04, S-05 |
| FR-02 | `services/providers/*`, `prompt_builder.py` | Phase 0, 1, 4 | S-01, S-07, S-10 |
| FR-03 | `services/processing.py` | Phase 2 | S-08 |
| FR-04 | `services/processing.py` | Phase 2 | S-08 |
| FR-05 | `services/exporter.py` | Phase 2 | S-04, S-06 |
| FR-06 | `AssetWatcher`, `SpriteMetadata`, `AnimatedSprite` | Phase 3 | S-09 |
| FR-07 | `jobs.py`, `routes/api.py`, `static/app.js` | Phase 1, 4 | S-05 |
| FR-08 | `config.py`, `engine/config.json` | Phase 0 | S-01 |
| FR-09 | `logging_setup.py`, engine `Log` | Phase 1, 3 | S-01 |
| FR-10 | `routes/api.py` | Phase 5 (optional) | S-04 |

The architecture components are described in [architecture.md](architecture.md), the phases in [implementation-plan.md](implementation-plan.md) and the security controls in [security.md](security.md).
