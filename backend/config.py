# ==============================================================
# SpriteForge Backend — config.py
# US-16: Centralised configuration & fail-fast startup checks
# ==============================================================
"""Load .env, validate all required settings, and expose a
frozen Config object.  Import this module early (in app.py /
create_app) so any misconfiguration kills the process before any
request is ever handled.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the backend directory (or wherever the process is started from)
load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

# Configure U2NET_HOME so rembg models are stored in project data/models directory
# and can be pre-cached during build time on cloud hosts like Render.
if "U2NET_HOME" not in os.environ:
    os.environ["U2NET_HOME"] = str((Path(__file__).parent / "data" / "models").resolve())


def _require(key: str) -> str:
    v = os.environ.get(key, "").strip()
    if not v:
        _fatal(f"Missing required environment variable: {key}")
    return v


def _fatal(msg: str) -> None:
    print(f"[SpriteForge] CONFIG ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _resolve_asset_dir() -> Path:
    raw = os.environ.get("ASSET_DIR", "../assets/sprites").strip()
    raw_p = Path(raw)
    if raw_p.is_absolute():
        p = raw_p.resolve()
    else:
        p = (Path(__file__).parent / raw).resolve()
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        _fatal(f"ASSET_DIR '{p}' cannot be created: {exc}")
    if not os.access(p, os.W_OK):
        _fatal(f"ASSET_DIR '{p}' is not writable. Check permissions.")
    return p


class Config:
    """Single source of truth for all runtime configuration."""

    # ── provider ──────────────────────────────────────────────
    PROVIDER: str = os.environ.get("PROVIDER", "cloudflare").strip().lower()
    FALLBACK_PROVIDER: str = os.environ.get("FALLBACK_PROVIDER", "local_cpu").strip().lower()
    PROVIDER_TIMEOUT_S: int = int(os.environ.get("PROVIDER_TIMEOUT_S", "120"))
    PROVIDER_MAX_RETRIES: int = int(os.environ.get("PROVIDER_MAX_RETRIES", "3"))

    # ── Cloudflare (Option A) ─────────────────────────────────
    CF_ACCOUNT_ID: str = os.environ.get("CF_ACCOUNT_ID", "")
    CF_API_TOKEN: str = os.environ.get("CF_API_TOKEN", "")
    CF_MODEL_ID: str = os.environ.get(
        "CF_MODEL_ID", "@cf/black-forest-labs/flux-1-schnell"
    )
    CF_STEPS: int = int(os.environ.get("CF_STEPS", "4"))

    # ── Local CPU (Option B) ──────────────────────────────────
    LOCAL_MODEL_ID: str = os.environ.get("LOCAL_MODEL_ID", "stabilityai/sd-turbo")
    LOCAL_MODEL_DIR: str = os.environ.get("LOCAL_MODEL_DIR", "../models/sd-turbo-ov")
    LOCAL_STEPS: int = int(os.environ.get("LOCAL_STEPS", "1"))

    # ── HuggingFace (Option C — optional) ────────────────────
    HF_TOKEN: str = os.environ.get("HF_TOKEN", "")
    HF_MODEL_ID: str = os.environ.get("HF_MODEL_ID", "")
    HF_API_URL: str = os.environ.get("HF_API_URL", "")

    # ── Google Gemini (Option D) ──────────────────────────────
    GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-image")

    # ── asset / image processing ──────────────────────────────
    ASSET_DIR: Path = _resolve_asset_dir()
    REMBG_MODEL: str = os.environ.get("REMBG_MODEL", "u2netp")
    ALPHA_THRESHOLD: int = int(os.environ.get("ALPHA_THRESHOLD", "16"))
    CELL_SIZE: int = int(os.environ.get("CELL_SIZE", "0"))
    MAX_IMAGE_BYTES: int = int(os.environ.get("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))
    MAX_TEXTURE_SIZE: int = int(os.environ.get("MAX_TEXTURE_SIZE", "4096"))

    # ── job queue ─────────────────────────────────────────────
    JOB_WORKERS: int = int(os.environ.get("JOB_WORKERS", "1"))
    MAX_QUEUED_JOBS: int = int(os.environ.get("MAX_QUEUED_JOBS", "5"))
    JOB_TTL_MIN: int = int(os.environ.get("JOB_TTL_MIN", "60"))
    RATE_LIMIT_PER_MIN: int = int(os.environ.get("RATE_LIMIT_PER_MIN", "6"))

    # ── Flask ──────────────────────────────────────────────────
    FLASK_HOST: str = os.environ.get("FLASK_HOST", "127.0.0.1").strip()
    FLASK_PORT: int = int(os.environ.get("FLASK_PORT", "5000"))
    FLASK_DEBUG: bool = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
    SECRET_KEY: str = os.environ.get(
        "SECRET_KEY", "spriteforge_session_secret_key_default_2026_fallback"
    )

    # ── logging ───────────────────────────────────────────────
    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()

    @classmethod
    def validate(cls) -> None:
        """Fail-fast on startup.  Call once before serving traffic."""
        # Security: refuse to bind externally by default (AC 16.3)
        # Cloud environments (Render, container deployments) set RENDER or PORT and bind via 0.0.0.0
        allowed_hosts = ("127.0.0.1", "localhost")
        if os.environ.get("RENDER") or os.environ.get("PORT"):
            allowed_hosts = ("127.0.0.1", "localhost", "0.0.0.0")
        if cls.FLASK_HOST not in allowed_hosts:
            _fatal(
                f"FLASK_HOST='{cls.FLASK_HOST}' would expose the server publicly. "
                "Only 127.0.0.1 is allowed."
            )
        if cls.FLASK_DEBUG:
            _fatal(
                "FLASK_DEBUG=True is not allowed in production. "
                "Unset it or set it to False."
            )

        # Provider credentials (AC 16.1)
        for provider in {cls.PROVIDER, cls.FALLBACK_PROVIDER} - {"", "none", "mock"}:
            if provider == "cloudflare":
                if not cls.CF_ACCOUNT_ID or not cls.CF_API_TOKEN:
                    _fatal(
                        "PROVIDER=cloudflare requires CF_ACCOUNT_ID and CF_API_TOKEN "
                        "to be set in .env"
                    )
            elif provider == "local_cpu":
                pass  # model dir validated at provider init time
            elif provider == "huggingface":
                if not cls.HF_TOKEN:
                    _fatal("PROVIDER=huggingface requires HF_TOKEN to be set in .env")
            elif provider == "gemini":
                if not cls.GEMINI_API_KEY:
                    _fatal("PROVIDER=gemini requires GEMINI_API_KEY to be set in .env")

        # ASSET_DIR writability already checked in _resolve_asset_dir()
        # Clean up leftover temp files from a previous crash (AC 12 / startup hygiene)
        _cleanup_temp_files(cls.ASSET_DIR)


def _cleanup_temp_files(asset_dir: Path) -> None:
    """Remove *.tmp files left by a previous crashed run."""
    for tmp in asset_dir.glob(".*.tmp"):
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


cfg = Config()
