# SpriteForge — Detailed User Stories

| Document Information | Value |
|---|---|
| Document | Agile User Stories Specification |
| Version | 1.0 |
| Target System | SpriteForge (AI Game Asset Pipeline) |
| Source Artifacts | [srs.md](srs.md) · [frd.md](frd.md) · [architecture.md](architecture.md) · [data-contracts.md](data-contracts.md) · [implementation-plan.md](implementation-plan.md) · [security.md](security.md) · [costing.md](costing.md) · [provider-evaluation.md](provider-evaluation.md) |
| Methodology | Agile / Scrum / Extreme Programming (XP) |

---

## 1. User Personas

| Persona ID | Persona Role | Description & Core Objectives |
|---|---|---|
| **PER-1** | **Alex — Solo Indie Game Developer** | Focuses on rapid prototyping of core game mechanics. Needs quick placeholder sprites loaded directly into the game loop without context switching or manual slicing. |
| **PER-2** | **Elena — Technical Artist** | Explores prompt styles, negative prompts, aesthetic consistency, and grid layouts. Needs transparent backgrounds without halos and precise cell alignment. |
| **PER-3** | **Marcus — Level & Quest Designer** | Needs to populate game scenes with diverse character variants (monsters, NPCs) on demand, testing how they render alongside existing sprites in real-time. |
| **PER-4** | **Dave — Engine & Systems Programmer (C++)** | Maintains game stability, rendering pipeline performance, memory safety, and file I/O resilience. Requires zero engine crashes on corrupted or malicious asset files. |
| **PER-5** | **Sam — DevOps & Security Engineer** | Protects API tokens, enforces localhost sandboxing, verifies automated test coverage, and prevents supply-chain or denial-of-service vulnerabilities. |

---

## 2. Epic Overview & Architecture Traceability

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ EPIC 1: System  Foundation, Technical Spikes & Contracts (Phase 0 / Architecture)│
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 2: Prompt Ingestion, Web UI & Orchestration (FR-01, FR-07 / Layer 1)      │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 3: AI Sprite Generation & Multi-Provider Engine (FR-02 / Layer 2)          │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 4: Image Processing & Sprite Sheet Normalization (FR-03, FR-04 / Layer 3)  │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 5: Atomic Persistence & Inter-Process Hand-off (FR-05 / Layer 4)           │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 6: Native C++ Engine Ingestion & Live Hot-Reloading (FR-06 / Layer 5)      │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 7: Configuration Management, Security & Observability (FR-08, FR-09)       │
├─────────────────────────────────────────────────────────────────────────────────┤
│ EPIC 8: Gallery Management, Resiliency & Quality Assurance (FR-10 / Phase 5)   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Epic 1: System Foundation, Technical Spikes & Contracts

### US-01: Day-1 Provider Evaluation & Selection Spike
- **Story ID:** `US-01`
- **Track / Phase:** Phase 0 (Day 1 Spike)
- **Primary Persona:** `PER-1` (Game Developer), `PER-2` (Technical Artist)
- **Traceability:** [provider-evaluation.md](provider-evaluation.md), [costing.md](costing.md), ADR-05, ADR-09, Risk R-1

#### User Story
> **As an** engineer evaluating AI generation costs and quality,  
> **I want to** benchmark Cloudflare Workers AI (FLUX.1 schnell) against a local CPU model (SD-Turbo via OpenVINO) across 30 standardized test prompts,  
> **So that** we can empirically select the default and fallback image providers at zero budget (₹0) and verify multi-frame grid feasibility before writing production code.

#### Technical Specifications
- Test set: 10 prompts × 3 grid layouts (`1x4`, `2x4`, `4x4`) = 30 images per provider.
- Evaluate: generation latency (seconds/image), failure rate, grid adherence (1–5), character consistency (1–5), background cut cleanability (1–5).
- Test execution scripts stored in throwaway `spikes/` directory; credentials loaded strictly from `.env`. 
- Blind scoring session: files randomized and stripped of provider names.

#### Acceptance Criteria
- **AC 1.1:** Given configured credentials in `.env`, when running the Option A test script, it successfully calls the Cloudflare Workers AI endpoint and logs timing and error rates across all 30 prompts.
- **AC 1.2:** Given local CPU prerequisites installed, when running Option B, it converts and caches the OpenVINO model in `models/sd-turbo-ov` and generates all 30 prompts at 512×512 resolution.
- **AC 1.3:** Both developers blind-score the 60 generated images using the 1–5 rubric in `provider-evaluation.md`.
- **AC 1.4:** If Option A average score ≥ 3.0 with no blockers, Option A is tagged as `PROVIDER` and Option B as `FALLBACK_PROVIDER`.
- **AC 1.5:** Results, machine hardware specs, chosen rembg model, and winning prompt templates are permanently documented in `provider-evaluation.md`.

---

### US-02: Frozen Data Contracts & Shared Test Fixtures
- **Story ID:** `US-02`
- **Track / Phase:** Phase 0 (Day 1)
- **Primary Persona:** `PER-1` (Python Dev), `PER-4` (C++ Dev)
- **Traceability:** [data-contracts.md](data-contracts.md), [architecture.md](architecture.md) ADR-08, [srs.md](srs.md) C-3

#### User Story
> **As a** cross-language development team (Python and C++),  
> **I want to** establish a machine-readable JSON Schema (v1.0) and a comprehensive suite of valid and invalid fixture files in a shared folder,  
> **So that** both the backend exporter and the game engine can be developed and unit-tested in parallel without blocking each other.

#### Technical Specifications
- JSON Schema Draft 2020-12 stored at `shared/sprite.schema.json`.
- Required attributes: `image_file`, `frame_width`, `frame_height`, `rows`, `columns`, `frame_count`.
- Optional/informational attributes: `schema_version`, `name`, `fps`, `loop`, `source`.
- Test fixtures created in `shared/fixtures/`: `valid_1x4.json`, `valid_2x4_partial.json`, `invalid_missing_key.json`, `invalid_traversal.json`, `invalid_frame_count.json`, `invalid_types.json`, `huge.json`, `malformed.json`, and `orphan.json`.

