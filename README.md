# SpriteForge

SpriteForge is an AI-powered 2D game sprite generator and interactive physics sandbox. Generate pixel-art sprites with Cloudflare Workers AI (FLUX.1-schnell), automatically remove backgrounds, and test drive vehicles and characters in real-time across dynamic multi-biome parallax environments with undulating hills, obstacles, fuel endurance, and retro audio FX.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/parthu477/spriteforge)

---

## Deploying to Render

You can deploy SpriteForge to Render in two ways:

### Option 1: One-Click Deploy (Render Blueprint)
1. Click the **Deploy to Render** button above, or go to [dashboard.render.com/select-repo?type=blueprint](https://dashboard.render.com/select-repo?type=blueprint).
2. Connect your GitHub repository (`parthu477/spriteforge`).
3. Render will automatically read [`render.yaml`](./render.yaml).
4. In the Environment Variables section, fill in your Cloudflare credentials:
   - `CF_ACCOUNT_ID`: Your 32-character Cloudflare Account ID (from [dash.cloudflare.com](https://dash.cloudflare.com/)).
   - `CF_API_TOKEN`: Your Cloudflare Workers AI API Token.
5. Click **Apply**. Render will build and deploy the service.

---

### Option 2: Manual Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** > **Web Service**.
2. Select your repository: `parthu477/spriteforge`.
3. Configure the settings:
   - **Name**: `spriteforge`
   - **Region**: Oregon (or your preferred region)
   - **Branch**: `main`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn "backend.app:create_app()" --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`
   - **Plan**: `Free`
4. Add the following **Environment Variables**:
   | Variable | Value | Description |
   |---|---|---|
   | `PYTHON_VERSION` | `3.12.3` | Python runtime version |
   | `PROVIDER` | `cloudflare` | Image generation provider |
   | `FALLBACK_PROVIDER` | `mock` | Fallback provider if API is unavailable |
   | `CF_ACCOUNT_ID` | `your_account_id` | Cloudflare 32-character Account ID |
   | `CF_API_TOKEN` | `your_api_token` | Cloudflare API Token |
   | `CF_MODEL_ID` | `@cf/black-forest-labs/flux-1-schnell` | Workers AI model |
   | `CF_STEPS` | `4` | Generation inference steps |
   | `FLASK_HOST` | `0.0.0.0` | Host binding for cloud deployment |
   | `FLASK_DEBUG` | `false` | Production debug flag |
   | `LOG_LEVEL` | `INFO` | Logger output level |
   | `SECRET_KEY` | *(generate random 32-char hex)* | Session secret key |
5. Click **Create Web Service**.

---

## Local Development

```bash
# 1. Install dependencies
pip install -r backend/requirements.txt

# 2. Configure .env
cp backend/.env.example backend/.env
# Edit backend/.env with your CF_ACCOUNT_ID and CF_API_TOKEN

# 3. Start development server
python backend/app.py
# Open http://127.0.0.1:5000 in your browser
```

## Running Tests

```bash
python -m pytest -q
```
