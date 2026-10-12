# SpriteForge — Phase-wise Implementation Plan

All phases are in this one file. Each phase has **goal → tasks → checklist → deliverables → exit criteria**.

| Item | Value |
|---|---|
| Version | 1.0 (draft) |
| Team | 2 developers (Dev 1 = Python, Dev 2 = C++), using AI coding tools; a 1-developer variant is in §8 |
| Duration | 12 working days (+ 3 days buffer = 15) |
| Source | `SpriteForge_Project_Documentation.docx`, section 4 (the original 4-engineer phases are mapped below) |
| Related | [frd.md](frd.md) · [architecture.md](architecture.md) · [data-contracts.md](data-contracts.md) · [security.md](security.md) · [setup-guide.md](setup-guide.md) |

---

## 1. Phase map

| Phase | Name | Owner | Days (2-dev plan) | Original doc phase |
|---|---|---|---|---|
| 0 | Kick-off, setup & technical spikes | Both | D1 | — (new) |
| 1 | Backend infrastructure & AI connection | Dev 1 | D2–D3 | Phase 1 (Engineer 2) |
| 2 | Image processing & asset export | Dev 1 | D4–D6 | Phase 2 (Engineer 1) |
| 3 | Engine asset ingestion | Dev 2 | D1–D6 (parallel) | Phase 3 (Engineer 3) |
| 4 | Prompt engineering & end-to-end integration | Both | D7–D9 | Phase 4 (Engineer 4) |
| 5 | Hardening, security, QA & release | Both | D10–D12 | Section 6 checklists |
| — | Buffer | Both | D13–D15 | — |

```
Day:     1    2    3    4    5    6    7    8    9    10   11   12   13-15
Dev 1  [P0 ][ P1 ---- ][ P2 ----------- ][ P4 ----------- ][ P5 ----------- ][buffer]
Dev 2  [P0 ][ P3 ----------------------------- ][ P4 ----------- ][ P5 ----------- ][buffer]
                                              ▲ M2: first E2E run (D7)
             ▲ M1: contract frozen (D1)                                ▲ M4: release (D12)
                                                        ▲ M3: feature complete (D9)
```

### Milestones

| ID | Milestone | Day | Evidence |
|---|---|---|---|
| M1 | Contract frozen, both skeletons run, **default + fallback provider chosen** | D1 | `data-contracts.md` v1.0 tagged; [provider-evaluation.md](provider-evaluation.md) results filled in; SFML window opens |
| M2 | First end-to-end run | D7 | Prompt in browser → sprite animating in the engine without a restart |
| M3 | Feature complete | D9 | All "Must" FRs pass their acceptance criteria |
| M4 | Release | D12 | Every item in the release checklist (§10) ticked; demo recorded |

---

## 2. Working agreements

- **Git:** `main` is protected. Use feature branches (`feat/p1-hf-client`) and small PRs reviewed by the other dev, even across languages. CI runs lint and tests on every PR.
- **AI coding tools:** use them for boilerplate, tests and refactors. **Every AI-generated change gets a human review.** Don't paste provider tokens or `.env` contents into any AI tool.
- **Daily:** 15-minute sync: what's done, what's next, blockers. Update the checklists in this file as you go.
- **Definition of done (per task):** code merged, tests pass, lint clean, the relevant checklist item ticked, docs updated if behaviour changed.
- **Contract changes:** any change to [data-contracts.md](data-contracts.md) needs both devs to agree, plus a version bump and updated fixtures.

---

## Phase 0 — Kick-off, setup & technical spikes (Day 1, both)

**Goal:** remove the biggest unknowns on Day 1 and freeze the shared contract, so both tracks can work independently.

