# SpriteForge — Day 1 Image Provider Evaluation

The Phase 0 test that decides which image-generation option becomes the **default provider**. Run it on **Day 1** and record the results in this file.

| Item | Value |
|---|---|
| Owner | Dev 1 (Python). Dev 2 joins only for the scoring session. |
| Time box | **≈ 5–6 hours (one working day)** |
| Options tested | **A** Cloudflare Workers AI free tier (FLUX.1 schnell) · **B** local CPU (SD-Turbo via OpenVINO) · **C** Hugging Face paid — **only if A and B both fail** |
| Cost | ₹0 (C only if needed: a few cents of the free $0.10 HF credit) |
| Related | [costing.md](costing.md) · [implementation-plan.md](implementation-plan.md) Phase 0 · [data-contracts.md](data-contracts.md) §4–5 |

---

## 1. Time plan

| Step | What | Time |
|---|---|---|
| 1 | Accounts and tokens: Cloudflare account + API token (Workers AI permission only) | 20 min |
| 2 | Option A script: call FLUX.1 schnell, save images, record timing | 40 min |
| 3 | Option B setup: install OpenVINO + diffusers, download/convert SD-Turbo (~5 GB) | 60–90 min (mostly waiting on the download, so do step 2 meanwhile) |
| 4 | Option B script: same prompts, save images, record timing | 30 min |
| 5 | Generate the test set: 30 images per option (see §3) | 20–30 min (mostly unattended) |
| 6 | Run rembg on every image (`u2net` and `isnet-anime`) | 15 min |
| 7 | Scoring session (both devs, blind: file names hidden) | 60 min |
| 8 | Decide, then record the results here and in `data-contracts.md` | 30 min |
| | **Total** | **≈ 5–6 hours** |

If both A and B score below the bar, add **~1 hour** to test Option C on the same set.

---

## 2. Setup notes

All test scripts go in `spikes/`, a throwaway folder that is not production code. The token goes in `.env` as usual and is never written into the scripts.

### Option A — Cloudflare Workers AI
- Endpoint pattern: `POST https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/ai/run/@cf/black-forest-labs/flux-1-schnell`
- Header: `Authorization: Bearer <CF_API_TOKEN>`; body: `{"prompt": "...", "steps": 4}`
- **Confirm during the test:**
  - the response format (base64 image inside JSON)
  - the output size and whether it can be set
  - the maximum number of steps
  - whether a seed is supported
  - which error appears when the daily allowance runs out

### Option B — Local CPU
```bash
pip install "optimum[openvino]" diffusers transformers
```
```python
from optimum.intel import OVStableDiffusionPipeline
pipe = OVStableDiffusionPipeline.from_pretrained("stabilityai/sd-turbo", export=True)  # converts once, then cache/save it
img = pipe(prompt, num_inference_steps=1, guidance_scale=0.0, width=512, height=512).images[0]
```
- Download weights only from the official model repository, and prefer `.safetensors` files ([security.md](security.md) S-10).
- Save the converted model (`pipe.save_pretrained("models/sd-turbo-ov")`) so the conversion runs only once.
- Also note the **machine's CPU and RAM**. Speed results only apply to similar hardware.

---

## 3. Test set

10 prompts × 3 grids = **30 images per option**. Use the same seed list for every option.

**Grids:** `1x4` (walk cycle), `2x4` (two actions), `4x4` (stress test)

**Prompt wrapper (starting point; tune later in Phase 4):**
```
<style>, sprite sheet of <subject>, <rows> rows and <cols> columns of evenly spaced frames,
same character in every frame, side view, full body, plain solid white background,
no text, no border
```
Negative prompt (Option B only, if supported): `text, watermark, border, frame lines, multiple different characters, cropped, blurry`

| # | Subject | Style |
|---|---|---|
| 1 | a knight walking | pixel art |
| 2 | a green slime bouncing | pixel art |
| 3 | a red fox running | cartoon |
| 4 | a wizard casting a spell | pixel art |
| 5 | a robot walking | cartoon |
| 6 | a bat flapping its wings | pixel art |
| 7 | a skeleton warrior attacking | pixel art |
| 8 | a cat idle animation | cartoon |
| 9 | a spaceship with engine flames | pixel art |
| 10 | a coin spinning | pixel art |

---

## 4. Scoring rubric

Score each image **1–5** on every criterion. Score blind: rename the files to random ids first.

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| **Grid** | No grid / one big image | Grid visible, uneven spacing or wrong count | Exact rows × cols, evenly spaced |
| **Consistency** | Different character in each frame | Same character, noticeable changes | Same character, only the pose changes |
| **Background (after rembg)** | Character damaged or background left | Small halos / minor loss | Clean cut-out, details kept |
| **Prompt match** | Wrong subject | Right subject, wrong style or view | Exactly as asked |
| **Usable as-is?** | No | After small edits | Yes |

Also measure, per option:
- average seconds per image
- number of failed or errored calls
- output resolution
- any limits hit

---

## 5. Decision rule

| Result | Decision |
|---|---|
| A average ≥ 3.0 and no blockers | **Default = A**, fallback = B (built in Phase 4/5 if time allows) |
| A < 3.0, B ≥ 3.0 | **Default = B**, fallback = A |
| Both ≥ 3.0, within 0.3 of each other | Prefer **A** (better resolution, less CPU load) |
| Both < 3.0 | Test **C** on the same set. If C ≥ 3.0, decide with the lead whether to pay (see [costing.md](costing.md)). |
| All < 3.0 | **Reduce the scope:** generate single-frame sprites, or generate each frame separately with a fixed seed. Tell stakeholders on Day 1. Risk R-1 is triggered. |

"Blockers" include a daily cap too small for the plan, an unclear licence for commercial use, or unstable responses (more than 10% failed calls).

---

## 6. Results (fill in on Day 1)

**Machine:** CPU `________`, RAM `____ GB`, OS `________`
**Date:** `__________`  **Scored by:** `__________`

| Metric | A — Cloudflare | B — Local CPU | C — HF paid (if tested) |
|---|---|---|---|
| Model | FLUX.1 schnell | SD-Turbo (OpenVINO) | |
| Output size | | 512×512 | |
| Avg seconds / image | | | |
| Failed calls / 30 | | | |
| Grid (avg) | | | |
| Consistency (avg) | | | |
| Background after rembg (avg) | | | |
| Better rembg model | | | |
| Prompt match (avg) | | | |
| Usable as-is (avg) | | | |
| **Overall average** | | | |
| Limits / issues noticed | | | |

**Decision:**
- Default provider: `________`
- Fallback provider: `________`
- Default rembg model: `________`
- Best prompt wording found: `________________________________________`

**Follow-up:**
- [ ] `data-contracts.md` §4 updated with `PROVIDER`, `FALLBACK_PROVIDER`, model ids and the confirmed endpoint/response format
- [ ] Best prompt wording copied into `prompts/presets.yaml`
- [ ] 3–5 good and 3–5 bad outputs saved to `shared/fixtures/raw/` for Phase 2 tests
- [ ] Result shared with the team / lead