#### Acceptance Criteria
- **AC 2.1:** `shared/sprite.schema.json` enforces all field types, numerical ranges (`1 ≤ rows, columns ≤ 16`, `1 ≤ frame_width, frame_height ≤ 4096`), and filename pattern `^[a-z0-9][a-z0-9_-]{0,63}\.png$`.
- **AC 2.2:** Python unit tests validate `valid_*.json` against `shared/sprite.schema.json` using the `jsonschema` library and assert `True`.
- **AC 2.3:** C++ unit test suite (`engine/tests/`) parses all valid and invalid fixtures using `SpriteMetadata::parse()`, verifying valid fixtures succeed and invalid ones fail gracefully without throwing uncaught exceptions.
- **AC 2.4:** Any contract modification requires an agreed version bump in `data-contracts.md` and synchronization of both test suites.

---

## Epic 2: Prompt Ingestion, Web UI & Orchestration

### US-03: Web UI for Sprite Prompt & Parameter Submission
- **Story ID:** `US-03`
- **Track / Phase:** Python Track / Phase 1
- **Primary Persona:** `PER-1` (Game Developer), `PER-2` (Technical Artist)
- **Traceability:** FR-01.1, FR-01.10, Security S-03, Security S-05

#### User Story
> **As a** game developer or artist,  
> **I want to** access a clean, local browser interface to enter prompts and select sprite configuration presets (grid, style, seed),  
> **So that** I can trigger the asset creation workflow without modifying code or executing CLI commands.

#### Technical Specifications
- Served at `http://127.0.0.1:5000/`.
- UI Fields:
  - `prompt` (textarea, required, character counter 3–300)
  - `name` (text input, optional, helper tooltip for slugification)
  - `grid` (select dropdown: `1x4`, `1x6`, `1x8`, `2x4`, `4x4`, default: `1x4`)
  - `style` (select dropdown: `pixel_art`, `cartoon`, `painterly`, default: `pixel_art`)
  - `seed` (numeric input, optional, 0 to 4,294,967,295)
- Action: "Generate Sprite" submit button.
- Embedded `X-CSRF-Token` in `<meta name="csrf-token" content="...">` passed in request headers.

#### Acceptance Criteria
- **AC 3.1:** Given the user opens `http://127.0.0.1:5000/`, when the page loads, all input fields are displayed with correct default presets.
- **AC 3.2:** When the user clicks "Generate Sprite", the submit button is immediately disabled and displays a loading state to prevent duplicate submissions.
- **AC 3.3:** If client-side validation fails (e.g., prompt < 3 characters or > 300 characters), submission is blocked and an inline error highlights the offending field.
- **AC 3.4:** The UI sets text content strictly via `textContent` (never `innerHTML`) to prevent Cross-Site Scripting (XSS).

---

### US-04: API Request Ingestion, Validation & Slugification
- **Story ID:** `US-04`
- **Track / Phase:** Python Track / Phase 1
- **Primary Persona:** `PER-1` (Developer), `PER-5` (Security Engineer)
- **Traceability:** FR-01.2 – FR-01.8, Security S-04, Security S-05, NFR-S3

#### User Story
> **As an** API orchestration layer,  
> **I want to** strictly validate incoming JSON payloads, sanitize sprite names into safe slugs, and verify CSRF tokens and Origin headers,  
> **So that** invalid requests are rejected with clear 400 errors and malicious path traversal attacks are neutralized.

#### Technical Specifications
- Endpoint: `POST /api/generate` (`Content-Type: application/json`, max body 4 KB).
- Validation Rules:
  - `prompt`: stripped string, 3 ≤ length ≤ 300, control characters (`\x00`–`\x1F`) rejected.
  - `name`: if provided, sanitized into slug matching `^[a-z0-9][a-z0-9_-]{0,47}$`. Disallow Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`). If omitted, auto-generate slug from first 30 characters of prompt.
  - `grid`: strictly in `{'1x4', '1x6', '1x8', '2x4', '4x4'}`.
  - `style`: strictly matches available presets in `prompts/presets.yaml`.
  - `seed`: integer between `0` and `4294967295`. Random uint32 generated if omitted.
- CSRF validation: checks `X-CSRF-Token` against session token; checks `Origin` matches `http://127.0.0.1:5000` or `http://localhost:5000`.

#### Acceptance Criteria
- **AC 4.1:** Given a payload with prompt `""` or `301` characters, when `POST /api/generate` is invoked, it responds with `HTTP 400 Bad Request` and `{"error": "validation_error", "fields": {"prompt": "..."}}`.
- **AC 4.2:** Given a name containing path traversal characters like `../../evil_asset`, the slugifier converts it safely to `evil_asset` or rejects it, never allowing directory traversal.
- **AC 4.3:** Given a request with missing/invalid CSRF token or foreign `Origin: http://malicious-site.com`, the server returns `HTTP 403 Forbidden`.
- **AC 4.4:** Given a valid request, the endpoint enqueues a background job and responds within < 200 ms with `HTTP 202 Accepted` and `{"job_id": "<uuid4_hex>", "status": "queued"}`.

---

### US-05: Asynchronous Background Job Queue & Lifecycle Management
- **Story ID:** `US-05`
- **Track / Phase:** Python Track / Phase 1
- **Primary Persona:** `PER-1` (Game Developer), `PER-5` (Security Engineer)
- **Traceability:** FR-01.5, FR-01.9, FR-07.2, FR-07.5, Architecture Layer 1, ADR-07

#### User Story
> **As a** backend service running on developer hardware,  
> **I want to** process generation jobs through a controlled, single-worker in-memory thread pool with queue capping and automatic TTL cleanup,  
> **So that** resource-heavy generation tasks never overload the CPU, exceed API rate limits, or leak memory.

#### Technical Specifications
- `JobStore` class backed by an in-memory dictionary protected with `threading.Lock()`.
- Thread execution: `concurrent.futures.ThreadPoolExecutor(max_workers=JOB_WORKERS)` (default `1`).
- Queue limit: `MAX_QUEUED_JOBS` (default `5`). If exceeded, return `HTTP 429 Too Many Requests`.
- Lifecycle stages: `queued` → `generating` → `removing_background` → `processing` → `exporting` → `done` (or `failed`).
- Cleanup: finished/failed jobs retained for `JOB_TTL_MIN` (default 60 minutes) and purged by periodic scavenger.