### Tasks
| # | Task | Owner |
|---|---|---|
| 0.1 | Create the repo with the folder structure from [architecture.md §4](architecture.md), plus `.gitignore` (`.env`, `assets/sprites/*`, `build/`, `venv/`, `__pycache__/`) | Dev 1 |
| 0.2 | Python venv, pinned `requirements.txt`, `ruff` + `black` + `pytest` configured | Dev 1 |
| 0.3 | **Provider evaluation (~5–6 h)** following [provider-evaluation.md](provider-evaluation.md): set up Option A (Cloudflare free tier) and Option B (local CPU SD-Turbo); generate the same 30-image test set with each; record speed, failures, output size and response format. Test Option C (HF paid) only if A and B both score below 3/5. | Dev 1 |
| 0.4 | **Scoring session (1 h):** both devs score the images blind with the rubric; apply the decision rule; choose the **default** and **fallback** provider; note the best prompt wording. | Both |
| 0.5 | **rembg check:** run rembg on the test images; pre-download `u2net` and `isnet-anime`; pick the default rembg model. | Dev 1 |
| 0.6 | CMake project with SFML 2.6.x + nlohmann/json via `FetchContent`; an empty window opens on Windows | Dev 2 |
| 0.7 | **Library decision (ADR-03):** confirm SFML (or switch to Raylib now, never later) | Dev 2 |
| 0.8 | Freeze [data-contracts.md](data-contracts.md) v1.0; write `shared/sprite.schema.json`; create the hand-made fixtures in `shared/fixtures/` | Both |
| 0.9 | CI: GitHub Actions (or similar) running `ruff`, `pytest`, and the CMake build + C++ tests on Windows and Ubuntu | Dev 2 |
| 0.10 | Create the free Cloudflare account and a token with **Workers AI permission only**; share it through a password manager, never chat or email. (HF token only if Option C is ever enabled.) | Lead |

### Checklist
- [ ] Repo created; structure matches the architecture doc
- [ ] `.env.example` committed; `.env` git-ignored and verified with `git check-ignore .env`
- [ ] Default + fallback provider chosen; model ids, endpoint and response format written into `data-contracts.md §4/§5`
- [ ] Results table and decision filled in [provider-evaluation.md](provider-evaluation.md)
- [ ] Local model converted and saved to `models/` (if B is the default or fallback)
- [ ] Go/no-go on output quality: if no model gives usable sheets, agree the fallback (single-frame sprites, or generating frames one by one) **today**
- [ ] rembg models downloaded and cached
- [ ] SFML window builds and runs on the dev machine
- [ ] JSON schema + fixtures committed; contract v1.0 tagged
- [ ] CI green on an empty project

**Deliverables:** repo skeleton, completed provider evaluation, frozen contract, fixtures, CI.
**Exit criteria:** M1 met. Both devs can work in parallel without waiting on each other.

---

## Phase 1 — Backend infrastructure & AI connection (Days 2–3, Dev 1)

**Goal:** a Flask app that accepts prompts, runs background jobs, calls the **default image provider** reliably and reports status.

### Tasks
| # | Task | FR |
|---|---|---|
| 1.1 | `config.py`: load `.env`, validate, resolve `ASSET_DIR` to an absolute path, fail fast if anything is missing | FR-08 |
| 1.2 | `logging_setup.py`: rotating file + console; a redaction filter for the token | FR-09 |
| 1.3 | `app.py` app factory; bind to `127.0.0.1`; `debug=False`; `MAX_CONTENT_LENGTH=4 KB` | FR-01 |
| 1.4 | `validators.py`: prompt, name → slug, grid, style, seed | FR-01 |
| 1.5 | `jobs.py`: `JobStore` (dict + lock), `ThreadPoolExecutor(JOB_WORKERS)`, stage updates, TTL clean-up, queue limit | FR-01, FR-07 |
| 1.6 | `routes/api.py`: `POST /api/generate`, `GET /api/jobs/<id>`, `GET /api/health` | FR-01, FR-07, FR-09 |
| 1.7 | CSRF token in the page + `Origin` check on POST/DELETE; simple per-minute rate limit | Security S-05, S-07 |
| 1.8 | `services/providers/base.py` (`ImageProvider`, shared exceptions, `get_provider()`) + the **default provider class** chosen on Day 1 (`cloudflare.py` or `local_cpu.py`): timeout, retries with backoff, `Retry-After`, quota detection, content-type and size checks, error mapping | FR-02 |
| 1.9 | `services/prompt_builder.py` + `prompts/presets.yaml` (first version from the Phase 0 spike) | FR-02 |
| 1.10 | `templates/index.html` + `static/app.js`: form, disable on submit, status polling, error display | FR-01, FR-07 |
| 1.11 | Tests: validators (good and bad inputs); provider with mocked responses (200, 401, 429→200, 503→503→200, daily-quota error, timeout, HTML instead of image, oversized) | — |

