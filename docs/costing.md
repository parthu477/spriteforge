# SpriteForge — Costing (Free vs Paid)

| Item | Value |
|---|---|
| Version | 1.1 · prices checked 7 Oct 2026 |
| Change from v1.0 | Added two **free** image-generation options (Cloudflare Workers AI free tier, local CPU model) alongside the paid Hugging Face option |
| Excluded (as requested) | Claude / AI coding tool subscriptions; CI / GitHub Actions runner minutes |
| Currency | USD, with approximate INR at **₹88 / US$** (assumption, so check the current rate). Card payments to foreign services may attract **18% GST** plus bank forex markup, which is not included below. |
| Related | [overview.md](overview.md) · [architecture.md](architecture.md) (ADR-05 provider interface) · [implementation-plan.md](implementation-plan.md) · [security.md](security.md) |

---

## 1. Bottom line

The only thing in SpriteForge that can cost money is **AI image generation**. Everything else (languages, libraries, game engine, tools, hosting) is free (§2). Image generation has three options:

| Option | Provider | MVP cost | Monthly after MVP | Quality | Needs internet |
|---|---|---|---|---|---|
| **A** ✅ recommended | **Cloudflare Workers AI — free tier** (FLUX.1 schnell) | **₹0** | **₹0** within the daily free allowance | High | Yes |
| **B** ✅ fallback | **Local model on CPU** (SD-Turbo / SDXL-Turbo + OpenVINO) | **₹0** | **₹0** | Medium | No |
| **C** | **Hugging Face — paid** (PRO + pay-as-you-go, FLUX.1 schnell) | ≈ $9–11 (≈ ₹800–1,000) | ≈ $9–16 typical | High | Yes |

**Recommended setup:** **A as the main provider + B as the offline/backup provider**, giving a **total cost of ₹0**. Keep **C** ready as a paid upgrade if volume or reliability later needs it. All three sit behind the same `ImageProvider` interface (ADR-05), so switching is a config change (`PROVIDER=cloudflare | local_cpu | huggingface`).

---

## 2. Free items (₹0) — same for every option

### 2.1 Backend & processing
| Item | Use | Licence | Cost |
|---|---|---|---|
| Python 3.11 | Backend language | PSF | Free |
| Flask | Web server / API | BSD-3 | Free |
| requests | HTTP client for the AI API | Apache-2.0 | Free |
| Pillow | Image processing | MIT-CMU (HPND) | Free |
| rembg + ONNX Runtime | Background removal (runs locally on CPU) | MIT | Free |
| rembg models (`u2net`, `isnet-anime`) | Background-removal weights | Open source (check each model card) | Free — one-time ~170 MB download each |
| python-dotenv, PyYAML, jsonschema | Config, presets, schema validation | BSD / MIT | Free |
| pytest, ruff, black, pip-audit | Testing, linting, security audit | MIT / Apache-2.0 | Free |

### 2.2 Game engine (C++)
| Item | Use | Licence | Cost |
|---|---|---|---|
| SFML 2.6 | 2D graphics / window | zlib | Free |
| nlohmann/json | JSON parsing | MIT | Free |
| CMake | Build system | BSD-3 | Free |
| doctest / Catch2 | C++ unit tests | MIT / BSL-1.0 | Free |
| A TTF font for on-screen labels (SFML needs one for `sf::Text`) | Sprite names in the engine | Pick an **SIL OFL** font, e.g. from Google Fonts | Free |
| Compiler — **MinGW-w64 GCC** or **GCC/Clang** on Linux | Build C++ | GPL (toolchain) — no effect on your code | Free |
| Compiler — **Visual Studio 2022 Community / Build Tools** | Build C++ on Windows | Microsoft licence | **Free** for individuals, open-source work, and non-enterprise organisations with **up to 5 users**. See §5 if that doesn't apply. |

### 2.3 Dev workflow
| Item | Use | Cost |
|---|---|---|
| Git | Version control | Free |
| GitHub Free (private repos) | Code hosting, PRs | Free (runner minutes excluded from this doc) |
| VS Code | Editor | Free |
| gitleaks / trufflehog | Secret scanning | Free (open source) |
| Bitwarden (free plan) or existing company password manager | Sharing API tokens safely | Free |
| Cloudflare account (free plan) | Option A API token | Free |
| Hugging Face account (free tier) | Model downloads for Option B; tokens for Option C | Free |

### 2.4 Infrastructure
| Item | Cost | Why |
|---|---|---|
| Server / hosting | **₹0** | Everything runs on the developer's machine (127.0.0.1) |
| Database | **₹0** | Not needed; jobs in memory, assets on disk |
| Domain / SSL | **₹0** | Not needed for a local tool |
| Storage | **₹0** | Each sprite is a few hundred KB on local disk; Option B models need ~5–10 GB of disk |
| GPU | **₹0** | Options A and C run in the cloud; Option B runs on CPU; rembg runs on CPU |

