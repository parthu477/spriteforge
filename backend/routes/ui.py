from flask import Blueprint, render_template, session, send_from_directory
from pathlib import Path
import secrets

ui_bp = Blueprint("ui", __name__)

_frontend = Path(__file__).resolve().parent.parent.parent / "frontend"


@ui_bp.route("/")
def index():
    # Inject a fresh CSRF token for the page
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)
    return render_template("index.html", csrf_token=session["csrf_token"])


# ── Issue #34: Game Sandbox page ──────────────────────────────
@ui_bp.route("/game")
def game():
    """Serve the multi-biome parallax game sandbox (Issue #34)."""
    return send_from_directory(str(_frontend), "game.html")


# ── Static routes for new JS/CSS files (Issue #34) ───────────
@ui_bp.route("/static/js/biome-parallax.js")
def biome_parallax_js():
    return send_from_directory(str(_frontend / "js"), "biome-parallax.js")


@ui_bp.route("/static/js/audio-engine.js")
def audio_engine_js():
    return send_from_directory(str(_frontend / "js"), "audio-engine.js")


@ui_bp.route("/static/js/game-sandbox.js")
def game_sandbox_js():
    return send_from_directory(str(_frontend / "js"), "game-sandbox.js")


@ui_bp.route("/static/css/game.css")
def game_css():
    return send_from_directory(str(_frontend / "css"), "game.css")