### Checklist
- [ ] Server starts only when the config is valid; clear message otherwise
- [ ] Server listens on `127.0.0.1` only (`netstat` shows no `0.0.0.0:5000`)
- [ ] Debug mode off; the Werkzeug debugger is unreachable
- [ ] Empty, whitespace-only and over-long prompts → 400, no crash *(doc QA item)*
- [ ] Non-JSON body → 415; body > 4 KB → 413
- [ ] POST without the CSRF token or from a foreign Origin → 403
- [ ] `name` slugification makes `../../x`, `CON`, `a/b` and Unicode safe
- [ ] `POST /api/generate` returns 202 in < 200 ms
- [ ] Provider retries work for 429/503; 401 fails immediately; quota error is recognised
- [ ] The provider token is in no log line, error message or response *(doc QA item)*
- [ ] The job moves through its stages and the UI shows each one
- [ ] Queue limit → 429; rate limit enforced
- [ ] All Phase 1 unit tests pass in CI

**Deliverables:** a running Flask app; jobs reach a `generating → (stub) done` state with the raw image saved only to a debug folder outside `ASSET_DIR`.
**Exit criteria:** a real prompt returns a raw image from the default provider through the job system, and errors show up properly in the UI.

---

## Phase 2 — Image processing & asset export (Days 4–6, Dev 1)

**Goal:** turn the raw image into a clean, correctly gridded transparent PNG plus valid JSON, written atomically.

### Tasks
| # | Task | FR |
|---|---|---|
| 2.1 | `processing.remove_background(img)` with a shared rembg session | FR-03 |
| 2.2 | `processing.check_alpha(img)` — coverage 1–95%; alpha threshold clean-up | FR-03 |
| 2.3 | `processing.normalise_grid(img, rows, cols, cell_size)` — crop/resize to exact multiples; nearest-neighbour for pixel art | FR-04 |
| 2.4 | `processing.count_frames(img, rows, cols)` — trim trailing empty cells | FR-04 |
| 2.5 | `processing.align_frames(img, rows, cols)` — centre each frame's bounding box in its cell (reduces jitter) | FR-04 |
| 2.6 | `processing.build_metadata(...)` → dict; validate against `shared/sprite.schema.json` | FR-05 |
| 2.7 | `exporter.write_atomic(path, bytes)` — temp file → fsync → `os.replace`; path-containment check | FR-05 |
| 2.8 | `exporter.export_sprite(...)` — PNG then JSON; remove the orphan PNG if the JSON write fails; temp-file clean-up at startup | FR-05 |
| 2.9 | Pillow safety: set `Image.MAX_IMAGE_PIXELS`; check decoded dimensions ≤ `MAX_TEXTURE_SIZE` | Security S-08 |
| 2.10 | Wire into the job pipeline: `removing_background → processing → exporting → done` | FR-07 |
| 2.11 | Browser preview: animate the result with CSS `steps()` or a small canvas loop using the metadata | FR-07 |
| 2.12 | Tests: synthetic images for every grid case in FR-04's acceptance criteria; exporter atomicity (simulated failure between PNG and JSON); schema validation of the output | — |

