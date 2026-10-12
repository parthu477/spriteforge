# SpriteForge — Security

| Item | Value |
|---|---|
| Version | 1.0 (draft) |
| Scope | Flask backend, image providers (Cloudflare Workers AI, local CPU model, Hugging Face), processing/export, C++ engine, repo and dev workflow |
| Related | [architecture.md](architecture.md) · [data-contracts.md](data-contracts.md) · [implementation-plan.md](implementation-plan.md) (Phase 5) |

> SpriteForge is a **local, single-user developer tool**. It isn't a public service, but it still holds a paid API credential, runs a web server, writes files to disk and has a native C++ program that reads those files. Each of those is a real attack surface. The controls below are sized for a local tool. §6 lists what changes if it is ever hosted.

---

## 1. Assets to protect

| Asset | Why it matters |
|---|---|
| Provider tokens (`CF_API_TOKEN`, `HF_TOKEN`) | Can be abused to use up the free allowance, run up cost (paid plans) or access the account |
| Developer machine | Flask debug mode, path traversal or a memory bug in the C++ engine could lead to code execution or file overwrite |
| Asset folder integrity | The engine trusts what it finds there; bad files should never crash it or make it read outside the folder |
| Source repo | Secrets committed by accident stay in git history |
| Generated content | May be inappropriate or carry licence conditions |

## 2. Trust boundaries

```
[Browser] ──(1)── [Flask 127.0.0.1] ──(2)── [Cloudflare / Hugging Face, internet]
                        │   └── local CPU model (weights on disk)
                        │
                       (3) writes
                        ▼
                  [ASSET_DIR] ──(4)── [C++ engine]
```

| # | Boundary | What crosses it | Treat as |
|---|---|---|---|
| 1 | Browser → Flask | Prompts, names, settings; also **any other website the user has open** can try to send requests to localhost | Untrusted input |
| 2 | Flask ⇄ cloud provider | Token (outbound); image bytes (inbound) | Inbound bytes untrusted |
| 2b | Model weights → local CPU provider | Downloaded model files loaded into the backend process | Must come from the official source in a safe format |
| 3 | Flask → disk | File names come from user input | Must be contained |
| 4 | Disk → engine | Any process or user can drop files into the folder | **Untrusted input to native code** |

---

## 3. Threats & controls

