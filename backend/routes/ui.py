from functools import wraps
from flask import Blueprint, render_template, session, send_from_directory, redirect, request, current_app
from pathlib import Path
import secrets

from backend.routes.auth import get_current_user

ui_bp = Blueprint("ui", __name__)

_frontend = Path(__file__).resolve().parent.parent.parent / "frontend"


def ui_login_required(f):
    """Route decorator redirecting unauthenticated browser users to /login?next=<path>."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if current_app.config.get("TESTING") and not request.headers.get("X-Require-Auth"):
            return f(*args, **kwargs)
        user = get_current_user()
        if not user:
            return redirect(f"/login?next={request.path}")
        return f(*args, **kwargs)

    return decorated


@ui_bp.route("/login")
def login_page():
    """Dedicated Login / Registration view (Issue #46)."""
    return send_from_directory(str(_frontend), "login.html")


@ui_bp.route("/")
@ui_login_required
def index():
    # Inject a fresh CSRF token for the page
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)
    return render_template("index.html", csrf_token=session["csrf_token"])


# ── Issue #34: Game Sandbox page ──────────────────────────────
@ui_bp.route("/game")
@ui_login_required
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


# ── Issue #31: Physics Sandbox page ───────────────────────────
@ui_bp.route("/physics")
@ui_login_required
def physics():
    """Serve the 2D procedural terrain + spring suspension physics sandbox (Issue #31)."""
    return send_from_directory(str(_frontend), "physics.html")


# ── Static routes for Issue #31 JS/CSS files ─────────────────
@ui_bp.route("/static/js/terrain-engine.js")
def terrain_engine_js():
    return send_from_directory(str(_frontend / "js"), "terrain-engine.js")


@ui_bp.route("/static/js/physics-engine.js")
def physics_engine_js():
    return send_from_directory(str(_frontend / "js"), "physics-engine.js")


@ui_bp.route("/static/js/physics-game.js")
def physics_game_js():
    return send_from_directory(str(_frontend / "js"), "physics-game.js")


@ui_bp.route("/static/css/physics-game.css")
def physics_game_css():
    return send_from_directory(str(_frontend / "css"), "physics-game.css")


# ── Static route for Issue #47 Auth JS ───────────────────────
@ui_bp.route("/static/js/auth.js")
def auth_js():
    return send_from_directory(str(_frontend / "js"), "auth.js")