### Checklist
- [ ] Transparent background; character details (eyes, outlines) kept *(doc QA item)*
- [ ] An all-white or all-noise image fails at the alpha check, not at export
- [ ] Grid maths correct for 1×4, 1×6, 1×8, 2×4, 4×4 and odd sizes (1023 px)
- [ ] Trailing empty cells trimmed from `frame_count`; `rows`/`columns` unchanged
- [ ] JSON contains exactly the required keys with correct types: `image_file, frame_width, frame_height, rows, columns, frame_count` *(doc QA item)*
- [ ] `image_file` is a file name only and matches the PNG on disk
- [ ] PNG is fully written before the JSON appears *(doc QA item)*
- [ ] No orphan PNG after an export failure; no `.tmp` files left after a restart
- [ ] Export path always inside `ASSET_DIR` (test with a malicious slug)
- [ ] Every exported JSON validates against `sprite.schema.json`
- [ ] Processing time ≤ 10 s on CPU for 1024×1024 (NFR-P1)
- [ ] Phase 2 tests pass in CI

**Deliverables:** the full Python pipeline, prompt → files in `ASSET_DIR`.
**Exit criteria:** 10 consecutive real generations each produce a valid PNG and JSON pair that the C++ fixture parser accepts.

---

## Phase 3 — Engine asset ingestion (Days 1–6, Dev 2, in parallel)

**Goal:** a C++ game that safely discovers, validates, loads, hot-reloads and animates sprites. Built against the **hand-made fixtures**, so it doesn't depend on the Python side.

### Tasks
| # | Task | FR |
|---|---|---|
| 3.1 | `Config`: load `engine/config.json` with defaults; resolve `asset_dir`; log the effective config | FR-08 |
| 3.2 | `Log`: timestamped console + file logging | FR-09 |
| 3.3 | `SpriteMetadata::parse(path) -> std::optional<SpriteMetadata>`: size cap, `json::parse` in try/catch, required keys, type checks, range checks, `image_file` file-name-only check | FR-06 |
| 3.4 | Metadata parser unit tests (doctest/Catch2) using **every** fixture in `shared/fixtures/` | FR-06 |
| 3.5 | `AnimatedSprite`: holds `sf::Texture` (shared_ptr), builds `IntRect` frames row by row, `update(dt)`, `draw()`, `setFps()` | FR-06 |
| 3.6 | `AssetWatcher`: throttled scan, `.json` filter, skip hidden/tmp files, `seen` map keyed by `last_write_time`, pending queue, one load per tick, retry when the PNG is missing (max N) | FR-06 |
| 3.7 | Texture load: PNG size cap; `loadFromFile`; check dimensions against the metadata | FR-06 |
| 3.8 | `SpriteRegistry`: upsert by name (hot-reload in place), remove when the JSON disappears | FR-06 |
| 3.9 | `Scene`: auto-layout grid, name labels, keys `R` (rescan), `+`/`-` (fps), `Esc` | FR-06 |
| 3.10 | Robustness: wrap all file-system calls (`std::error_code` overloads) so a locked or vanished file never throws to the top level | NFR-R1 |
| 3.11 | Performance check: 50 copies of fixtures, measure FPS; make sure the scan isn't per-frame | NFR-P4/P5 |
| 3.12 | Build with `-Wall -Wextra -Werror` / `/W4 /WX`; debug build with AddressSanitizer + UBSan on Linux CI | NFR-M4 |