| ID | Threat | Control (what we implement) | Where | Verified by |
|---|---|---|---|---|
| **S-01** | **API token leak** (committed, logged, shown in an error, pasted into an AI tool) | Token only in env/`.env`; `.env` git-ignored; `.env.example` has placeholders only; logging filter redacts known token patterns (`hf_…`, Cloudflare tokens) and the `Authorization` header; exceptions from `requests` never returned raw to the client; fine-grained tokens with the minimum scope (Cloudflare: **Workers AI permission only**; HF: inference only); shared via a password manager; **rotate it straight away if exposed**; team rule: never paste `.env` into chats or AI tools | `config.py`, `logging_setup.py`, `providers/*` | T-07, gitleaks scan |
| **S-02** | **Server exposed on the network / debug RCE** — Werkzeug's debugger lets anyone who reaches it run code | `app.run(host="127.0.0.1", debug=False)` enforced in code (not just config); startup refuses `0.0.0.0` unless `ALLOW_REMOTE=1` is set on purpose; never use `flask run --debug` outside local testing | `app.py` | `netstat` check, P1 checklist |
| **S-03** | **Bad input / XSS** — prompt or name shown back in the UI runs as script | Strict server-side validation (length, charset, allowlists for grid/style); Jinja2 autoescape on; the UI sets `textContent` (never `innerHTML`) for user and server strings; `Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'`; `X-Content-Type-Options: nosniff` | `validators.py`, templates, `app.js`, response headers | T-01, T-02, manual XSS test |
| **S-04** | **Path traversal / file overwrite** via `name`, or via the file name in preview/delete routes | Slugify to `^[a-z0-9][a-z0-9_-]{0,47}$`; reject Windows reserved names (`con`, `nul`, `aux`, `com1`…); final path built with `pathlib`, `.resolve()`d and checked with `is_relative_to(ASSET_DIR)`; preview/delete routes accept a **file name only** and use `send_from_directory`; a job-id suffix means a new sprite never overwrites an existing one | `validators.py`, `exporter.py`, `routes/api.py` | T-04 |
| **S-05** | **CSRF / localhost attacks** — a malicious website open in the browser POSTs to `127.0.0.1:5000` and burns tokens or deletes sprites | Per-session CSRF token embedded in the page and required in the `X-CSRF-Token` header; `Origin`/`Referer` must be `http://127.0.0.1:5000` or `http://localhost:5000`; only `application/json` bodies accepted (blocks simple form posts); no CORS headers (same-origin only); `Host` header checked against an allowlist (helps against DNS rebinding) | `routes/api.py`, middleware | T-03 |
| **S-06** | **Partial or tampered files reaching the engine** | Atomic temp → fsync → `os.replace`; PNG before JSON; orphan clean-up; schema validation before the JSON is written; temp files start with a dot so the engine ignores them | `exporter.py` | T-11, T-12, T-13 |
| **S-07** | **Cost / resource exhaustion** — runaway loops, repeated clicks or a scripted attacker use up the Cloudflare daily allowance, run up a paid bill or tie up the CPU | One worker; queue cap (`MAX_QUEUED_JOBS`) → 429; per-minute rate limit; provider timeout and capped retries; request body ≤ 4 KB; daily generation counter shown in the UI; if a paid provider is ever enabled, billing alerts and a spending limit set **before** the first request | `jobs.py`, `app.py`, `providers/*` | T-05 |
| **S-08** | **Malicious or oversized image from the provider** (decompression bomb, wrong type, huge size) | Check `Content-Type` is `image/*`; stream with a byte cap (`MAX_IMAGE_BYTES`); `Image.MAX_IMAGE_PIXELS` set (e.g. 4096×4096); `Image.open` + `verify()` then re-open; for Cloudflare, cap the base64 string length before decoding; check dimensions before processing; keep Pillow up to date | `providers/*`, `processing.py` | T-06 |
| **S-09** | **Untrusted files crashing or exploiting the C++ engine** — the folder can be written by anything | Treat every file as hostile: JSON size cap (64 KB) before parsing; `nlohmann::json::parse` in try/catch (no exceptions escape the loop); types checked with `is_number_integer()` before `get<int>()`; range checks on all numbers; **`image_file` must be a plain file name** (no separators, `..`, `:`, absolute paths) and is joined to `asset_dir` and checked with `std::filesystem::weakly_canonical` + prefix check; PNG size cap before `loadFromFile`; dimensions checked against the metadata before building `IntRect`s; frame index arithmetic checked against `frame_count`; `std::error_code` file-system overloads; `-Wall -Wextra -Werror`, ASan/UBSan in CI, 5-minute fuzz run | `SpriteMetadata`, `AssetWatcher`, `AnimatedSprite` | T-14, T-16, T-18 |
| **S-10** | **Supply chain** — vulnerable or hijacked dependencies; rembg model downloads | Pinned versions in `requirements.txt` (consider `pip-compile --generate-hashes`); `pip-audit` in CI; CMake `FetchContent` pinned to exact release tags (`GIT_TAG 2.6.x`, json `v3.11.x`); rembg models downloaded once during setup from their official source and cached; **local image model weights only from the official model repository, in `.safetensors` format (pickle-based `.bin`/`.ckpt` files can run code when loaded), revision pinned, never from random mirrors**; Dependabot/Renovate on | `requirements.txt`, `CMakeLists.txt`, CI | P5 checklist |
| **S-11** | **Sensitive data in logs** | Log job id, stage, timing and error code; don't log full HTTP headers; prompts logged at DEBUG only; rotate and cap log files | `logging_setup.py` | Log review in P5 |
| **S-12** | **Generated content & licensing** — inappropriate output; model licence terms; ownership of AI-generated art for a commercial game | Use models with a clear licence and record the model id + licence in the metadata `source`; keep the provider's safety filtering on where available; negative prompts against unwanted content; mark generated assets as **prototype/placeholder** until legal/licensing is reviewed by whoever owns the game's IP *(not legal advice — confirm with the client/legal team)* | `presets.yaml`, metadata, README | Release notes |

---

## 4. Secure configuration reference

```dotenv
# .env.example  — copy to .env and fill in. NEVER commit .env
PROVIDER=cloudflare            # chosen on Day 1
FALLBACK_PROVIDER=local_cpu
CF_ACCOUNT_ID=xxxxxxxxxxxxxxxx
CF_API_TOKEN=xxxxxxxxxxxxxxxx   # Workers AI permission only
LOCAL_MODEL_DIR=../models/sd-turbo-ov
# HF_TOKEN=hf_xxxxxxxx         # only if the paid Hugging Face option is enabled
FLASK_HOST=127.0.0.1
FLASK_PORT=5000
ASSET_DIR=../assets/sprites
MAX_QUEUED_JOBS=5
RATE_LIMIT_PER_MIN=6
MAX_IMAGE_BYTES=10485760
LOG_LEVEL=INFO
```

