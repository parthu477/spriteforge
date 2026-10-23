# ==============================================================
# backend/tests/test_auth.py
# Unit and integration tests for Issue #46: Authentication & User Scoping
# ==============================================================
import json
import os
import shutil
import tempfile
from pathlib import Path
import pytest
from backend.app import create_app
from backend.config import cfg
from backend.services.auth_service import AuthService, auth_service


@pytest.fixture
def auth_test_db(tmp_path):
    """Provides an isolated SQLite database for auth testing."""
    db_file = tmp_path / "test_users.db"
    svc = AuthService(db_path=db_file)
    old_svc_db = auth_service.db_path
    auth_service.db_path = db_file
    auth_service._ensure_db()
    yield svc
    auth_service.db_path = old_svc_db


@pytest.fixture
def app(auth_test_db, tmp_path):
    assets_tmp = tmp_path / "test_assets"
    assets_tmp.mkdir(parents=True, exist_ok=True)
    cfg.ASSET_DIR = assets_tmp

    app = create_app()
    app.config["TESTING"] = True
    yield app


@pytest.fixture
def client(app):
    return app.test_client()


class TestAuthServiceUnit:
    """Test AuthService unit logic directly."""

    def test_validate_username(self, auth_test_db):
        assert auth_test_db.validate_username("valid_user-1") is None
        assert auth_test_db.validate_username("ab") is not None  # too short
        assert auth_test_db.validate_username("a" * 33) is not None  # too long
        assert auth_test_db.validate_username("bad user!") is not None  # invalid chars

    def test_validate_password(self, auth_test_db):
        assert auth_test_db.validate_password("securepassword123") is None
        assert auth_test_db.validate_password("short") is not None  # < 8 chars

    def test_register_and_authenticate(self, auth_test_db):
        user = auth_test_db.register("pixelmaster", "password123", "Pixel Master")
        assert user["username"] == "pixelmaster"
        assert user["display_name"] == "Pixel Master"
        assert user["id"].startswith("usr_")

        # Duplicate username throws ValueError
        with pytest.raises(ValueError):
            auth_test_db.register("pixelmaster", "differentpass89")

        # Authenticate success
        auth_user = auth_test_db.authenticate("pixelmaster", "password123")
        assert auth_user is not None
        assert auth_user["id"] == user["id"]

        # Authenticate failure (bad password)
        assert auth_test_db.authenticate("pixelmaster", "wrongpass") is None

        # Authenticate failure (unknown user)
        assert auth_test_db.authenticate("nonexistent", "password123") is None


class TestAuthEndpoints:
    """Test auth endpoints over HTTP."""

    def test_registration_and_login_flow(self, client):
        # Initial /api/auth/me should be unauthenticated
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        assert resp.get_json()["authenticated"] is False

        # Register new user
        reg_resp = client.post(
            "/api/auth/register",
            json={
                "username": "creator_one",
                "password": "strongpassword123",
                "display_name": "First Creator",
            },
        )
        assert reg_resp.status_code == 201
        reg_data = reg_resp.get_json()
        assert reg_data["status"] == "ok"
        user_id = reg_data["user"]["id"]

        # Session is now established
        me_resp = client.get("/api/auth/me")
        assert me_resp.status_code == 200
        me_data = me_resp.get_json()
        assert me_data["authenticated"] is True
        assert me_data["user"]["id"] == user_id
        assert me_data["user"]["username"] == "creator_one"

        # Logout
        logout_resp = client.post("/api/auth/logout")
        assert logout_resp.status_code == 200

        # After logout
        me_after = client.get("/api/auth/me")
        assert me_after.get_json()["authenticated"] is False

        # Log back in
        login_resp = client.post(
            "/api/auth/login",
            json={
                "username": "creator_one",
                "password": "strongpassword123",
            },
        )
        assert login_resp.status_code == 200
        assert login_resp.get_json()["user"]["username"] == "creator_one"

    def test_invalid_login_credentials(self, client):
        resp = client.post(
            "/api/auth/login",
            json={"username": "fakeuser", "password": "wrongpassword123"},
        )
        assert resp.status_code == 401
        assert resp.get_json()["error"] == "invalid_credentials"


class TestRouteGuardsAndIsolation:
    """Test UI redirection and API 401 guards when auth is enforced."""

    def test_ui_unauthenticated_redirect(self, client):
        # When unauthenticated and X-Require-Auth header is provided
        headers = {"X-Require-Auth": "1"}
        resp = client.get("/", headers=headers)
        assert resp.status_code == 302
        assert "/login?next=/" in resp.headers["Location"]

        resp_game = client.get("/game", headers=headers)
        assert resp_game.status_code == 302
        assert "/login?next=/game" in resp_game.headers["Location"]

    def test_login_page_renders(self, client):
        resp = client.get("/login")
        assert resp.status_code == 200
        assert b"Sign In" in resp.data

    def test_api_unauthorized_when_auth_required(self, client):
        headers = {"X-Require-Auth": "1"}
        resp = client.get("/api/sprites", headers=headers)
        assert resp.status_code == 401
        assert resp.get_json()["error"] == "unauthorized"

    def test_user_scoped_asset_isolation(self, client):
        # Register User A
        client.post(
            "/api/auth/register",
            json={"username": "user_alpha", "password": "password123"},
        )
        me_a = client.get("/api/auth/me").get_json()["user"]
        user_a_id = me_a["id"]

        # Create asset owned by User A directly in ASSET_DIR
        sprite_a_json = cfg.ASSET_DIR / "alpha_hero.json"
        sprite_a_png = cfg.ASSET_DIR / "alpha_hero.png"
        sprite_a_png.write_bytes(b"\x89PNG\r\n\x1a\nfakeimage")
        sprite_a_json.write_text(
            json.dumps({
                "schema_version": 1,
                "name": "alpha_hero",
                "image_file": "alpha_hero.png",
                "frame_width": 32,
                "frame_height": 32,
                "rows": 1,
                "columns": 1,
                "frame_count": 1,
                "user_id": user_a_id,
            }),
            encoding="utf-8",
        )

        # User A lists sprites -> should see alpha_hero
        list_a = client.get("/api/sprites").get_json()
        assert any(s["name"] == "alpha_hero" for s in list_a)

        # User A logs out
        client.post("/api/auth/logout")

        # Register User B
        client.post(
            "/api/auth/register",
            json={"username": "user_beta", "password": "password456"},
        )

        # User B lists sprites -> should NOT see alpha_hero (isolated!)
        list_b = client.get("/api/sprites").get_json()
        assert not any(s["name"] == "alpha_hero" for s in list_b)

        # User B attempts to export User A's sprite -> 403 Forbidden!
        export_resp = client.get("/api/sprites/alpha_hero/export/png")
        assert export_resp.status_code == 403
        assert export_resp.get_json()["error"] == "forbidden"

        # User B attempts to delete User A's sprite -> 403 Forbidden!
        csrf_token = "dummy_csrf_for_test"
        with client.session_transaction() as sess:
            sess["csrf_token"] = csrf_token
        del_resp = client.delete(
            "/api/sprites/alpha_hero",
            headers={"Origin": "http://127.0.0.1:5000", "X-CSRF-Token": csrf_token},
        )
        assert del_resp.status_code == 403
        assert del_resp.get_json()["error"] == "forbidden"
        assert sprite_a_json.exists()  # Asset was preserved!
