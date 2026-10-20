# ==============================================================
# SpriteForge Backend — app.py
# Flask application factory (US-16, Architecture Layer 1)
# Binds strictly to 127.0.0.1 (AC 16.3)
# ==============================================================
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Ensure repo root is on sys.path
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from flask import Flask, request

from backend.config import cfg
from backend.logging_setup import setup_logging
from backend.jobs import JobStore
from backend.routes.ui import ui_bp
from backend.routes.api import api_bp, init_api
from backend.routes.auth import auth_bp

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
    frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
    app = Flask(
        __name__,
        template_folder=str(frontend_dir),
        static_folder=str(frontend_dir),
        static_url_path="/static",
    )
    app.secret_key = cfg.SECRET_KEY
    app.config["MAX_CONTENT_LENGTH"] = 4 * 1024  # 4 KB request limit
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

    @app.after_request
    def no_cache_static(response):
        """Dev-mode: never let the browser cache our pages/JS/CSS, so every code
        change is picked up on the next reload instead of silently serving a stale
        cached copy (HTML included — not just /static/*)."""
        if request.path.startswith("/api/sprites/"):
            return response  # served images may still cache; everything else must not
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response


    # Backward compatibility for legacy static paths
    @app.route("/static/style.css")
    def legacy_style():
        from flask import send_from_directory
        return send_from_directory(str(frontend_dir / "css"), "style.css")

    @app.route("/static/app.js")
    def legacy_app_js():
        from flask import send_from_directory
        return send_from_directory(str(frontend_dir / "js"), "app.js")

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
    app.register_blueprint(auth_bp)

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
        threaded=True,
    )
