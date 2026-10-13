# ==============================================================
# backend/tests/test_api.py
# Integration tests for Flask API routes (US-03, US-04, US-06, US-17, US-18)
# ==============================================================
import json
import pytest
from backend.app import create_app
from backend.jobs import JobStore


@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app):
    return app.test_client()


class TestHealthEndpoint:
    def test_health_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "ok"
        assert "provider" in data
        assert "asset_dir_writable" in data
        assert data["asset_dir_writable"] is True


class TestUIEndpoint:
    def test_index_page(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"SpriteForge" in resp.data
        assert b"csrf-token" in resp.data


class TestGenerateEndpoint:
    def test_csrf_missing_forbidden(self, client):
        resp = client.post(
            "/api/generate",
            json={"prompt": "knight walking", "grid": "1x4", "style": "pixel_art"},
        )
        assert resp.status_code == 403

    def test_csrf_wrong_origin_forbidden(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={"prompt": "knight walking", "grid": "1x4", "style": "pixel_art"},
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://evil.com"},
        )
        assert resp.status_code == 403

    def test_valid_request_accepted(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={"prompt": "knight walking", "grid": "1x4", "style": "pixel_art"},
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 202
        data = resp.get_json()
        assert "job_id" in data
        assert data["status"] == "queued"

    def test_invalid_payload_rejected(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={"prompt": "hi", "grid": "9x9", "style": "unknown"},
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"] == "validation_error"
        assert "prompt" in data["fields"]
        assert "grid" in data["fields"]


class TestJobStatus:
    def test_unknown_job_404(self, client):
        resp = client.get("/api/jobs/0123456789abcdef0123456789abcdef")
        assert resp.status_code == 404

    def test_malformed_job_id_404(self, client):
        resp = client.get("/api/jobs/not-a-valid-id")
        assert resp.status_code == 404


class TestSpritesEndpoint:
    def test_list_sprites(self, client):
        resp = client.get("/api/sprites")
        assert resp.status_code == 200
        assert isinstance(resp.get_json(), list)

    def test_delete_sprite_csrf_check(self, client):
        resp = client.delete("/api/sprites/test_sprite")
        assert resp.status_code == 403

    def test_delete_sprite_success(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.delete(
            "/api/sprites/test_sprite",
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 204