#### Acceptance Criteria
- **AC 5.1:** When 6 concurrent requests arrive while worker is busy, the 6th request immediately receives `HTTP 429` with message `"Job queue is full. Please try again later."`.
- **AC 5.2:** Each job records timestamp, current stage, error object (if failed), execution duration (ms), and final metadata.
- **AC 5.3:** Job state transitions occur sequentially, and polling reflects the real-time stage update.
- **AC 5.4:** Server restart gracefully resets in-memory jobs without corrupting existing filesystem assets.

---

### US-06: Job Status Polling & In-Browser Animated Preview
- **Story ID:** `US-06`
- **Track / Phase:** Python Track / Phase 1 & 4
- **Primary Persona:** `PER-1` (Game Developer), `PER-2` (Technical Artist)
- **Traceability:** FR-07.1 – FR-07.4, NFR-U2

#### User Story
> **As a** user who submitted a generation prompt,  
> **I want to** observe real-time progress through distinct pipeline stages and immediately see a looping animated preview in the browser upon completion,  
> **So that** I get continuous feedback without refreshing the page and can review the animation before checking the game window.

#### Technical Specifications
- Endpoint: `GET /api/jobs/<job_id>`. Returns 200 with JSON status or 404 if invalid/expired.
- Client-side polling interval: 1.5 seconds while status is `queued` or `running`.
- Preview endpoint: `GET /api/sprites/<image_file>` returning `image/png`.
- Browser Animation: Uses CSS `animation` with `steps(frame_count)` or HTML5 Canvas rendering `frame_width` × `frame_height` at `fps` (default 8).

#### Acceptance Criteria
- **AC 6.1:** While the job is running, the UI displays the active stage name (e.g., "Removing background...", "Normalizing grid...").
- **AC 6.2:** If the job succeeds (`status: "done"`), the UI displays total duration, metadata details, and an animated sprite preview looping at the specified FPS.
- **AC 6.3:** If the job fails (`status: "failed"`), the UI terminates polling and displays a human-actionable error message (e.g., "Daily free allowance reached; falling back to local CPU" or "Background removal failed: character lacked contrast").
- **AC 6.4:** Requesting an unknown `job_id` returns `HTTP 404 Not Found`.

---

## Epic 3: AI Sprite Generation & Multi-Provider Engine

### US-07: Sprite Sheet Prompt Wrapping & Preset Builder
- **Story ID:** `US-07`
- **Track / Phase:** Python Track / Phase 1 & 4
- **Primary Persona:** `PER-2` (Technical Artist)
- **Traceability:** FR-02.1, FR-02.2, NFR-M2

#### User Story
> **As a** prompt engineering module,  
> **I want to** assemble user prompts with curated style presets, explicit grid instructions, solid background constraints, and negative prompt filtering,  
> **So that** raw text prompts are conditioned to produce evenly spaced, multi-frame sprite sheets suitable for automated slicing.

#### Technical Specifications
- Presets stored in `backend/prompts/presets.yaml`.
- Template structure:
  ```
  <style_prefix>, sprite sheet of <prompt>, <rows> rows and <columns> columns of evenly spaced frames,
  same character in every frame, side view, full body, plain solid white background, no text, no border
  ```
- Negative prompt:
  ```
  text, watermark, border, frame lines, multiple different characters, cropped, blurry, distorted limbs
  ```
- Styles supported: `pixel_art` ("16-bit retro pixel art, crisp pixels, clean outlines"), `cartoon` ("vibrant 2D vector cartoon, bold ink lines"), `painterly` ("hand-painted digital illustration").
- Aspect ratio computation: adjusts target dimensions if supported (e.g., `1x4` -> 1024×256) or defaults to square 1024×1024.

#### Acceptance Criteria
- **AC 7.1:** Given a user prompt `"knight walking"` and grid `1x4`, `PromptBuilder.build()` injects `"1 rows and 4 columns of evenly spaced frames"` and the style prefix.
- **AC 7.2:** Negative prompt is attached to provider calls that accept negative prompts.
- **AC 7.3:** Changing preset definitions in `presets.yaml` does not require modifying Python application code.

---

### US-08: Cloudflare Workers AI Primary Provider (FLUX.1 schnell)
- **Story ID:** `US-08`
- **Track / Phase:** Python Track / Phase 1
- **Primary Persona:** `PER-1` (Game Developer), `PER-5` (Security Engineer)
- **Traceability:** FR-02.3 – FR-02.9, Costing Option A, Security S-01, Security S-08

#### User Story
> **As a** cloud image generation client,  
> **I want to** integrate Cloudflare Workers AI running FLUX.1 schnell with automatic exponential backoff, Bearer authentication, and byte verification,  
> **So that** high-quality sprite sheets are generated in the cloud at zero service cost within the 10,000 daily neuron allowance.

