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
        assert "export-dropdown" in css
        assert "export-option" in css
        assert "downloadExport" in js

    def test_export_dropdown_elements_present(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8")
        # AC 24.5: Export dropdown and options
        assert 'id="export-dropdown"' in content
        assert 'id="export-dropdown-btn"' in content
        assert 'id="export-menu"' in content
        assert 'data-format="png"' in content
        assert 'data-format="godot"' in content
        assert 'data-format="unity"' in content
        assert 'data-format="gif"' in content
        assert 'data-format="aseprite"' in content

    def test_multi_action_ui_elements(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8")
        # AC 23.3: Multi-Action toggle and state machine chips
        assert 'id="multi-action-toggle"' in content
        assert "Multi-Action Character" in content
        assert 'id="action-tracks-bar"' in content
        assert "Row 0: Idle" in content
        assert "Row 1: Walk" in content
        assert "Row 2: Attack" in content
        assert "Row 3: Hurt" in content

    def test_palette_and_outline_ui_elements(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8")
        # AC 22.4: Palette dropdown and outline toggle
        assert 'id="palette-select"' in content
        assert 'value="original"' in content
        assert 'value="pico-8"' in content
        assert 'value="gameboy"' in content
        assert 'value="nes"' in content
        assert 'value="endesga-32"' in content
        assert 'id="outline-toggle"' in content




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

    def test_csrf_render_origin_accepted(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={"prompt": "knight walking", "grid": "1x4", "style": "pixel_art"},
            headers={
                "X-CSRF-Token": "valid_token",
                "Origin": "https://spriteforge.onrender.com",
            },
        )
        assert resp.status_code == 202
        data = resp.get_json()
        assert "job_id" in data
        assert data["status"] == "queued"

    def test_csrf_forwarded_host_accepted(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={"prompt": "knight walking", "grid": "1x4", "style": "pixel_art"},
            headers={
                "X-CSRF-Token": "valid_token",
                "Origin": "https://mygame.com",
                "X-Forwarded-Host": "mygame.com",
            },
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

    def test_multi_action_request_accepted(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={
                "prompt": "retro wizard",
                "grid": "4x4",
                "style": "pixel_art",
                "multi_action": True,
            },
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 202
        data = resp.get_json()
        assert "job_id" in data
        assert data["status"] == "queued"

    def test_multi_action_with_non_4x4_rejected(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={
                "prompt": "retro wizard",
                "grid": "1x4",
                "style": "pixel_art",
                "multi_action": True,
            },
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"] == "validation_error"
        assert "grid" in data["fields"]

    def test_multi_action_job_produces_animations_metadata(self, monkeypatch):
        from backend.routes.api import _run_job, _job_store, cfg

        monkeypatch.setattr(cfg, "PROVIDER", "mock")
        monkeypatch.setattr(cfg, "FALLBACK_PROVIDER", "none")

        job_id = _job_store.enqueue(lambda jid: None)
        assert job_id is not None

        _run_job(
            job_id=job_id,
            short_id=job_id[:6],
            prompt="cyberpunk cyborg",
            name="cyborg",
            style="pixel_art",
            seed=42,
            rows=4,
            columns=4,
            multi_action=True,
        )

        job = _job_store.get(job_id)
        assert job.status == "done"
        assert job.metadata is not None
        assert "animations" in job.metadata
        anims = job.metadata["animations"]
        # AC 23.2 named animation tracks
        assert anims["idle"] == {"row": 0, "frames": 4, "fps": 8, "loop": True}
        assert anims["walk"] == {"row": 1, "frames": 4, "fps": 8, "loop": True}
        assert anims["attack"] == {"row": 2, "frames": 4, "fps": 10, "loop": False}
        assert anims["hurt"] == {"row": 3, "frames": 4, "fps": 8, "loop": False}

    def test_single_row_job_does_not_contain_animations_metadata(self, monkeypatch):
        from backend.routes.api import _run_job, _job_store, cfg

        monkeypatch.setattr(cfg, "PROVIDER", "mock")
        monkeypatch.setattr(cfg, "FALLBACK_PROVIDER", "none")

        job_id = _job_store.enqueue(lambda jid: None)
        assert job_id is not None

        _run_job(
            job_id=job_id,
            short_id=job_id[:6],
            prompt="cyberpunk cyborg",
            name="cyborg",
            style="pixel_art",
            seed=42,
            rows=1,
            columns=4,
            multi_action=False,
        )

        job = _job_store.get(job_id)
        assert job.status == "done"
        assert job.metadata is not None
        # AC 23.4 backward compatibility
        assert "animations" not in job.metadata

    def test_palette_and_outline_request_accepted(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={
                "prompt": "pixel rogue",
                "grid": "1x4",
                "style": "pixel_art",
                "palette": "pico-8",
                "outline": True,
            },
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 202
        data = resp.get_json()
        assert "job_id" in data
        assert data["status"] == "queued"

    def test_invalid_palette_rejected(self, client):
        with client.session_transaction() as sess:
            sess["csrf_token"] = "valid_token"

        resp = client.post(
            "/api/generate",
            json={
                "prompt": "pixel rogue",
                "grid": "1x4",
                "style": "pixel_art",
                "palette": "unknown-pal",
            },
            headers={"X-CSRF-Token": "valid_token", "Origin": "http://127.0.0.1:5000"},
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"] == "validation_error"
        assert "palette" in data["fields"]

    def test_postprocessing_job_records_source_metadata(self, monkeypatch):
        from backend.routes.api import _run_job, _job_store, cfg

        monkeypatch.setattr(cfg, "PROVIDER", "mock")
        monkeypatch.setattr(cfg, "FALLBACK_PROVIDER", "none")

        job_id = _job_store.enqueue(lambda jid: None)
        assert job_id is not None

        _run_job(
            job_id=job_id,
            short_id=job_id[:6],
            prompt="pixel rogue",
            name="rogue",
            style="pixel_art",
            seed=42,
            rows=1,
            columns=4,
            palette="pico-8",
            outline=True,
        )

        job = _job_store.get(job_id)
        assert job.status == "done"
        assert job.metadata is not None
        assert job.metadata["source"]["palette"] == "pico-8"
        assert job.metadata["source"]["outline"] is True


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


class TestExportEndpoints:
    def test_export_invalid_format(self, client):
        resp = client.get("/api/sprites/nonexistent/export/bmp")
        assert resp.status_code == 400
        data = resp.get_json()
        assert data["error"] == "invalid_format"

    def test_export_nonexistent_sprite(self, client):
        resp = client.get("/api/sprites/nonexistent_sprite_123/export/png")
        assert resp.status_code == 404

    def test_export_all_formats_success(self, client, tmp_path, monkeypatch):
        from backend.config import cfg
        from PIL import Image

        monkeypatch.setattr(cfg, "ASSET_DIR", tmp_path)

        img = Image.new("RGBA", (128, 32), (255, 0, 0, 255))
        img.save(tmp_path / "dragon_walk.png")
        meta = {
            "name": "dragon_walk",
            "image_file": "dragon_walk.png",
            "frame_width": 32,
            "frame_height": 32,
            "rows": 1,
            "columns": 4,
            "frame_count": 4,
            "fps": 8,
            "loop": True,
        }
        (tmp_path / "dragon_walk.json").write_text(json.dumps(meta), encoding="utf-8")

        # AC 24.5: PNG Export
        resp_png = client.get("/api/sprites/dragon_walk/export/png")
        assert resp_png.status_code == 200
        assert resp_png.mimetype == "image/png"
        assert "attachment" in resp_png.headers.get("Content-Disposition", "")

        # AC 24.1: Godot 4 (.tres) Export
        resp_godot = client.get("/api/sprites/dragon_walk/export/godot")
        assert resp_godot.status_code == 200
        assert "attachment" in resp_godot.headers.get("Content-Disposition", "")
        assert "SpriteFrames" in resp_godot.data.decode("utf-8")

        # AC 24.2: Unity (.meta) Export
        resp_unity = client.get("/api/sprites/dragon_walk/export/unity")
        assert resp_unity.status_code == 200
        assert "attachment" in resp_unity.headers.get("Content-Disposition", "")
        meta_content = resp_unity.data.decode("utf-8")
        assert "TextureImporter:" in meta_content
        assert "filterMode: 0" in meta_content

        # AC 24.3: Animated GIF Export
        resp_gif = client.get("/api/sprites/dragon_walk/export/gif")
        assert resp_gif.status_code == 200
        assert resp_gif.mimetype == "image/gif"
        assert "attachment" in resp_gif.headers.get("Content-Disposition", "")
        assert resp_gif.data.startswith(b"GIF89a")

        # AC 24.4: Aseprite (JSON) Export
        resp_ase = client.get("/api/sprites/dragon_walk/export/aseprite")
        assert resp_ase.status_code == 200
        assert resp_ase.mimetype == "application/json"
        assert "attachment" in resp_ase.headers.get("Content-Disposition", "")
        ase_data = json.loads(resp_ase.data.decode("utf-8"))
        assert len(ase_data["frames"]) == 4
        assert ase_data["meta"]["app"] == "SpriteForge"


class TestSpriteServingCORS:
    def test_serve_sprite_cors_headers(self, client, monkeypatch, tmp_path):
        from PIL import Image
        from backend.config import cfg
        monkeypatch.setattr(cfg, "ASSET_DIR", tmp_path)

        img = Image.new("RGBA", (64, 64), (255, 0, 0, 255))
        img.save(tmp_path / "test_car.png")

        # GET request should include CORS headers
        resp = client.get("/api/sprites/test_car.png")
        assert resp.status_code == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "*"

        # OPTIONS preflight request
        resp_options = client.options("/api/sprites/test_car.png")
        assert resp_options.status_code in (200, 204)
        assert resp_options.headers.get("Access-Control-Allow-Origin") == "*"

    def test_list_sprites_excludes_aseprite_json(self, client, monkeypatch, tmp_path):
        from backend.config import cfg
        monkeypatch.setattr(cfg, "ASSET_DIR", tmp_path)

        # Primary sprite metadata
        meta = {"name": "car_primary", "image_file": "car_primary.png"}
        (tmp_path / "car_primary.json").write_text(json.dumps(meta), encoding="utf-8")

        # Secondary Aseprite export metadata
        ase_meta = {"frames": {}, "meta": {"app": "SpriteForge"}}
        (tmp_path / "car_primary_aseprite.json").write_text(json.dumps(ase_meta), encoding="utf-8")

        with client.session_transaction() as sess:
            sess["user_id"] = "usr_test"
            sess["username"] = "testuser"

        resp = client.get("/api/sprites")
        assert resp.status_code == 200
        sprites = resp.get_json()
        assert len(sprites) == 1
        assert sprites[0]["name"] == "car_primary"
        assert sprites[0]["image_url"] == "/api/sprites/car_primary.png"


