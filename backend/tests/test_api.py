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

    def test_animation_previewer_elements_present(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8")
        # AC 21.1: Canvas in result-card
        assert 'id="animation-canvas"' in content
        assert 'id="canvas-viewport"' in content
        # AC 21.2: Playback controls and Scrubber
        assert 'id="btn-play-pause"' in content
        assert 'id="btn-step-prev"' in content
        assert 'id="btn-step-next"' in content
        assert 'id="frame-scrubber"' in content
        # AC 21.3: FPS slider
        assert 'id="fps-slider"' in content
        # AC 21.4: Zoom buttons
        assert 'data-zoom="1"' in content
        assert 'data-zoom="2"' in content
        assert 'data-zoom="4"' in content
        assert 'data-zoom="8"' in content
        # AC 21.5: Background theme buttons
        assert 'data-theme="checkered"' in content
        assert 'data-theme="dark"' in content
        assert 'data-theme="light"' in content
        assert 'data-theme="stage"' in content

    def test_static_assets_serve_previewer_code(self, client):
        css_resp = client.get("/static/css/style.css")
        assert css_resp.status_code == 200
        css = css_resp.data.decode("utf-8")
        assert "animation-previewer" in css
        assert "image-rendering: pixelated" in css
        assert "theme-checkered" in css
        assert "theme-stage" in css

        js_resp = client.get("/static/js/app.js")
        assert js_resp.status_code == 200
        js = js_resp.data.decode("utf-8")
        assert "SpriteAnimationPlayer" in js
        assert "animationPlayer.mount" in js



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


class TestSSEStream:
    """Tests for Server-Sent Events (SSE) progress streaming (US-25 / AC 25.1-25.5)."""

    def test_stream_malformed_job_id_404(self, client):
        resp = client.get("/api/jobs/not-a-valid-id/stream")
        assert resp.status_code == 404

    def test_stream_unknown_job_404(self, client):
        resp = client.get("/api/jobs/0123456789abcdef0123456789abcdef/stream")
        assert resp.status_code == 404

    def test_stream_headers_and_initial_event(self, client):
        from backend.routes.api import _job_store
        job_id = _job_store.enqueue(lambda jid: None)
        assert job_id is not None

        resp = client.get(f"/api/jobs/{job_id}/stream")
        assert resp.status_code == 200
        assert resp.mimetype == "text/event-stream"
        assert "no-cache" in resp.headers.get("Cache-Control", "")

    def test_stream_completed_job_closes_cleanly(self, client):
        from backend.routes.api import _job_store
        job_id = _job_store.enqueue(lambda jid: None)
        _job_store.complete(job_id, {"frame_count": 4}, "/api/sprites/test.png")

        resp = client.get(f"/api/jobs/{job_id}/stream")
        assert resp.status_code == 200

        # Read the stream chunks
        raw_events = [c.decode("utf-8") if isinstance(c, bytes) else c for c in resp.response]
        full_text = "".join(raw_events)
        assert "data:" in full_text

        # Extract JSON data from first event
        data_line = [line for line in full_text.splitlines() if line.startswith("data:")][0]
        event = json.loads(data_line[len("data:"):].strip())
        assert event["status"] == "done"
        assert event["stage"] == "done"
        assert event["progress"] == 100
        assert event["preview_url"] == "/api/sprites/test.png"

    def test_stream_stage_transitions_and_progress(self, client):
        from backend.routes.api import _job_store
        job_id = _job_store.enqueue(lambda jid: None)

        # Emulate stage transitions
        _job_store.update_stage(job_id, "generating", progress=25, eta_seconds=8.0)
        _job_store.update_stage(job_id, "removing_background", progress=60, eta_seconds=4.0)
        _job_store.update_stage(job_id, "processing", progress=80, eta_seconds=2.0)
        _job_store.update_stage(job_id, "exporting", progress=95, eta_seconds=0.5)
        _job_store.complete(job_id, {"frame_count": 4}, "/api/sprites/knight.png")

        resp = client.get(f"/api/jobs/{job_id}/stream")
        raw_events = [c.decode("utf-8") if isinstance(c, bytes) else c for c in resp.response]
        full_text = "".join(raw_events)

        data_lines = [line for line in full_text.splitlines() if line.startswith("data:")]
        events = [json.loads(line[len("data:"):].strip()) for line in data_lines]
        assert len(events) >= 1
        last_event = events[-1]
        assert last_event["status"] == "done"
        assert last_event["progress"] == 100
        assert last_event["eta_seconds"] == 0.0

    def test_stream_failed_job_closes_cleanly(self, client):
        from backend.routes.api import _job_store
        job_id = _job_store.enqueue(lambda jid: None)
        _job_store.fail(job_id, "generating", "provider_auth", "Invalid API key")

        resp = client.get(f"/api/jobs/{job_id}/stream")
        raw_events = [c.decode("utf-8") if isinstance(c, bytes) else c for c in resp.response]
        full_text = "".join(raw_events)

        data_lines = [line for line in full_text.splitlines() if line.startswith("data:")]
        events = [json.loads(line[len("data:"):].strip()) for line in data_lines]
        assert len(events) >= 1
        failed_event = events[-1]
        assert failed_event["status"] == "failed"
        assert failed_event["stage"] == "generating"
        assert failed_event["error"]["code"] == "provider_auth"

    def test_stream_unsubscribe_on_disconnect(self, client):
        from backend.routes.api import _job_store
        job_id = _job_store.enqueue(lambda jid: None)
        # Ensure job is still running so listener would be registered
        _job_store.update_stage(job_id, "generating")

        resp = client.get(f"/api/jobs/{job_id}/stream")
        # Trigger iterator once, then close it (simulating client disconnection)
        it = iter(resp.response)
        first_chunk = next(it)
        assert b"data:" in first_chunk or "data:" in str(first_chunk)
        resp.response.close()

        # Verify listener was removed to prevent memory leak
        with _job_store._lock:
            listeners = _job_store._listeners.get(job_id, set())
            assert len(listeners) == 0


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
