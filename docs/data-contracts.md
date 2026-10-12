# SpriteForge — API & Data Contracts

The **single reference** both developers code against. Any change here needs agreement from both the Python and C++ sides, and a version bump.

| Item | Value |
|---|---|
| Version | 1.0 (frozen at end of Phase 0) |
| Related | [frd.md](frd.md) · [architecture.md](architecture.md) · [security.md](security.md) · [costing.md](costing.md) · [provider-evaluation.md](provider-evaluation.md) |

---

## 1. Backend REST API

Base URL: `http://127.0.0.1:5000`. All bodies are JSON (`Content-Type: application/json`).

### 1.1 Endpoints

| Method | Path | Purpose | Success | Errors |
|---|---|---|---|---|
| GET | `/` | Prompt UI | 200 HTML | — |
| POST | `/api/generate` | Create a generation job | 202 | 400, 403, 415, 429 |
| GET | `/api/jobs/<job_id>` | Job status/result | 200 | 404 |
| GET | `/api/sprites` | List exported sprites *(FR-10, optional)* | 200 | — |
| GET | `/api/sprites/<file>` | Serve a PNG for preview (file name only) | 200 image/png | 404 |
| DELETE | `/api/sprites/<name>` | Delete a sprite *(optional)* | 204 | 403, 404 |
| GET | `/api/health` | Health check | 200 | 503 |

**All state-changing requests** (POST and DELETE) must send the `X-CSRF-Token` header (value embedded in the page), and their `Origin` must be `http://127.0.0.1:5000` or `http://localhost:5000`. Otherwise they get **403**. See [security.md](security.md) S-05.

### 1.2 `POST /api/generate`