---

## 3. AI image generation — the three options

### How many images the project needs (same for all options)

Plan an extra 3–5 generations for every usable sprite, because sheets often need re-rolls.

| Phase | Activity | Images (est.) |
|---|---|---|
| Phase 0 | Provider spikes + sprite-sheet spike (10 prompts × 5 grids per provider) | 150 |
| Phase 1–2 | Dev testing of the provider client and pipeline | 100 |
| Phase 4 | Quality scoring (5 prompts × 5 grids × 3 styles) × 2 rounds + E2E/stress runs | 250 |
| Phase 5 | QA, failure drills, demo | 100 |
| **Total** | | **≈ 600** (plan for up to 1,000) |

---

### 3.1 Option A — Cloudflare Workers AI free tier ✅ (recommended main provider)

| Item | Detail |
|---|---|
| Model | **FLUX.1 [schnell]** (`@cf/black-forest-labs/flux-1-schnell`) — Apache-2.0, **commercial use allowed** |
| Free allowance | **10,000 neurons per day**, on both the Free and Paid plans |
| Cost per 1024×1024 image | 4 tiles × 4.8 neurons + 4 steps × 9.6 neurons ≈ **58 neurons** |
| Free images per day | **≈ 170 / day** (conservative; up to ~500 / day if fewer steps are used or steps aren't charged separately) |
| MVP need | ~600–1,000 images → **4–6 days of free allowance**, spread across 12 working days |
| **MVP cost** | **₹0** |
| Above the free allowance | Free plan: requests **fail until the daily reset** (no charge). Paid plan: $0.011 per 1,000 neurons ≈ **$0.0006 per image** (≈ ₹0.06), on top of Cloudflare's Workers Paid plan fee (check current price) |
| Integration | Plain HTTPS REST call with an **account ID + API token**; no SDK needed. Same shape as the HF client. |
| Setup | Free Cloudflare account → create an API token with **Workers AI** permission only |

**Pros:** free, high quality (same model as Option C), fast, no local hardware needed.
**Cons:** daily cap (fine for a dev team, but not for bulk generation); needs internet; Cloudflare can change the free tier.
**What we build:** `CloudflareProvider` class; new config keys `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_MODEL_ID`. The token is handled exactly like `HF_TOKEN` ([security.md](security.md) S-01). On a "daily limit reached" error the job fails with a clear message, or falls back to Option B automatically.

---

### 3.2 Option B — Local model on CPU ✅ (offline / backup provider)

| Item | Detail |
|---|---|
| Models | **SD-Turbo** or **SDXL-Turbo** (1-step distilled Stable Diffusion) |
| Runtime | OpenVINO via Hugging Face `diffusers` / `optimum-intel`, or the MIT-licensed **FastSD CPU** project |
| Speed (benchmark) | **≈ 1.7 s (SD-Turbo) / ≈ 2.5 s (SDXL-Turbo)** per 512×512 image on an Intel Core i7-12700. Older or laptop CPUs will be slower — measure in Phase 0. |
| Resolution | **512×512** native (e.g. 1×4 grid → 128 px cells). Good enough for pixel art, which we downscale anyway. |
| Hardware | Modern 6–8+ core CPU, **16 GB RAM** recommended, **~5–10 GB disk** for models; **no GPU needed** |
| **Cost** | **₹0** — no account, no API, no limits (only electricity) |
| Licence | Stability AI **Community Licence** → **free for commercial use below US$1M annual revenue**; Enterprise licence above that |
| Internet | Only for the one-time model download |

**Pros:** free forever, no daily cap, works offline, no API token to protect.
**Cons:** lower quality than FLUX and 512 px only; sprite-sheet grids may be weaker; CPU-heavy (runs on the dev machine alongside rembg); larger install.
**What we build:** `LocalCpuProvider` class; config keys `LOCAL_MODEL_ID`, `LOCAL_DEVICE=cpu`, `LOCAL_STEPS=1`; the model loads once at startup and is reused. Keep `JOB_WORKERS=1` so generation and rembg don't fight for the CPU.
**If someone has an NVIDIA GPU (8 GB+ VRAM):** the same provider can run SDXL or FLUX locally at higher quality, still for ₹0.

---

### 3.3 Option C — Hugging Face paid (original plan)

Hugging Face **Inference Providers** pass the provider's price straight through with **no markup**, and each plan includes some monthly credit.

**Plans**

| Plan | Price | Included monthly credits | Going beyond credits |
|---|---|---|---|
| Free | $0 | **$0.10** (≈ 33 FLUX-schnell images) | Must **buy credits** up front |
| **PRO** | **$9 / month** (≈ ₹790) | **$2.00** | Automatic pay-as-you-go |
| Team | $20 / user / month | $2.00 per seat | Pay-as-you-go |

**Price per image (typical, 1024×1024)**

| Model | Approx. price / image | Commercial licence |
|---|---|---|
| **FLUX.1 [schnell]** (fal / Replicate, via HF) | **≈ $0.003** (≈ ₹0.26) | Apache-2.0 → free for commercial use ✅ |
| FLUX.1 [dev] | ≈ $0.001–0.03 depending on provider/GPU time | **Non-commercial** licence. A paid licence from Black Forest Labs is needed for commercial use. ⚠️ |
| SDXL | Varies by provider (often cents or less) | CreativeML OpenRAIL++-M → free commercial use with use restrictions ✅ |
| Stable Diffusion 3.5 | ≈ $0.035–0.065 on Stability's own API | Free under the Stability **Community Licence** if annual revenue < **$1M** ⚠️ |

**MVP cost under Option C**

| Variant | Calculation | Cost |
|---|---|---|
| HF PRO for 1 month | $9 plan; $2 credit covers ≈ 660 images; overflow ≈ 340 × $0.003 ≈ $1 | **≈ $9 – 11** (≈ ₹800 – 1,000) |
| Free HF account + bought credits | 1,000 × $0.003 ≈ $3, plus any minimum top-up | **≈ $3 – 10** |
| HF PRO for both developers | 2 × $9 | **≈ $18 – 20** |
| Dearer model (e.g. SD 3.5 at ~$0.05) | 1,000 × $0.05 | **≈ $50** + plan |

**When to choose C:** you need more than the Cloudflare daily allowance, want one bill with no daily cap, or want access to many models through one token.

---

### 3.4 Side-by-side comparison

| | **A. Cloudflare free** | **B. Local CPU** | **C. Hugging Face paid** |
|---|---|---|---|
| MVP cost | ₹0 | ₹0 | ≈ ₹800–1,000 |
| Monthly cost | ₹0 within allowance | ₹0 | ≈ ₹790–1,400 typical |
| Model | FLUX.1 schnell | SD-Turbo / SDXL-Turbo | FLUX.1 schnell (or others) |
| Output size | Up to 1024² | 512² | Up to 1024² |
| Image quality | High | Medium | High |
| Speed per image | Seconds (network) | ~2–3 s on a modern i7; slower on older CPUs | Seconds; cold starts possible |
| Volume limit | ~170+ images/day | Unlimited (CPU-bound) | Unlimited (pay per image) |
| Internet needed | Yes | No (after download) | Yes |
| Account / token | Cloudflare account + token | None | HF account + token + card |
| Commercial licence | Apache-2.0 ✅ | Community Licence (free < $1M revenue) ⚠️ | Depends on model (FLUX schnell ✅) |
| Extra setup effort | ~0.5 day | ~1–1.5 days | ~0.5 day (original plan) |
| Main risk | Free tier changes / daily cap | Quality, CPU load | Cost grows with usage |

### 3.5 Recommended provider setup

```
PROVIDER=cloudflare          # main: free, high quality
FALLBACK_PROVIDER=local_cpu  # used when Cloudflare is down or the daily cap is hit, or offline
# PROVIDER=huggingface       # paid upgrade, switch on only if needed
```

- **Day-1 test** ([provider-evaluation.md](provider-evaluation.md), ~5–6 hours) compares Option A and Option B (and Option C only if both disappoint). The winner becomes the default.
- **Total cost for the MVP: ₹0.**
- **All docs updated** for the multi-provider approach: config keys in [data-contracts.md](data-contracts.md) §4–5, provider classes in [architecture.md](architecture.md) Layer 2 (ADR-05, ADR-09), token and model-file handling in [security.md](security.md) S-01/S-10, setup steps in [setup-guide.md](setup-guide.md), and tasks in [implementation-plan.md](implementation-plan.md) Phase 0/1/4.

---

## 4. Running cost after the MVP (per month)

| Usage level | Images / month | **A. Cloudflare free** | **B. Local CPU** | **C. HF PRO + FLUX schnell** |
|---|---|---|---|---|
| Occasional (1–2 devs) | 300 | **₹0** | **₹0** | ≈ $9 (≈ ₹790) |
| Regular team use | 3,000 (~140/working day) | **₹0** (within ~170/day) | **₹0** | ≈ $16 (≈ ₹1,400) |
| Heavy / batch | 30,000 (~1,400/day) | Over the free cap → Cloudflare paid plan (~$0.0006/image ≈ $18 + plan fee) **or** spill over to B | **₹0**, but ~1,400 × 2–3 s ≈ 1 hour of CPU per day | ≈ $97 (≈ ₹8,500) |

**Dedicated GPU alternative (very high volume only):** a Hugging Face Inference Endpoint on an NVIDIA T4 costs from **$0.50/hour** (≈ $88/month at 8 h × 22 days). Not needed for this project.

---

## 5. Conditional / optional paid items (any option)

| Item | When you'd pay | Cost |
|---|---|---|
| Visual Studio Professional | Only if the organisation is **not** eligible for Community (more than 5 VS users, or an "enterprise": > 250 PCs or > US$1M annual revenue). **Avoid it entirely by using MinGW-w64 or Clang.** | ≈ $45 / user / month |
| Stability AI Enterprise licence | Only if using Option B (SD-Turbo/SDXL-Turbo) commercially **and** annual revenue > US$1M | Quote from Stability AI |
| FLUX.1 [dev] commercial licence | Only if you choose FLUX.1 [dev] for commercial output | Quote from Black Forest Labs |
| Cloudflare paid plan | Only if Option A's daily cap becomes a real limit | Cloudflare plan fee + ≈ $0.0006/image |
| Password manager (paid plan) | Only if the company doesn't already have one | ≈ $4–10 / user / month (Bitwarden free plan is enough) |

---

## 6. Effort (for your own rate card)

Tool cost is tiny next to developer time; multiply by your internal day rate.

| Scenario | Effort |
|---|---|
| 2 developers × 12 days (original plan, one provider) | **24 person-days** (+ up to 6 buffer = 30) |
| + Option A **and** Option B behind the provider interface | **+1.5 – 2 person-days** (fits inside the buffer) |
| 1 developer × 15 days | **15 person-days** (no buffer; build Option A only, add B later) |
| Project lead / review (≈ 10%) | 2–3 person-days |

---

## 7. Cost summary table

| # | Item | Free / Paid | MVP cost | Monthly after MVP |
|---|---|---|---|---|
| 1 | Python, Flask, Pillow, rembg, libraries | Free | ₹0 | ₹0 |
| 2 | SFML, nlohmann/json, CMake, test frameworks | Free | ₹0 | ₹0 |
| 3 | Compiler (MinGW / GCC / VS Community if eligible) | Free | ₹0 | ₹0 |
| 4 | Git, GitHub Free, VS Code, secret scanners | Free | ₹0 | ₹0 |
| 5 | Hosting, DB, domain, storage, GPU | Not needed | ₹0 | ₹0 |
| 6a | **Image generation — A. Cloudflare Workers AI free tier** | **Free** (daily cap) | **₹0** | **₹0** |
| 6b | **Image generation — B. Local CPU (SD-Turbo / SDXL-Turbo)** | **Free** | **₹0** | **₹0** |
| 6c | Image generation — C. Hugging Face PRO + usage | Paid | ≈ $9–11 (≈ ₹800–1,000) | ≈ $9–16 typical |
| | **Total with recommended setup (A + B)** | | **₹0** | **₹0** |
| | Total with paid option (C) | | ≈ ₹800–1,000 | ≈ ₹790–1,400 |

---

## 8. Cost controls

- Keep the backend limits from [security.md](security.md) S-07 (one worker, queue cap, per-minute rate limit). They also keep usage inside Cloudflare's daily allowance.
- Show "free images left today" in the UI for Option A, using a count of today's generations kept by the backend.
- Use a **fixed seed** and saved test images while debugging Phases 2–3, so no generation is spent on non-AI code.
- Stay at 1024×1024 or smaller. Cost (Options A and C) scales with image size.
- If Option C is ever turned on: set **billing alerts and a spending limit** in the Hugging Face account before the first request.

---

## Sources
- [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) — 10,000 free neurons/day; $0.011 per 1,000 neurons; FLUX.1 schnell tile/step pricing
- [FastSD CPU](https://github.com/rupeshs/fastsdcpu/blob/main/Readme.md) — OpenVINO CPU benchmarks (SD-Turbo 1.7 s, SDXL-Turbo 2.5 s at 512², i7-12700); MIT licence
- [Hugging Face pricing](https://huggingface.co/pricing) — PRO $9/mo, Team $20/user/mo, Inference Endpoints from $0.50/h (T4)
- [Hugging Face Inference Providers — pricing & credits](https://huggingface.co/docs/inference-providers/pricing) — $0.10 free / $2 PRO monthly credits, no markup
- [Perkstack — FLUX.1 schnell API price tracker](https://perkstack.co/blog/cheapest-flux-1-schnell-api) — ≈ $0.003/image on fal and Replicate
- [Price Per Token — SDXL / Stability models](https://pricepertoken.com/image/model/stability-ai-sdxl) — Stability API models ≈ $0.035–0.065/image
- [Stability AI — licence update](https://stability.ai/news/license-update) — Community Licence free below $1M annual revenue
