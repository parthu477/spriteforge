from flask import Blueprint, render_template, session
import secrets

ui_bp = Blueprint("ui", __name__)


@ui_bp.route("/")
def index():
    # Inject a fresh CSRF token for the page
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(32)
    return render_template("index.html", csrf_token=session["csrf_token"])
