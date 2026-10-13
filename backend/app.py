# ==============================================================
# SpriteForge Backend — app.py
# Flask application factory (US-16, Architecture Layer 1)
# Binds strictly to 127.0.0.1 (AC 16.3)
# ==============================================================
from __future__ import annotations

import logging

from flask import Flask

from backend.config import cfg
from backend.logging_setup import setup_logging
from backend.jobs import JobStore
from backend.routes.ui import ui_bp
from backend.routes.api import api_bp, init_api

log = logging.getLogger(__name__)

# Module-level job store (singleton)
_job_store: JobStore | None = None


def create_app() -> Flask:
    """Application factory — call once at startup."""
    # ── 1. Logging ─────────────────────────────────────────────
    setup_logging(cfg.LOG_LEVEL)

    # ── 2. Fail-fast config validation ─────────────────────────
    cfg.validate()

    # ── 3. Flask app ────────────────────────────────────────────
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )
    app.secret_key = cfg.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = 4 * 1024  # 4 KB request limit

    # ── 4. Job store ─────────────────────────────────────────────
    global _job_store
    _job_store = JobStore(
        workers=cfg.JOB_WORKERS,
        max_queued=cfg.MAX_QUEUED_JOBS,
        ttl_minutes=cfg.JOB_TTL_MIN,
    )
    init_api(_job_store)

    # ── 5. Blueprints ─────────────────────────────────────────────
    app.register_blueprint(ui_bp)
    app.register_blueprint(api_bp)

    log.info(
        "SpriteForge started — provider=%s fallback=%s asset_dir=%s",
        cfg.PROVIDER,
        cfg.FALLBACK_PROVIDER,
        cfg.ASSET_DIR,
    )
    return app


if __name__ == "__main__":
    application = create_app()
    application.run(
        host=cfg.FLASK_HOST,
        port=cfg.FLASK_PORT,
        debug=False,  # Never True in production (AC 16.3)
    )