`.gitignore` must contain at least:
```
.env
*.env.local
venv/
__pycache__/
build/
assets/sprites/*
!assets/sprites/.gitkeep
backend/logs/
models/
spikes/output/
```

**Response headers (set on every response):**
```
Content-Security-Policy: default-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cache-Control: no-store            (API responses)
```

---

## 5. Security checklist (must be 100% for release)

### Secrets
- [ ] Provider tokens (`CF_API_TOKEN`, `HF_TOKEN` if used) only in `.env` / environment; not in code, docs, screenshots or CI logs
- [ ] `.env` is git-ignored (`git check-ignore -v .env` confirms)
- [ ] `gitleaks detect` (or trufflehog) over the full history: no findings
- [ ] Tokens are fine-grained with minimal permissions (Cloudflare: Workers AI only); billing alerts on for any paid provider
- [ ] Logging redaction tested (T-07)
- [ ] Token rotation steps written in the README

### Backend
- [ ] Binds to `127.0.0.1`; `debug=False` enforced in code
- [ ] All inputs validated server-side; allowlists for grid and style
- [ ] `MAX_CONTENT_LENGTH` = 4 KB; non-JSON rejected
- [ ] CSRF token + Origin + Host checks on every state-changing route
- [ ] No CORS headers
- [ ] Security headers present (check with browser devtools)
- [ ] User strings rendered with `textContent` / autoescape only
- [ ] Rate limit + queue cap active
- [ ] Error responses never include stack traces or provider error bodies

### Files
- [ ] Slugify + reserved-name check + `resolve()` containment check on every write and delete
- [ ] Preview route uses `send_from_directory` with a file name only
- [ ] Atomic write, PNG → JSON; orphan and temp clean-up
- [ ] Every exported JSON validated against the schema

### Image handling
- [ ] Content-type and byte-size checks on the provider response
- [ ] `Image.MAX_IMAGE_PIXELS` set; dimension cap enforced
- [ ] Pillow on its latest patched version

### Engine
- [ ] JSON and PNG size caps enforced before parsing/loading
- [ ] Every parse in try/catch; no exception reaches `main`
- [ ] Type + range checks for every numeric field
- [ ] `image_file` file-name-only rule + canonical-path containment check
- [ ] Texture dimensions checked against the metadata
- [ ] All the "invalid_*" fixtures rejected (T-14)
- [ ] ASan/UBSan build clean; 5-minute fuzz run clean (T-18)
- [ ] Compiles warning-free with warnings as errors

### Supply chain & process
- [ ] Dependencies pinned; `pip-audit` clean or exceptions documented
- [ ] `FetchContent` pinned to exact tags
- [ ] rembg models fetched during setup only
- [ ] Local image model weights from the official repo, `.safetensors` only, revision pinned; `models/` git-ignored
- [ ] Every AI-generated code change reviewed by a human before merge
- [ ] Model id + licence recorded; generated art labelled as prototype pending licence review

---

## 6. If SpriteForge is ever hosted (beyond MVP)

The local-only assumptions no longer hold. Before exposing it:
- Put it behind HTTPS, add authentication (SSO or at least per-user API keys) and per-user quotas.
- Run it on a production WSGI server (gunicorn/waitress) behind a reverse proxy, never the Flask dev server.
- Move secrets to a secrets manager; add per-environment tokens.
- Replace the shared folder with object storage + signed URLs; engines download assets over HTTPS and verify a checksum/signature.
- Add audit logging, content moderation on prompts and outputs, abuse monitoring, and a takedown process.
- Get a security review / pen test.

---

## 7. Incident quick-response

| Situation | Immediate action |
|---|---|
| Token committed or shared | Revoke it in the Cloudflare / HF dashboard **now** → create a new one → update `.env` → remove it from history (`git filter-repo`) → check usage for abuse |
| Unexpected usage spike (free allowance gone early, or a bill) | Revoke the token; check for a server exposed on `0.0.0.0`; check the logs for unknown origins |
| Engine crash from a file | Keep the file in quarantine as a new fixture; add a test; fix the parser; never "fix" it by deleting the evidence |
| Suspicious files in `ASSET_DIR` | Stop the engine; check what else can write to the folder; restrict folder permissions to the current user |