#### Technical Specifications
- Class: `CloudflareProvider` implementing `ImageProvider` base class.
- Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`.
- Headers: `Authorization: Bearer {CF_API_TOKEN}`, `Content-Type: application/json`.
- Body: `{"prompt": "<prompt>", "steps": 4, "seed": <seed>}`.
- Timeout: `PROVIDER_TIMEOUT_S` (120 s); Retries: `PROVIDER_MAX_RETRIES` (3) with exponential backoff (`2s`, `4s`, `8s`) on HTTP 429, 503, or connection timeouts. Respects `Retry-After`.
- Safety: enforces max response size of 10 MB (`MAX_IMAGE_BYTES`); checks `Content-Type` is image or valid JSON base64. Token redaction filter in logs.

#### Acceptance Criteria
- **AC 8.1:** Given valid Cloudflare credentials, a successful API call decodes the response into a PIL RGB Image.
- **AC 8.2:** If Cloudflare returns HTTP 503 (model loading) or 429 (rate limit), the client retries up to 3 times before failing or triggering fallback.
- **AC 8.3:** If Cloudflare returns HTTP 401/403, the client fails immediately with error code `provider_auth` without retrying.
- **AC 8.4:** The `CF_API_TOKEN` is never printed to logs, console, or client error payloads even during exceptions.
- **AC 8.5:** Responses larger than 10 MB or non-image types trigger `provider_bad_response`.

---

### US-09: Local CPU Fallback Provider (SD-Turbo via OpenVINO)
- **Story ID:** `US-09`
- **Track / Phase:** Python Track / Phase 1 & 4
- **Primary Persona:** `PER-1` (Indie Developer), `PER-4` (Systems Developer)
- **Traceability:** FR-02.10, Costing Option B, SRS C-1, Architecture ADR-09

#### User Story
> **As a** resilient generation pipeline,  
> **I want to** support an in-process local CPU model using SD-Turbo and OpenVINO that loads weights once at startup,  
> **So that** sprite generation continues uninterrupted when offline, during cloud outages, or when Cloudflare's daily free allowance is exhausted.

#### Technical Specifications
- Class: `LocalCpuProvider` implementing `ImageProvider`.
- Model: `stabilityai/sd-turbo` exported to OpenVINO IR format (`models/sd-turbo-ov`).
- Runtime: `optimum.intel.OVStableDiffusionPipeline` on `LOCAL_DEVICE=cpu`.
- Inference parameters: `num_inference_steps=1`, `guidance_scale=0.0`, resolution 512×512.
- Startup check: verifies model weights directory exists; if missing when `PROVIDER=local_cpu`, backend fails fast with setup instructions.

#### Acceptance Criteria
- **AC 9.1:** Pipeline loads weights into memory once during process startup and generates 512×512 images without internet connectivity.
- **AC 9.2:** Generation operates strictly within CPU memory without requiring an NVIDIA GPU.
- **AC 9.3:** If Cloudflare provider returns daily quota exceeded error, the pipeline automatically redirects the request to `LocalCpuProvider` and flags `metadata.source.provider = "local_cpu"`.
- **AC 9.4:** Out-of-memory or pipeline execution failures report `provider_local_error` cleanly to the job store.

---

## Epic 4: Image Processing & Sprite Sheet Normalization

### US-10: Automated Background Removal & Alpha Verification
- **Story ID:** `US-10`
- **Track / Phase:** Python Track / Phase 2
- **Primary Persona:** `PER-2` (Technical Artist), `PER-1` (Game Developer)
- **Traceability:** FR-03.1 – FR-03.5, Security S-08, NFR-P1

#### User Story
> **As an** image processing service,  
> **I want to** strip solid backgrounds using an ONNX rembg session and verify alpha channel coverage,  
> **So that** only clean character sprites with transparent backgrounds are passed to the game engine, while corrupted cut-outs fail fast.

#### Technical Specifications
- Uses `rembg.new_session(REMBG_MODEL)` (reusing a single instance across all requests to eliminate initialization overhead).
- Supported models: `u2net` (default) and `isnet-anime`.
- Output converted to RGBA mode.
- Alpha coverage integrity check:
  $$\text{Coverage} = \frac{\text{Count of pixels with } \alpha > 0}{\text{Total Pixels}}$$
  - If $\text{Coverage} < 0.01$ (empty image) or $\text{Coverage} > 0.95$ (solid/unremoved background), reject with `bg_removal_failed`.
- Alpha threshold cleanup: pixels with $0 < \alpha < \text{ALPHA\_THRESHOLD}$ (default 16) clamped to $\alpha = 0$ to eliminate anti-aliasing color halos.

#### Acceptance Criteria
- **AC 10.1:** An input image of a character on a solid white background results in an RGBA image where background pixels have $\alpha = 0$ and character outlines remain intact.
- **AC 10.2:** An all-white or blank image triggers an immediate `bg_removal_failed` error and aborts the job before exporting.
- **AC 10.3:** The rembg model is verified as pre-cached during environment startup to avoid runtime download stalls.
- **AC 10.4:** Total background removal processing time on CPU is ≤ 10 seconds for a 1024×1024 image.

---

### US-11: User-Defined Grid Snapping, Frame Trimming & Alignment
- **Story ID:** `US-11`
- **Track / Phase:** Python Track / Phase 2
- **Primary Persona:** `PER-2` (Technical Artist), `PER-4` (C++ Engine Dev)
- **Traceability:** FR-04.1 – FR-04.7, Risk R-2, Architecture ADR-06

#### User Story
> **As an** asset normalization module,  
> **I want to** slice the transparent sprite sheet according to user-selected rows and columns, compute integer frame dimensions, trim trailing empty cells, and center frame bounding boxes,  
> **So that** the final sprite sheet adheres to exact pixel dimensions and plays back without jitter in the game engine.

#### Technical Specifications
- Grid parameters: `rows`, `columns` passed from user request (never guessed).
- Mathematical calculations:
  $$\text{frame\_width} = \lfloor \text{image\_width} / \text{columns} \rfloor$$
  $$\text{frame\_height} = \lfloor \text{image\_height} / \text{rows} \rfloor$$
  - Image is cropped or resized to exact multiple: $\text{width} = \text{frame\_width} \times \text{columns}$, $\text{height} = \text{frame\_height} \times \text{rows}$.
- Optional `CELL_SIZE` snapping: if configured (e.g. 64 or 128), each cell is resized using nearest-neighbor (for `pixel_art`) or Lanczos (for other styles).
- Trailing frame trimming: iterates backwards from the last cell. If cell alpha density < 0.5%, it is dropped from `frame_count`. Empty cells in the middle are never dropped.
- Bounding box centering: centers the non-transparent bounding box within each cell to eliminate frame-to-frame jitter.
- Max dimension limit: sheet dimensions cannot exceed `MAX_TEXTURE_SIZE` (4096 px).

#### Acceptance Criteria
- **AC 11.1:** Given a 1000×250 input and grid `1x4`, output is exactly 1000×250 with `frame_width=250`, `frame_height=250`, and `frame_count=4`.
- **AC 11.2:** Given a 1023×1023 input with grid `2x2`, output is cropped to 1022×1022 with 511×511 frames.
- **AC 11.3:** If cell 4 in a 1×4 grid is completely transparent, `frame_count` is set to 3 while `rows=1` and `columns=4` remain unchanged.
- **AC 11.4:** Pixel art sheets resized with `CELL_SIZE` maintain razor-sharp pixel edges without blur or anti-aliasing artifacts.

---

## Epic 5: Atomic Persistence & Inter-Process Hand-off

### US-12: Atomic File Export with PNG-Before-JSON Sequencing
- **Story ID:** `US-12`
- **Track / Phase:** Python Track / Phase 2
- **Primary Persona:** `PER-4` (C++ Engine Dev), `PER-5` (Security Engineer)
- **Traceability:** FR-05.1 – FR-05.7, Security S-04, Security S-06, Architecture ADR-02

#### User Story
> **As an** asset exporter service,  
> **I want to** write assets to disk using temporary files, OS flushes, and atomic renames, writing the `.png` first and the `.json` second,  
> **So that** the external C++ engine never encounters half-written files, torn reads, or orphaned assets.

#### Technical Specifications
- Target folder: `ASSET_DIR` resolved to an absolute path at startup.
- Filename convention: `<slug>_<shortid>.png` and `<slug>_<shortid>.json` where `shortid` is the first 6 hex characters of `job_id`.
- Export protocol:
  1. Write PNG data to `.<slug>_<shortid>.png.tmp`.
  2. Flush and `os.fsync()`.
  3. `os.replace()` to final filename `<slug>_<shortid>.png`.
  4. Write JSON metadata to `.<slug>_<shortid>.json.tmp`.
  5. Flush and `os.fsync()`.
  6. `os.replace()` to final filename `<slug>_<shortid>.json`.
- Rollback: if JSON write fails after PNG was created, the PNG is immediately deleted.
- Startup hygiene: any residual `.*.tmp` files in `ASSET_DIR` are deleted on backend initialization.
- Containment: paths are checked with `pathlib.Path.resolve().is_relative_to(ASSET_DIR)`.

#### Acceptance Criteria
- **AC 12.1:** The filesystem modified timestamp of `<name>.json` is guaranteed to be equal to or greater than `<name>.png`.
- **AC 12.2:** Simulating a process kill or disk exception during JSON generation leaves zero orphaned `.png` or final `.json` files in `ASSET_DIR`.
- **AC 12.3:** Temporary files start with `.` so the C++ file watcher ignores them completely during write operations.
- **AC 12.4:** Exporting with a malicious slug attempting `../../system32/` throws a security exception and never writes outside `ASSET_DIR`.

---

## Epic 6: Native C++ Engine Ingestion & Live Hot-Reloading

### US-13: Throttled Filesystem Polling & JSON Metadata Parsing
- **Story ID:** `US-13`
- **Track / Phase:** Engine Track (C++) / Phase 3
- **Primary Persona:** `PER-4` (C++ Engine Dev)
- **Traceability:** FR-06.1 – FR-06.6, Security S-09, Architecture ADR-04, NFR-P3, NFR-P5

#### User Story
> **As an** engine asset watcher,  
> **I want to** poll the asset folder every 500 ms for new `.json` metadata files, enforcing size caps and strict schema validation,  
> **So that** new assets are detected within 1 second while completely safeguarding the engine from crashes due to invalid or malformed files.

#### Technical Specifications
- Class: `AssetWatcher` in `engine/src/AssetWatcher.cpp`.
- Polling frequency: throttled using delta-time accumulator to execute every `scan_interval_ms` (default 500 ms), never every frame.
- Scanning logic: uses `std::filesystem::directory_iterator` with `std::error_code` overloads.
- Filtering: considers only regular files ending with `.json`; ignores files starting with `.` or ending with `.tmp`.
- Memory tracking: maintains `std::unordered_map<std::filesystem::path, std::filesystem::file_time_type> seen`.
- Rate control: pops at most ONE asset per scan tick into the loading queue to prevent frame drops.
- `SpriteMetadata::parse(path)` rules:
  - File size check: reject files > 64 KB before parsing.
  - Parse with `nlohmann::json::parse()` inside `try/catch`.
  - Validate required keys: `image_file`, `frame_width`, `frame_height`, `rows`, `columns`, `frame_count`.
  - Type checking with `is_number_integer()` and range checks (`1 ≤ rows, columns ≤ 16`, `1 ≤ frame_count ≤ rows * columns`).
  - `image_file` must be a bare filename matching `^[a-z0-9][a-z0-9_-]{0,63}\.png$` (reject `/`, `\`, `..`, `:`).

#### Acceptance Criteria
- **AC 13.1:** When a valid JSON and PNG are placed in `ASSET_DIR`, the engine detects and queues the asset within ≤ 1 second.
- **AC 13.2:** A corrupted or truncated JSON file logs a descriptive warning and marks the file as seen at its current timestamp without crashing the engine.
- **AC 13.3:** A JSON file exceeding 64 KB is rejected prior to parsing.
- **AC 13.4:** An `image_file` referencing `"../secret.png"` or `"C:\\Windows\\win.ini"` is rejected during path validation.
- **AC 13.5:** If the associated `.png` file does not yet exist on disk, the watcher logs a warning, skips loading, and retries on subsequent ticks up to a max retry limit.

---

### US-14: Texture Loading, Frame Rect Slicing & AnimatedSprite Playback
- **Story ID:** `US-14`
- **Track / Phase:** Engine Track (C++) / Phase 3
- **Primary Persona:** `PER-1` (Game Developer), `PER-4` (C++ Engine Dev)
- **Traceability:** FR-06.7 – FR-06.8, Architecture Layer 5, ADR-03

#### User Story
> **As a** 2D sprite rendering component,  
> **I want to** load the sprite texture on the OpenGL main thread, verify dimensions against metadata, build frame clipping rectangles, and animate playback at a target FPS,  
> **So that** sprite animations loop smoothly on screen with zero visual artifacts.

#### Technical Specifications
- Class: `AnimatedSprite` in `engine/src/AnimatedSprite.cpp` utilizing SFML 2.6.x `sf::Sprite` and `sf::Texture`.
- Texture validation: checks `columns * frame_width <= texture.getSize().x` and `rows * frame_height <= texture.getSize().y`.
- Frame calculation:
  - Row-by-row traversal:
    $$\text{left} = (i \pmod{\text{columns}}) \times \text{frame\_width}$$
    $$\text{top} = (\lfloor i / \text{columns} \rfloor) \times \text{frame\_height}$$
  - Creates `std::vector<sf::IntRect>` for $i \in [0, \text{frame\_count} - 1]$.
- Playback logic: `update(float dt)` tracks elapsed time. When `elapsed >= 1.0f / fps`, advances `current_frame = (current_frame + 1) % frame_count` and updates `sprite.setTextureRect()`.
- Rendering: `draw(sf::RenderTarget& target, sf::RenderStates states)` draws the sprite and optional text label.

#### Acceptance Criteria
- **AC 14.1:** Given a valid 4-frame walk cycle, `AnimatedSprite` cycles through all 4 frames sequentially and loops back to frame 0.
- **AC 14.2:** If metadata specifies dimensions larger than the actual PNG image dimensions, texture loading fails, an error is logged, and the sprite is rejected.
- **AC 14.3:** Sprite animation runs at configured `fps` (default 8) regardless of engine monitor refresh rate (60 Hz, 144 Hz).
- **AC 14.4:** Memory for replaced or dropped textures is properly released without GPU or RAM leaks.

---

### US-15: In-Place Hot-Reloading, Asset Deletion & Scene Layout
- **Story ID:** `US-15`
- **Track / Phase:** Engine Track (C++) / Phase 3
- **Primary Persona:** `PER-1` (Game Developer), `PER-3` (Level Designer)
- **Traceability:** FR-06.9 – FR-06.11, NFR-P4, NFR-R1

#### User Story
> **As an** interactive testbed and scene manager,  
> **I want to** reload modified sprites in place, remove deleted sprites, layout all loaded sprites in an auto-arranged grid, and provide interactive playback speed controls,  
> **So that** I can observe live updates to character art while the game continues running at high frame rates.

#### Technical Specifications
- Class: `SpriteRegistry` and `Scene` in `engine/src/`.
- Hot-reload mechanism: if `last_write_time(json)` changes for an existing asset, the texture and frame rectangles are updated in-place without altering the sprite's position on screen.
- Deletion mechanism: if a `.json` file that was previously tracked disappears from the directory, its instance is safely removed from `SpriteRegistry`.
- Auto-layout: arranges loaded sprites in a grid across the SFML window, rendering the sprite name underneath using an SIL OFL font.
- Interactive keyboard controls:
  - `R`: Forces an immediate directory rescan.
  - `+` / `=`: Increases global animation playback speed by 1 FPS.
  - `-`: Decreases global animation playback speed by 1 FPS (min 1 FPS).
  - `Esc`: Closes the game window cleanly.
- Performance requirement: maintains ≥ 55 FPS with up to 50 animated sprites loaded on screen simultaneously.

#### Acceptance Criteria
- **AC 15.1:** Modifying an existing JSON file on disk immediately hot-reloads the animation in the running engine without repositioning or flickering.
- **AC 15.2:** Deleting `<name>.json` from the asset folder causes the sprite to disappear from the scene on the subsequent scan tick.
- **AC 15.3:** Stress testing with 50 loaded sprites maintains a steady frame rate ≥ 55 FPS on standard development hardware.
- **AC 15.4:** Pressing `+` and `-` adjusts playback speed dynamically across all active sprites.

---

## Epic 7: Configuration Management, Security & Observability

### US-16: Centralized Configuration & Fail-Fast Startup Checks
- **Story ID:** `US-16`
- **Track / Phase:** Shared / Phase 0 & 1
- **Primary Persona:** `PER-5` (DevOps / Security Engineer), `PER-1` (Developer)
- **Traceability:** FR-08.1 – FR-08.4, Security S-01, Security S-02, [setup-guide.md](setup-guide.md)

#### User Story
> **As a** developer launching the application,  
> **I want to** configure system settings via `.env` (backend) and `config.json` (engine) with automated fail-fast validation,  
> **So that** missing API tokens, invalid directory paths, or insecure network bindings are caught immediately at boot before errors occur at runtime.

#### Technical Specifications
- Backend configuration: `backend/config.py` using `python-dotenv`.
  - `.env.example` committed to git with dummy values; `.env` verified as git-ignored.
  - Enforces `FLASK_HOST=127.0.0.1` and `FLASK_DEBUG=False`.
  - Verifies `ASSET_DIR` exists and is writable; if not, attempts `mkdir -p` or fails with exit code 1.
  - Validates required credentials based on `PROVIDER` setting (e.g., checks `CF_API_TOKEN` if `PROVIDER=cloudflare`, checks `LOCAL_MODEL_DIR` if `PROVIDER=local_cpu`).
- Engine configuration: `engine/config.json`.
  - Keys: `asset_dir`, `scan_interval_ms`, `default_fps`, `window_width`, `window_height`.
  - Falls back to built-in defaults if `config.json` is missing.

#### Acceptance Criteria
- **AC 16.1:** Starting the backend with an empty `.env` and `PROVIDER=cloudflare` prints `"Configuration Error: CF_API_TOKEN is required for Cloudflare provider"` and terminates with non-zero exit code.
- **AC 16.2:** Starting the backend when `ASSET_DIR` points to a read-only or invalid path terminates with a clear, actionable error message.
- **AC 16.3:** The backend binds strictly to loopback (`127.0.0.1:5000`) and refuses to start on `0.0.0.0` unless `ALLOW_REMOTE=1` is explicitly set.
- **AC 16.4:** `git status` verifies `.env` is untracked and ignored by `.gitignore`.

---

### US-17: Structured Logging with Token Redaction & Health Endpoint
- **Story ID:** `US-17`
- **Track / Phase:** Shared / Phase 1
- **Primary Persona:** `PER-5` (Security Engineer), `PER-4` (C++ Engine Dev)
- **Traceability:** FR-09.1 – FR-09.3, Security S-01, Security S-11

#### User Story
> **As an** operator diagnosing system behavior,  
> **I want to** inspect structured log streams with automated token redaction and query a `/api/health` diagnostic endpoint,  
> **So that** pipeline stages and engine events are transparent without risking accidental credential leaks.

#### Technical Specifications
- Backend logging: `backend/logging_setup.py`.
  - Format: `[%(asctime)s] [%(levelname)s] [job=%(job_id)s] %(message)s`.
  - Outputs to console and rotating log file in `backend/logs/spriteforge.log` (max 5 MB, 3 backups).
  - Redaction filter regex intercepts Bearer tokens, Cloudflare API tokens, and Hugging Face tokens (`hf_[A-Za-z0-9]{34}`), replacing them with `[REDACTED]`.
- Health endpoint: `GET /api/health`.
  - Returns JSON: `{"status": "ok", "provider": "cloudflare", "fallback_provider": "local_cpu", "model": "flux-1-schnell", "asset_dir_writable": true, "queue_depth": 0}`.
- Engine logging: `engine/src/Log.cpp` outputs timestamped operational messages to stdout and `engine.log`.

#### Acceptance Criteria
- **AC 17.1:** Calling `GET /api/health` returns `HTTP 200 OK` with JSON telemetry confirming provider status and disk writability.
- **AC 17.2:** Triggering an intentional HTTP exception on Cloudflare API logs the error details while replacing the Bearer token with `[REDACTED]`.
- **AC 17.3:** Engine logs every asset load, reload, skip, and validation error with precise path and timestamp.

---

## Epic 8: Gallery Management, Resiliency & Quality Assurance

### US-18: Sprite Gallery, Re-Roll Seed & Asset Deletion
- **Story ID:** `US-18`
- **Track / Phase:** Python Track / Phase 5 (Optional FR-10)
- **Primary Persona:** `PER-1` (Game Developer), `PER-2` (Technical Artist)
- **Traceability:** FR-10.1 – FR-10.3, Data Contracts §1.1

#### User Story
> **As a** user organizing generated content,  
> **I want to** view a gallery of previously generated sprites, re-roll generations with a new random seed, and delete unwanted sprites,  
> **So that** I can manage my local sprite library and clean up experimental prototype art.

#### Technical Specifications
- Endpoint `GET /api/sprites`: scans `ASSET_DIR`, parses metadata files, and returns a JSON list of available sprites with image URLs and generation metadata.
- Re-roll action: clones the original prompt, grid, and style, generates a new seed, and submits a new job.
- Endpoint `DELETE /api/sprites/<name>`:
  - Validates `<name>` is a valid slug.
  - Delete order: deletes `<name>.json` first, then `<name>.png`.
  - Requires CSRF token and valid Origin.
  - Returns `HTTP 204 No Content`.

#### Acceptance Criteria
- **AC 18.1:** `GET /api/sprites` lists all valid sprites currently present in `ASSET_DIR`.
- **AC 18.2:** Clicking "Regenerate" on an asset enqueues a new generation with identical prompt and settings but a distinct seed.
- **AC 18.3:** Deleting a sprite removes the `.json` followed by the `.png`, causing the C++ engine to cleanly drop the sprite on its next scan tick.

---

### US-19: Native Engine Fuzzing & Malformed Asset Hardening
- **Story ID:** `US-19`
- **Track / Phase:** Engine Track (C++) / Phase 5
- **Primary Persona:** `PER-4` (C++ Engine Dev), `PER-5` (Security Engineer)
- **Traceability:** Phase 5 Task 5.4, Security S-09, Test Matrix T-18, NFR-R1

#### User Story
> **As a** robustness verification test,  
> **I want to** bombard the asset folder with random, truncated, and corrupted files for 5 continuous minutes while the engine runs,  
> **So that** we guarantee the C++ game engine will never crash, leak memory, or hang when encountering malformed assets.

#### Technical Specifications
- Automated test script `tests/fuzz_asset_dir.py`.
- Generates high-frequency junk files in `ASSET_DIR`:
  - Truncated JSON files, random binary bytes in `.json`.
  - Non-image files renamed to `.png`.
  - Deeply nested JSON objects and JSON with integer overflow values.
  - Rapid file creation, modification, and immediate deletion (simulating Windows file lock contention).
- Engine compiled with AddressSanitizer (ASan) and UndefinedBehaviorSanitizer (UBSan).

#### Acceptance Criteria
- **AC 19.1:** The engine runs continuously for 5 minutes during active fuzzing without terminating, throwing uncaught exceptions, or triggering ASan/UBSan violations.
- **AC 19.2:** Memory usage of `SpriteEngine` remains stable without progressive memory leaks.
- **AC 19.3:** All malformed files are appropriately flagged in `engine.log` with descriptive error entries.

---

### US-20: End-to-End Automated Pipeline Integration Test
- **Story ID:** `US-20`
- **Track / Phase:** Shared / Phase 4 & 5
- **Primary Persona:** `PER-1` (Game Developer), `PER-5` (QA Engineer)
- **Traceability:** Implementation Plan Milestone M2/M4, Test Matrix T-19, T-20, SRS Section 8

#### User Story
> **As a** continuous integration workflow,  
> **I want to** execute an automated end-to-end integration test submitting 10 consecutive prompts and verifying engine ingestion,  
> **So that** we validate the entire prompt-to-onscreen pipeline functions seamlessly without manual intervention.

#### Technical Specifications
- Integration script `tests/test_e2e_pipeline.py`.
- Execution flow:
  1. Launches `SpriteEngine` process pointing to test asset directory.
  2. Submits 10 generation requests via `POST /api/generate`.
  3. Polls each job until `status: "done"`.
  4. Monitors `engine.log` to assert that all 10 sprite sheets were discovered, parsed, and loaded into `SpriteRegistry`.
  5. Asserts zero engine restart events, zero torn reads, and zero orphan files.

#### Acceptance Criteria
- **AC 20.1:** All 10 jobs complete within end-to-end target time (≤ 90 s per sprite on warm model).
- **AC 20.2:** The engine successfully registers and renders all 10 animated sprites without a restart.
- **AC 20.3:** Test execution exits with status code 0 and attaches execution telemetry to CI test reports.

---

### US-25: Real-Time Server-Sent Events (SSE) Progress Streaming
- **Story ID:** `US-25`
- **Track / Phase:** Backend & Frontend / Phase 5 (Enhancements)
- **Primary Persona:** `PER-1` (Game Developer)
- **Traceability:** Issue #21, PR #21

#### User Story
> **As a** user generating sprites,  
> **I want** live stage transitions and percentage progress streamed over Server-Sent Events (SSE),  
> **So that** I receive instantaneous feedback without relying on 1500ms HTTP polling.

#### Technical Specifications
- Endpoint `GET /api/jobs/<job_id>/stream` with `text/event-stream` MIME type.
- Pub/Sub in-memory queue dispatcher in `JobStore`.
- Sub-second stage transitions (`queued` -> `generating` -> `removing_background` -> `processing` -> `exporting` -> `done`).
- Dynamic progress percentage (0% to 100%) and estimated remaining time calculation.
- Browser `EventSource` subscriber with automatic fallback to 1500ms HTTP polling on disconnect or error.
- Clean connection closure and memory leak prevention on terminal status or client disconnect.

#### Acceptance Criteria
- **AC 25.1:** Implement `/api/jobs/<job_id>/stream` endpoint using Server-Sent Events (`text/event-stream`).
- **AC 25.2:** Push sub-second stage transitions (`queued` -> `generating` -> `removing_background` -> `processing` -> `exporting` -> `done`).
- **AC 25.3:** Stream generation progress percentage (0% to 100%) and estimated remaining time.
- **AC 25.4:** Update frontend `app.js` to use `EventSource`, gracefully falling back to HTTP polling if SSE connection drops.
- **AC 25.5:** Close SSE connections cleanly upon job completion or failure to prevent memory/connection leaks.

---

## 3. Comprehensive Requirements Traceability Matrix (RTM)

| User Story ID | Title | FR Mapping | NFR Mapping | Security ID | Implementation Phase | Priority | Est. Points |
|---|---|---|---|---|---|---|---|
| **US-01** | Day-1 Provider Evaluation & Selection Spike | — | NFR-M1 | S-01, S-10 | Phase 0 | Must | 5 |
| **US-02** | Frozen Data Contracts & Shared Test Fixtures | — | NFR-M3, NFR-M5 | S-06 | Phase 0 | Must | 3 |
| **US-03** | Web UI for Sprite Prompt & Parameter Submission | FR-01.1, FR-01.10 | NFR-U1, NFR-U3 | S-03, S-05 | Phase 1 | Must | 3 |
| **US-04** | API Request Ingestion, Validation & Slugification | FR-01.2 – FR-01.8 | NFR-S3 | S-04, S-05 | Phase 1 | Must | 5 |
| **US-05** | Asynchronous Background Job Queue & Lifecycle | FR-01.5, FR-01.9, FR-07.2 | NFR-R4 | S-07 | Phase 1 | Must | 5 |
| **US-06** | Job Status Polling & In-Browser Animated Preview | FR-07.1 – FR-07.4 | NFR-U2 | S-03 | Phase 1 & 4 | Should | 3 |
| **US-07** | Sprite Sheet Prompt Wrapping & Preset Builder | FR-02.1, FR-02.2 | NFR-M2 | S-12 | Phase 1 & 4 | Must | 3 |
| **US-08** | Cloudflare Workers AI Primary Provider | FR-02.3 – FR-02.9 | NFR-R3 | S-01, S-08 | Phase 1 | Must | 5 |
| **US-09** | Local CPU Fallback Provider (SD-Turbo) | FR-02.10 | NFR-PT1 | S-10 | Phase 1 & 4 | Should | 8 |
| **US-10** | Automated Background Removal & Alpha Check | FR-03.1 – FR-03.5 | NFR-P1 | S-08 | Phase 2 | Must | 5 |
| **US-11** | User Grid Snapping, Frame Trimming & Alignment | FR-04.1 – FR-04.7 | NFR-M5 | S-08 | Phase 2 | Must | 5 |
| **US-12** | Atomic File Export with PNG-Before-JSON Order | FR-05.1 – FR-05.7 | NFR-R2, NFR-S4 | S-04, S-06 | Phase 2 | Must | 5 |
| **US-13** | Throttled Filesystem Polling & Metadata Parsing | FR-06.1 – FR-06.6 | NFR-P3, NFR-R1 | S-09 | Phase 3 | Must | 5 |
| **US-14** | Texture Loading, Frame Rects & Animation Loop | FR-06.7, FR-06.8 | NFR-M4 | S-09 | Phase 3 | Must | 5 |
| **US-15** | In-Place Hot-Reloading, Delete & Scene Layout | FR-06.9 – FR-06.11 | NFR-P4, NFR-R1 | S-09 | Phase 3 | Must | 5 |
| **US-16** | Centralized Configuration & Fail-Fast Startup | FR-08.1 – FR-08.4 | NFR-S1, NFR-S2 | S-01, S-02 | Phase 0 & 1 | Must | 3 |
| **US-17** | Structured Logging & Health Check Diagnostic | FR-09.1 – FR-09.3 | NFR-M4 | S-01, S-11 | Phase 1 & 3 | Should | 3 |
| **US-18** | Sprite Gallery, Re-Roll Seed & Asset Deletion | FR-10.1 – FR-10.3 | NFR-U2 | S-04, S-05 | Phase 5 | Could | 5 |
| **US-19** | Native Engine Fuzzing & Corrupted Asset Hardening | — | NFR-R1, NFR-P4 | S-09 | Phase 5 | Must | 5 |
| **US-20** | End-to-End Automated Pipeline Integration Test | — | NFR-P2, NFR-R5 | — | Phase 4 & 5 | Must | 5 |
| **US-25** | Real-Time Server-Sent Events (SSE) Progress Streaming | FR-07.1, FR-07.3 | NFR-U2, NFR-P2 | S-03, S-07 | Phase 5 | Should | 5 |

**Total Estimated Story Points:** 95 Points (Across 13–16 Working Days)