**Request**
```json
{
  "prompt": "a knight in silver armour walking to the right",
  "name": "knight_walk",
  "grid": "1x4",
  "style": "pixel_art",
  "seed": 12345
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `prompt` | string | ✅ | Trimmed; 3–300 chars; no control chars |
| `name` | string | ❌ | Slugified to `^[a-z0-9][a-z0-9_-]{0,47}$`; built from the prompt if empty |
| `grid` | string | ✅ | One of `1x4`, `1x6`, `1x8`, `2x4`, `4x4` |
| `style` | string | ✅ | One of the keys in `prompts/presets.yaml` (MVP: `pixel_art`, `cartoon`, `painterly`) |
| `seed` | integer | ❌ | `0 … 4294967295`; random if omitted |

Unknown fields are ignored. The body must be at most 4 KB (`MAX_CONTENT_LENGTH`).

**Response 202**
```json
{ "job_id": "8f3a2c1e9b7d4e0f8a6b5c4d3e2f1a0b", "status": "queued" }
```

**Response 400**
```json
{
  "error": "validation_error",
  "message": "Some fields are invalid.",
  "fields": { "prompt": "Prompt must be 3–300 characters." }
}
```

### 1.3 `GET /api/jobs/<job_id>`

`job_id` = 32 lowercase hex characters (uuid4 hex). Anything else → 404.

**Response 200 (in progress)**
```json
{ "job_id": "8f3a…", "status": "running", "stage": "removing_background", "created_at": "2026-10-07T12:00:00Z" }
```

**Response 200 (done)**
```json
{
  "job_id": "8f3a…",
  "status": "done",
  "stage": "done",
  "duration_ms": 41230,
  "metadata": { "...": "same object as the sprite JSON (§2)" },
  "preview_url": "/api/sprites/knight_walk_8f3a2c.png"
}
```

**Response 200 (failed)**
```json
{
  "job_id": "8f3a…",
  "status": "failed",
  "stage": "generating",
  "error": { "code": "provider_unavailable", "message": "The model is still loading. Please retry in about 30 seconds." }
}
```

`status` values: `queued` · `running` · `done` · `failed`
`stage` values: `queued` → `generating` → `removing_background` → `processing` → `exporting` → `done` (or the stage where it failed)

### 1.4 Error codes

| `error.code` | HTTP / where | Meaning |
|---|---|---|
| `validation_error` | 400 | Input failed validation |
| `forbidden` | 403 | CSRF token or Origin check failed |
| `unsupported_media_type` | 415 | Body is not JSON |
| `queue_full` | 429 | Too many queued jobs |
| `provider_auth` | job | Provider token (Cloudflare / HF) invalid or not authorised |
| `provider_rate_limited` | job | Still rate-limited after the retries |
| `provider_quota_exceeded` | job | Daily free allowance used up (Cloudflare). The fallback provider is used instead if one is configured. |
| `provider_local_error` | job | Local CPU model failed to load or ran out of memory |
| `provider_unavailable` | job | Model loading, 5xx or timeout after the retries |
| `provider_bad_response` | job | Not an image, too large, or can't be decoded |
| `bg_removal_failed` | job | Alpha check failed |
| `processing_failed` | job | Grid/normalisation error |
| `export_failed` | job | File-system error |
| `internal_error` | 500 / job | Unexpected error (details only in the server log) |

### 1.5 `GET /api/health`
```json
{ "status": "ok", "provider": "cloudflare", "fallback_provider": "local_cpu", "model": "<model id>", "asset_dir_writable": true, "queue_depth": 0 }
```

---

## 2. Sprite metadata file (`<name>.json`) — schema v1

### 2.1 Example
```json
{
  "schema_version": 1,
  "name": "knight_walk",
  "image_file": "knight_walk_8f3a2c.png",
  "frame_width": 256,
  "frame_height": 256,
  "rows": 1,
  "columns": 4,
  "frame_count": 4,
  "fps": 8,
  "loop": true,
  "source": {
    "prompt": "a knight in silver armour walking to the right",
    "style": "pixel_art",
    "seed": 12345,
    "provider": "cloudflare",
    "model": "@cf/black-forest-labs/flux-1-schnell",
    "generated_at": "2026-10-07T12:00:41Z"
  }
}
```

### 2.2 Fields

| Key | Type | Required | Rules (the engine enforces all of these) |
|---|---|---|---|
| `image_file` | string | ✅ | File name only; `^[a-z0-9][a-z0-9_-]{0,63}\.png$`; no `/`, `\`, `..` or `:` |
| `frame_width` | int | ✅ | 1 – 4096 |
| `frame_height` | int | ✅ | 1 – 4096 |
| `rows` | int | ✅ | 1 – 16 |
| `columns` | int | ✅ | 1 – 16 |
| `frame_count` | int | ✅ | 1 – `rows × columns` |
| `schema_version` | int | ⚪ recommended | `1`. If missing, treated as 1. If greater than the version the engine supports, log a warning and try to load anyway. |
| `name` | string | ⚪ | Display name; if missing, the JSON file name without its extension |
| `fps` | int | ⚪ | 1 – 60; default from engine config (8) |
| `loop` | bool | ⚪ | default `true` |
| `source` | object | ⚪ | For information only; the engine ignores it |

The six required keys are exactly the ones listed in the original document's QA checklist.

**Cross-field rules (checked after the texture loads):**
`columns × frame_width ≤ texture_width` and `rows × frame_height ≤ texture_height`.

**Frame order:** row by row, left to right, top to bottom. Frame `i` is at
`x = (i % columns) × frame_width` and `y = (i / columns) × frame_height`.

**Limits:** the JSON file is at most 64 KB and the PNG at most 20 MB; anything larger is rejected.

**Unknown keys:** ignored, so the schema can grow without breaking older engines.

### 2.3 Machine-readable schema
`shared/sprite.schema.json` (JSON Schema draft 2020-12) is the single source of truth. The Python exporter validates every JSON against it before writing (`jsonschema` package). The C++ tests run the same fixture files through `SpriteMetadata::parse`.

### 2.4 Shared test fixtures (`shared/fixtures/`)

| Fixture | Expected result |
|---|---|
| `valid_1x4.json` + `.png` | Loads, 4 frames |
| `valid_2x4_partial.json` (frame_count 7) | Loads, 7 frames |
| `invalid_missing_key.json` | Rejected: missing `frame_width` |
| `invalid_traversal.json` (`"image_file": "../secret.png"`) | Rejected |
| `invalid_absolute.json` (`"image_file": "C:\\x.png"`) | Rejected |
| `invalid_frame_count.json` (`frame_count: 999`) | Rejected |
| `invalid_types.json` (`"rows": "1"`) | Rejected |
| `invalid_dims_vs_texture.json` | Rejected after the texture loads |
| `malformed.json` (truncated) | Rejected, no crash |
| `huge.json` (> 64 KB) | Rejected before parsing |
| `orphan.json` (PNG missing) | Skipped and retried; logged |

---

## 3. File naming & folder rules

| Rule | Value |
|---|---|
| Asset folder | `ASSET_DIR` (backend) = `asset_dir` (engine) — must be the same absolute path |
| Final names | `<slug>_<shortid>.png` and `<slug>_<shortid>.json`, where `shortid` = first 6 hex characters of `job_id` |
| Temp names | `.<final>.tmp` (leading dot, so the engine skips them) |
| Write order | PNG (temp → rename) **then** JSON (temp → rename) |
| Delete order | JSON **then** PNG |
| Engine reads | Only `*.json` not starting with `.`; the PNG named by `image_file` |

---

## 4. Configuration keys

### 4.1 Backend (`.env`)

| Key | Default | Notes |
|---|---|---|
| **Provider selection** | | Chosen on Day 1 ([provider-evaluation.md](provider-evaluation.md)); options and costs in [costing.md](costing.md) |
| `PROVIDER` | `cloudflare` (set in Phase 0) | `cloudflare` · `local_cpu` · `huggingface` |
| `FALLBACK_PROVIDER` | `local_cpu` | Used on quota exhaustion, outage or no network; empty = no fallback |
| `PROVIDER_TIMEOUT_S` | `120` | Per request (cloud providers) |
| `PROVIDER_MAX_RETRIES` | `3` | For 429/503/timeouts (cloud providers) |
| `GEN_MAX_SIDE` | provider default | 1024 for cloud providers, 512 for `local_cpu`; the grid maths uses the actual output size |
| **Option A — Cloudflare** | | Required only when `cloudflare` is the provider or the fallback |
| `CF_ACCOUNT_ID` | — | Cloudflare account id |
| `CF_API_TOKEN` | — | API token with **Workers AI** permission only. **Never commit it.** |
| `CF_MODEL_ID` | `@cf/black-forest-labs/flux-1-schnell` | |
| `CF_STEPS` | `4` | Steps per image (cost and quality) |
| **Option B — Local CPU** | | Required only when `local_cpu` is the provider or the fallback |
| `LOCAL_MODEL_ID` | `stabilityai/sd-turbo` | Or `stabilityai/sdxl-turbo` |
| `LOCAL_MODEL_DIR` | `../models/sd-turbo-ov` | Converted OpenVINO model (created during setup) |
| `LOCAL_STEPS` | `1` | Turbo models are designed for 1–4 steps |
| **Option C — Hugging Face (paid)** | | Required only when `huggingface` is the provider |
| `HF_TOKEN` | — | Fine-grained token. **Never commit it.** |
| `HF_MODEL_ID` | e.g. FLUX.1 schnell | |
| `HF_API_URL` | confirm when enabled | Hosted inference URLs change over time |
| `ASSET_DIR` | `../assets/sprites` | Resolved to an absolute path at startup; must exist and be writable |
| `REMBG_MODEL` | `u2net` | `isnet-anime` for cartoon styles |
| `ALPHA_THRESHOLD` | `16` | 0–255 |
| `CELL_SIZE` | `0` (off) | e.g. `64` or `128` to force a cell size |
| `MAX_IMAGE_BYTES` | `10485760` | 10 MB cap on the provider response |
| `MAX_TEXTURE_SIZE` | `4096` | Maximum sheet dimension |
| `JOB_WORKERS` | `1` | Background workers |
| `MAX_QUEUED_JOBS` | `5` | Beyond this → 429 |
| `JOB_TTL_MIN` | `60` | How long finished jobs stay in memory |
| `RATE_LIMIT_PER_MIN` | `6` | Generate calls per minute |
| `FLASK_HOST` | `127.0.0.1` | Don't change without reading [security.md](security.md) |
| `FLASK_PORT` | `5000` | |
| `LOG_LEVEL` | `INFO` | |

### 4.2 Engine (`engine/config.json`)
```json
{
  "asset_dir": "C:/path/to/spriteforge/assets/sprites",
  "scan_interval_ms": 500,
  "default_fps": 8,
  "max_png_bytes": 20971520,
  "max_json_bytes": 65536,
  "window": { "width": 1280, "height": 720, "title": "SpriteForge Engine" }
}
```

---

## 5. Image provider contract (internal)

```python
class ImageProvider(Protocol):
    name: str            # "cloudflare" | "local_cpu" | "huggingface"
    model: str           # recorded in metadata.source.model
    max_side: int        # 1024 (cloud) or 512 (local_cpu)
    supports_negative_prompt: bool
    supports_seed: bool
    def generate(self, prompt: str, negative_prompt: str,
                 width: int, height: int, seed: int) -> "PIL.Image.Image": ...
```

| Implementation | File | Option |
|---|---|---|
| `CloudflareProvider` | `services/providers/cloudflare.py` | A — free tier |
| `LocalCpuProvider` | `services/providers/local_cpu.py` | B — free, offline |
| `HuggingFaceProvider` | `services/providers/huggingface.py` | C — paid, built only if needed |

- Every provider raises the same exceptions: `ProviderAuthError`, `ProviderRateLimited`, `ProviderQuotaExceeded`, `ProviderUnavailable`, `ProviderBadResponse` and `ProviderLocalError`. These map to the error codes in §1.4.
- `services/providers/__init__.py: get_provider(name)` builds the provider from config. The job worker calls `PROVIDER`; on `ProviderQuotaExceeded` or `ProviderUnavailable` it retries once with `FALLBACK_PROVIDER` and records the provider it actually used in the metadata.
- Each provider's request/response format stays inside its own file, so nothing else depends on it. Formats are confirmed in Phase 0 ([provider-evaluation.md](provider-evaluation.md)).
- A provider that doesn't support negative prompts or seeds ignores them. The seed is still recorded, with `"seed_applied": false` in `source`.