### Checklist
- [ ] Watcher only processes `.json` files *(doc QA item)*
- [ ] Hidden/temp files (`.x.png.tmp`, `.x.json.tmp`) ignored
- [ ] Checks the PNG exists before loading the texture *(doc QA item)*
- [ ] Loaded assets recorded in the `seen` map; no endless reloading *(doc QA item)*
- [ ] Malformed JSON → error logged, engine keeps running *(doc QA item)*
- [ ] Texture frames match the metadata dimensions *(doc QA item)*
- [ ] `image_file` with `..`, `/`, `\`, a drive letter or an absolute path → rejected
- [ ] Out-of-range numbers (`frame_count: 999`, `rows: 0`, negative values, strings) → rejected
- [ ] Metadata larger than the texture → rejected after load
- [ ] Editing an existing JSON or PNG → sprite reloads in place
- [ ] Deleting a JSON → sprite removed
- [ ] Locked or in-use file on Windows → skipped and retried, no crash
- [ ] ≥ 55 FPS with 50 sprites; new file picked up within 1 s
- [ ] No warnings; sanitizer build clean; parser tests pass in CI on Windows and Ubuntu

**Deliverables:** `SpriteEngine` executable that animates every fixture and hot-reloads.
**Exit criteria:** dropping the fixture files in by hand behaves exactly as the FR-06 acceptance criteria describe.

---

## Phase 4 — Prompt engineering & end-to-end integration (Days 7–9, both)

**Goal:** connect the two halves, then improve output quality and consistency as far as the timebox allows.

### Tasks
| # | Task | Owner |
|---|---|---|
| 4.1 | Point both configs at the same `ASSET_DIR`; first full run (**M2**) | Both |
| 4.2 | E2E test script: submit N prompts through the API, wait for `done`, check the engine log shows a load for each | Dev 2 |
| 4.3 | Stress the hand-off: 10 jobs back to back while the engine runs; confirm no partial reads, no reload loops | Dev 2 |
| 4.4 | Prompt wrappers per grid and style: wording for "evenly spaced", "same character", "side view", "plain background"; negative prompts (text, watermark, border, multiple characters, cropped) | Dev 1 |
| 4.5 | Style presets with consistent palettes (e.g. "16-colour limited palette" for pixel art); optional palette quantisation in Pillow for pixel art | Dev 1 |
| 4.6 | Quality scoring: 5 prompts × 5 grids × 3 styles; score each output from 1 to 5 for usable grid, consistency and clean background; keep the best templates | Both |
| 4.7 | Tune processing based on real outputs: alpha threshold, alignment, cell size | Dev 1 |
| 4.8 | If backend and engine run on different OSes (WSL + Windows), test that setup explicitly | Dev 2 |
| 4.9 | UI polish: animated preview, clear error text, "regenerate with new seed" (FR-10.2, optional) | Dev 1 |
| 4.10 | Write `shared/fixtures/` from real outputs (good and bad) so later regressions are caught | Both |
| 4.11 | **Fallback provider** (~1–1.5 days, can move into the buffer): build the second provider class; on quota exhaustion, outage or no network, retry once with `FALLBACK_PROVIDER`; record the provider used in the metadata; show "free images left today" for Cloudflare. With 1 developer, defer this to post-MVP. | Dev 1 |

### Checklist
- [ ] **M2:** prompt → sprite on screen without restarting the engine
- [ ] 10 consecutive jobs → 10 sprites loaded, 0 engine errors, 0 partial reads
- [ ] No timing sleeps anywhere in the hand-off code (atomic rename only)
- [ ] Prompt templates live in `presets.yaml`, not in code
- [ ] Fallback works: simulated daily-quota error and network-off both still produce a sprite (if 4.11 is in scope)
- [ ] Quality score sheet completed; average ≥ 3/5 for the default style, or the limitation is documented and accepted by stakeholders
- [ ] Known limitations written down (frame consistency, odd poses)
- [ ] All "Must" FRs pass their acceptance criteria (**M3**)

**Deliverables:** an integrated, working system; tuned prompt presets; quality report.
**Exit criteria:** M3 met.

---

## Phase 5 — Hardening, security, QA & release (Days 10–12, both)

**Goal:** make it safe, stable and easy to hand over.

### Tasks
| # | Task | Owner |
|---|---|---|
| 5.1 | Go through every item in [security.md §5](security.md) and fix any gaps | Both |
| 5.2 | Dependency audit: `pip-audit`; check pinned versions; CMake `FetchContent` tags pinned to exact versions | Dev 1 |
| 5.3 | Secret scan of the full git history (`gitleaks` or `trufflehog`); rotate the token if anything is found | Dev 1 |
| 5.4 | Fuzz-ish tests: random/garbage JSON and PNG files dropped into `ASSET_DIR` for 5 minutes while the engine runs | Dev 2 |
| 5.5 | Failure drills: wrong token, no network, provider 503 storm, Cloudflare daily cap reached, local model folder missing, disk full or read-only folder, engine started before the backend and the other way round | Both |
| 5.6 | Run the full test matrix (§9) and record the results | Both |
| 5.7 | Write `README.md` + finish [setup-guide.md](setup-guide.md); a new person follows it from a clean machine in ≤ 30 minutes (NFR-U1) | Both |
| 5.8 | Record a 2–3 minute demo (prompt → sprite live; hot-reload; bad-file resilience) | Both |
| 5.9 | Tag `v1.0.0`; write release notes with known limitations | Lead |

### Checklist
- [ ] Security checklist ([security.md §5](security.md)) 100% ticked
- [ ] `pip-audit` clean, or each finding accepted in writing
- [ ] No secrets in the git history
- [ ] Engine survives 5 minutes of random-file fuzzing with no crash or memory growth
- [ ] All failure drills behave as described in [architecture.md §3.3](architecture.md)
- [ ] Test matrix 100% run; all "Must" rows pass
- [ ] Clean-machine setup test done in ≤ 30 minutes
- [ ] Demo recorded; release tagged; known limitations documented

**Deliverables:** `v1.0.0` release, README, setup guide, demo video, test report.
**Exit criteria:** M4 — release checklist (§10) complete.

---

## 8. Schedule variants

### 8.1 Two developers — day by day

| Day | Dev 1 (Python) | Dev 2 (C++) | Milestone |
|---|---|---|---|
| D1 | P0: repo, venv, **provider evaluation (A vs B) + rembg check** · scoring session with Dev 2 | P0: CMake + SFML window, CI, fixtures · joins 1 h scoring | M1 |
| D2 | P1: config, logging, app factory, validators | P3: Config, Log, SpriteMetadata parser + tests | |
| D3 | P1: jobs, API routes, CSRF, default provider + tests, UI | P3: AnimatedSprite on fixtures | |
| D4 | P2: rembg, alpha check, grid normalisation | P3: AssetWatcher, seen map, one load per tick | |
| D5 | P2: frame count/alignment, metadata, schema validation | P3: Registry hot-reload/remove, Windows locking | |
| D6 | P2: atomic exporter, pipeline wiring, preview | P3: Scene, controls, perf test, sanitizers | |
| D7 | P4: first E2E run, fixes | P4: E2E script, stress the hand-off | **M2** |
| D8 | P4: prompt templates, presets, palette | P4: cross-OS test, real-output fixtures | |
| D9 | P4: quality scoring, processing tuning | P4: quality scoring, bug fixes | **M3** |
| D10 | P5: security checklist, pip-audit, secret scan | P5: fuzzing, failure drills | |
| D11 | P5: test matrix, README | P5: test matrix, setup guide | |
| D12 | P5: clean-machine test, demo, release | P5: clean-machine test, demo, release | **M4** |
| D13–15 | Buffer: quality improvements or slipped items | Buffer | |

### 8.2 One developer — 15 days

| Days | Work |
|---|---|
| D1–2 | Phase 0 (all spikes + both skeletons + contract + fixtures) |
| D3–6 | Phase 3 (engine against fixtures). Done first because it's independent and lowest-risk once the spikes pass. |
| D7–8 | Phase 1 (Flask + default provider only; fallback provider deferred) |
| D9–10 | Phase 2 (processing + export) |
| D11–12 | Phase 4 (integration + prompt tuning, kept short) |
| D13–14 | Phase 5 (hardening, QA, docs) |
| D15 | Buffer / release |

With one developer, FR-10 and palette quantisation are dropped and the quality tuning is shortened.

---

## 9. Test matrix

| ID | Area | Test | Type | Priority |
|---|---|---|---|---|
| T-01 | API | Empty / whitespace / 301-char prompt → 400 | Unit | Must |
| T-02 | API | Non-JSON → 415; > 4 KB → 413 | Unit | Must |
| T-03 | API | Missing CSRF / foreign Origin → 403 | Unit | Must |
| T-04 | API | Path-traversal names slugified safely | Unit | Must |
| T-05 | API | Queue full → 429; rate limit | Unit | Should |
| T-06 | Provider | 200 / 401 / 429→200 / 503→503→200 / quota / timeout / HTML / oversized | Unit (mocked) | Must |
| T-07 | Provider | Token never in logs or responses | Unit | Must |
| T-24 | Provider | Fallback on quota error and with network off | Integration | Should |
| T-08 | Proc | Alpha check: good, all-white, all-opaque | Unit | Must |
| T-09 | Proc | Grid maths, all presets + odd sizes | Unit | Must |
| T-10 | Proc | Trailing empty cells trimmed | Unit | Must |
| T-11 | Export | PNG before JSON; JSON time ≥ PNG time | Unit | Must |
| T-12 | Export | Failure between PNG and JSON → no orphan | Unit | Must |
| T-13 | Export | Output validates against the schema | Unit | Must |
| T-14 | Engine | All fixtures parse/reject as expected | Unit (C++) | Must |
| T-15 | Engine | Hot-reload on change; remove on delete; no loops | Integration | Must |
| T-16 | Engine | Missing PNG → retry, then skip | Integration | Must |
| T-17 | Engine | 50 sprites ≥ 55 FPS; pick-up ≤ 1 s | Performance | Should |
| T-18 | Engine | 5-minute random-file fuzz → no crash | Robustness | Must |
| T-19 | E2E | Prompt → on screen, no restart | E2E | Must |
| T-20 | E2E | 10 back-to-back jobs → 10 loads, 0 errors | E2E | Must |
| T-21 | E2E | Engine started before / after the backend | E2E | Should |
| T-22 | Ops | Wrong token / no network / read-only folder → clear errors | E2E | Must |
| T-23 | Docs | Clean-machine setup ≤ 30 min | Manual | Should |

---

## 10. Release checklist (v1.0.0)

**Functional**
- [ ] FR-01 to FR-06 and FR-08 pass their acceptance criteria
- [ ] FR-07 and FR-09 pass, or the gaps are documented
- [ ] All the QA checklist items from the original document are ticked (they are marked *(doc QA item)* in the phases above)

**Quality**
- [ ] Test matrix: all "Must" rows pass; results attached
- [ ] CI green on Windows + Ubuntu
- [ ] No compiler warnings; lint clean

**Security**
- [ ] [security.md §5](security.md) checklist complete
- [ ] Token is fine-grained, stored only in `.env`, rotated if it was ever exposed

**Docs & handover**
- [ ] README, [setup-guide.md](setup-guide.md) and this plan all reflect the final state
- [ ] Known limitations + next steps listed in the release notes
- [ ] Demo video recorded

---

## 11. Risk register

| ID | Risk | Probability | Impact | Owner | Mitigation | Trigger to act |
|---|---|---|---|---|---|---|
| R-1 | SD can't produce consistent multi-frame sheets | High | High | Dev 1 | Phase 0 spike; best-effort expectation; fallback = single-frame sprites, or generate frames separately with a fixed seed | Spike average < 2/5 |
| R-2 | Default provider unavailable, rate-limited, or its free tier changes | Medium | High | Dev 1 | Provider interface; fallback provider (local CPU); paid Option C documented in [costing.md](costing.md) as a last resort | 3+ failures in a day, or a free-tier change announced |
| R-8 | Local CPU model too slow or too low-quality on team machines | Medium | Medium | Dev 1 | Measured on Day 1; use only as fallback; SDXL-Turbo or a GPU machine if available | Day-1 timing > 10 s/image |
| R-3 | rembg removes character details | Medium | Medium | Dev 1 | Plain-background prompt; try `isnet-anime`; alpha threshold tuning | Quality score < 3 |
| R-4 | Windows file locking / path problems | Medium | Medium | Dev 2 | `std::error_code` overloads; retry; same-drive atomic rename | Any crash in T-15/T-18 |
| R-5 | SFML build pain on Windows | Low–Med | Medium | Dev 2 | `FetchContent` pinned version; decision made on D1 | Not building by end of D1 |
| R-6 | Scope creep (multi-animation, editor) | Medium | High | Lead | Keep the out-of-scope list in the SRS; changes go to post-MVP | New request mid-sprint |
| R-7 | One developer unavailable | Low | High | Lead | Contract + fixtures let one dev continue; 3-day buffer | > 1 day absence |
