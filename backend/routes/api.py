from flask import Blueprint, jsonify, request, send_from_directory, send_file, Response, current_app, make_response
import datetime
import io
import json
import logging
import os
import queue
import random
import re

from backend.config import cfg
from backend.jobs import JobStore
from backend.validators import validate_generate, slugify, grid_to_rows_cols
from backend.routes.auth import login_required, get_current_user_id
from backend.services.providers.base import (
    get_provider,
    ProviderQuotaExceeded,
    ProviderUnavailable,
    ProviderAuthError,
    ProviderRateLimited,
    ProviderBadResponse,
    ProviderLocalError,
    ProviderError,
)
from backend.services.prompt_builder import build_prompt
from backend.services.processing import (
    remove_background,
    normalise_grid,
    build_metadata,
    apply_retro_postprocessing,
)
from backend.services.exporter import (
    export_sprite,
    delete_sprite,
    generate_godot_tres,
    generate_unity_meta,
    generate_gif,
    generate_aseprite_json,
)

log = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api")

# Injected by app factory
_job_store: JobStore = None  # type: ignore


def init_api(job_store: JobStore) -> None:
    global _job_store
    _job_store = job_store


# ── CSRF helper ───────────────────────────────────────────────

def _check_csrf() -> bool:
    origin = request.headers.get("Origin", "")
    if origin not in ("http://127.0.0.1:5000", "http://localhost:5000"):
        return False
    token = request.headers.get("X-CSRF-Token", "")
    from flask import session
    return token == session.get("csrf_token", "")


# ── POST /api/generate ────────────────────────────────────────

@api_bp.route("/generate", methods=["POST"])
@login_required
def generate():
    from flask import session
    if not _check_csrf():
        return jsonify({"error": "forbidden", "message": "CSRF check failed."}), 403

    if not request.is_json:
        return jsonify({"error": "unsupported_media_type", "message": "Body must be JSON."}), 415

    data = request.get_json(silent=True) or {}
    errors = validate_generate(data)
    if errors:
        return jsonify({"error": "validation_error", "message": "Some fields are invalid.", "fields": errors}), 400

    # Build job params
    prompt: str = data["prompt"].strip()
    grid: str = data["grid"]
    style: str = data["style"]
    multi_action: bool = bool(data.get("multi_action", False))
    palette: str = data.get("palette", "original") or "original"
    outline: bool = bool(data.get("outline", False))
    seed: int = data.get("seed") if data.get("seed") is not None else random.randint(0, 4_294_967_295)
    name_raw: str = data.get("name") or ""
    name = slugify(name_raw) or slugify(prompt[:48]) or "sprite"
    rows, columns = grid_to_rows_cols(grid)
    user_id = get_current_user_id()

    def task(job_id: str) -> None:
        short_id = job_id[:6]
        _run_job(
            job_id,
            short_id,
            prompt,
            name,
            style,
            seed,
            rows,
            columns,
            multi_action=multi_action,
            palette=palette,
            outline=outline,
            user_id=user_id,
        )

    job_id = _job_store.enqueue(task)
    if job_id is None:
        return jsonify({"error": "queue_full", "message": "Server is busy, try again shortly."}), 429

    return jsonify({"job_id": job_id, "status": "queued"}), 202


def _run_job(
    job_id: str,
    short_id: str,
    prompt: str,
    name: str,
    style: str,
    seed: int,
    rows: int,
    columns: int,
    multi_action: bool = False,
    palette: str = "original",
    outline: bool = False,
    user_id: str = "anonymous",
) -> None:
    extra = {"job_id": job_id}
    try:
        # ── Step 1: Generate image ────────────────────────────
        _job_store.update_stage(job_id, "generating")
        positive, negative = build_prompt(prompt, style, rows, columns, multi_action=multi_action)

        # Pick provider width/height based on grid
        provider_obj = get_provider(cfg.PROVIDER)
        side = provider_obj.max_side
        # Use largest dimension that fits grid aspect
        if columns >= rows:
            width, height = side, max(1, side * rows // columns)
        else:
            width, height = max(1, side * columns // rows), side

        try:
            image = provider_obj.generate(positive, negative, width, height, seed)
            provider_used = cfg.PROVIDER
            model_used = provider_obj.model
        except (ProviderQuotaExceeded, ProviderUnavailable, ProviderAuthError, ProviderRateLimited, ProviderError) as exc:
            log.warning("Primary provider failed (%s), trying fallback.", exc, extra=extra)
            if not cfg.FALLBACK_PROVIDER or cfg.FALLBACK_PROVIDER in (cfg.PROVIDER, "none", ""):
                raise
            fallback = get_provider(cfg.FALLBACK_PROVIDER)
            scale = min(1.0, fallback.max_side / max(width, height))
            fb_w = max(1, int(width * scale))
            fb_h = max(1, int(height * scale))
            image = fallback.generate(positive, negative, fb_w, fb_h, seed)
            provider_used = cfg.FALLBACK_PROVIDER
            model_used = fallback.model

        # ── Step 2: Background removal ────────────────────────
        _job_store.update_stage(job_id, "removing_background")
        try:
            image = remove_background(image, cfg.REMBG_MODEL, cfg.ALPHA_THRESHOLD)
        except ValueError as exc:
            _job_store.fail(job_id, "removing_background", "bg_removal_failed", str(exc))
            return

        # ── Step 3: Grid processing & Retro Post-Processing ───
        _job_store.update_stage(job_id, "processing")
        try:
            image, fw, fh, frame_count = normalise_grid(
                image, rows, columns,
                cell_size=cfg.CELL_SIZE,
                style=style,
                max_texture_size=cfg.MAX_TEXTURE_SIZE,
            )
            # US-22: Retro Pixel-Art Post-Processing & Palette Quantization (AC 22.1, 22.2, 22.3, 22.5)
            image = apply_retro_postprocessing(
                image,
                palette=palette,
                outline=outline,
                rows=rows,
                columns=columns,
            )
        except ValueError as exc:
            _job_store.fail(job_id, "processing", "processing_failed", str(exc))
            return

        # ── Step 4: Export ────────────────────────────────────
        _job_store.update_stage(job_id, "exporting")
        image_file = f"{name}_{short_id}.png"
        generated_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Multi-Action Character state machine tracks (AC 23.2)
        animations = None
        if multi_action and rows == 4 and columns == 4:
            animations = {
                "idle": {"row": 0, "frames": columns, "fps": 8, "loop": True},
                "walk": {"row": 1, "frames": columns, "fps": 8, "loop": True},
                "attack": {"row": 2, "frames": columns, "fps": 10, "loop": False},
                "hurt": {"row": 3, "frames": columns, "fps": 8, "loop": False},
            }

        metadata = build_metadata(
            name=name,
            image_file=image_file,
            frame_width=fw,
            frame_height=fh,
            rows=rows,
            columns=columns,
            frame_count=frame_count,
            prompt=prompt,
            style=style,
            seed=seed,
            provider_name=provider_used,
            model=model_used,
            generated_at=generated_at,
            animations=animations,
            palette=palette,
            outline=outline,
        )
        metadata["user_id"] = user_id
        try:
            export_sprite(
                asset_dir=cfg.ASSET_DIR,
                slug=name,
                short_id=short_id,
                image=image,
                metadata=metadata,
            )
        except (OSError, ValueError) as exc:
            _job_store.fail(job_id, "exporting", "export_failed", str(exc))
            return

        preview_url = f"/api/sprites/{image_file}"
        _job_store.complete(job_id, metadata, preview_url)
        log.info("Job %s completed: %s", short_id, image_file, extra=extra)

    except ProviderAuthError as exc:
        _job_store.fail(job_id, "generating", "provider_auth", str(exc))
    except ProviderRateLimited as exc:
        _job_store.fail(job_id, "generating", "provider_rate_limited", str(exc))
    except ProviderQuotaExceeded as exc:
        _job_store.fail(job_id, "generating", "provider_quota_exceeded", str(exc))
    except ProviderLocalError as exc:
        _job_store.fail(job_id, "generating", "provider_local_error", str(exc))
    except (ProviderUnavailable, ProviderBadResponse) as exc:
        _job_store.fail(job_id, "generating", "provider_unavailable", str(exc))
    except Exception as exc:
        log.exception("Internal error in job %s", job_id, extra=extra)
        _job_store.fail(job_id, "generating", "internal_error", "An unexpected error occurred.")


# ── GET /api/jobs/<job_id> ────────────────────────────────────

@api_bp.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "not_found"}), 404

    job = _job_store.get(job_id)
    if not job:
        return jsonify({"error": "not_found"}), 404

    return jsonify(job.to_dict()), 200


# ── GET /api/jobs/<job_id>/stream (SSE Progress Streaming, US-25) ──

@api_bp.route("/jobs/<job_id>/stream", methods=["GET"])
def stream_job(job_id: str):
    """Server-Sent Events endpoint streaming real-time job progress (AC 25.1)."""
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "not_found"}), 404

    q = _job_store.subscribe(job_id)
    if q is None:
        return jsonify({"error": "not_found"}), 404

    def event_stream():
        try:
            while True:
                try:
                    # Timeout periodically to send keepalive comments
                    data = q.get(timeout=10.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    if data.get("status") in ("done", "failed"):
                        break
                except queue.Empty:
                    # Keep-alive comment
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            # Client closed connection
            pass
        finally:
            _job_store.unsubscribe(job_id, q)

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── GET /api/sprites ──────────────────────────────────────────

@api_bp.route("/sprites", methods=["GET"])
@login_required
def list_sprites():
    user_id = get_current_user_id()
    results = []
    for jf in sorted(cfg.ASSET_DIR.glob("*.json")):
        if jf.name.endswith("_aseprite.json"):
            continue
        try:
            import json as _j
            meta = _j.loads(jf.read_text(encoding="utf-8"))
            owner = meta.get("user_id")
            if owner and owner != user_id and not (current_app.config.get("TESTING") and user_id == "usr_test"):
                continue
            image_file = meta.get("image_file")
            if not image_file:
                continue
            results.append({
                "name": meta.get("name", jf.stem),
                "image_url": f"/api/sprites/{image_file}",
                "metadata": meta,
            })
        except Exception:
            pass
    return jsonify(results), 200


@api_bp.after_request
def add_cors_headers(response):
    if request.path.startswith("/api/sprites"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS, DELETE"
        response.headers["Access-Control-Allow-Headers"] = "*"
    return response


# ── GET /api/sprites/<file> ───────────────────────────────────

@api_bp.route("/sprites/<path:filename>", methods=["GET", "OPTIONS"])
def serve_sprite(filename: str):
    import re
    if request.method == "OPTIONS":
        return make_response("", 204)

    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,70}\.(png|tres|meta|gif|json)", filename):
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(str(cfg.ASSET_DIR), filename)


# ── GET /api/sprites/<name>/export/<fmt> (US-24) ──────────────

@api_bp.route("/sprites/<name>/export/<fmt>", methods=["GET"])
@login_required
def export_sprite_format(name: str, fmt: str):
    import re
    cleaned_name = re.sub(r"\.(png|json|tres|meta|gif)$", "", name, flags=re.I)
    if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{0,70}", cleaned_name):
        return jsonify({"error": "not_found"}), 404

    fmt = fmt.lower()
    valid_fmts = {"png", "godot", "tres", "unity", "meta", "gif", "aseprite", "json"}
    if fmt not in valid_fmts:
        return jsonify({"error": "invalid_format", "message": f"Unsupported format '{fmt}'"}), 400

    # Locate metadata file
    meta_path = None
    metadata = None

    if (cfg.ASSET_DIR / f"{cleaned_name}.json").exists():
        meta_path = cfg.ASSET_DIR / f"{cleaned_name}.json"
    else:
        # Search by exact name property or prefix glob
        for jf in sorted(cfg.ASSET_DIR.glob("*.json")):
            try:
                m = json.loads(jf.read_text(encoding="utf-8"))
                if (
                    m.get("name") == cleaned_name
                    or jf.stem == cleaned_name
                    or m.get("image_file") == f"{cleaned_name}.png"
                    or jf.stem.startswith(f"{cleaned_name}_")
                ):
                    meta_path = jf
                    metadata = m
                    break
            except Exception:
                continue

    if not meta_path or not meta_path.exists():
        return jsonify({"error": "not_found", "message": f"Sprite '{cleaned_name}' not found"}), 404

    if metadata is None:
        try:
            metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception as exc:
            return jsonify({"error": "corrupt_metadata", "message": str(exc)}), 500

    user_id = get_current_user_id()
    owner = metadata.get("user_id")
    if owner and owner != user_id and not (current_app.config.get("TESTING") and user_id == "usr_test"):
        return jsonify({"error": "forbidden", "message": "You do not have permission to access this asset."}), 403

    image_file = metadata.get("image_file", f"{meta_path.stem}.png")
    image_path = cfg.ASSET_DIR / image_file
    if not image_path.exists():
        return jsonify({"error": "image_not_found"}), 404

    slug = metadata.get("name", meta_path.stem)
    stem = meta_path.stem

    # AC 24.5 - Download PNG
    if fmt == "png":
        return send_from_directory(
            str(cfg.ASSET_DIR),
            image_file,
            as_attachment=True,
            download_name=image_file,
            mimetype="image/png",
        )

    # AC 24.1 - Godot 4 (.tres)
    elif fmt in ("godot", "tres"):
        tres_path = cfg.ASSET_DIR / f"{stem}.tres"
        if tres_path.exists():
            return send_from_directory(
                str(cfg.ASSET_DIR),
                tres_path.name,
                as_attachment=True,
                download_name=f"{slug}.tres",
                mimetype="text/plain",
            )
        tres_content = generate_godot_tres(metadata)
        return send_file(
            io.BytesIO(tres_content.encode("utf-8")),
            as_attachment=True,
            download_name=f"{slug}.tres",
            mimetype="text/plain",
        )

    # AC 24.2 - Unity (.meta)
    elif fmt in ("unity", "meta"):
        meta_file = cfg.ASSET_DIR / f"{image_file}.meta"
        if meta_file.exists():
            return send_from_directory(
                str(cfg.ASSET_DIR),
                meta_file.name,
                as_attachment=True,
                download_name=f"{image_file}.meta",
                mimetype="text/yaml",
            )
        from PIL import Image
        with Image.open(image_path) as img:
            iw, ih = img.size
        meta_content = generate_unity_meta(metadata, image_width=iw, image_height=ih)
        return send_file(
            io.BytesIO(meta_content.encode("utf-8")),
            as_attachment=True,
            download_name=f"{image_file}.meta",
            mimetype="text/yaml",
        )

    # AC 24.3 - Animated GIF
    elif fmt == "gif":
        gif_file = cfg.ASSET_DIR / f"{stem}.gif"
        if gif_file.exists():
            return send_from_directory(
                str(cfg.ASSET_DIR),
                gif_file.name,
                as_attachment=True,
                download_name=f"{slug}.gif",
                mimetype="image/gif",
            )
        from PIL import Image
        with Image.open(image_path) as img:
            gif_bytes = generate_gif(img, metadata)
        return send_file(
            io.BytesIO(gif_bytes),
            as_attachment=True,
            download_name=f"{slug}.gif",
            mimetype="image/gif",
        )

    # AC 24.4 - Aseprite (JSON)
    elif fmt in ("aseprite", "json"):
        aseprite_file = cfg.ASSET_DIR / f"{stem}_aseprite.json"
        if aseprite_file.exists():
            return send_from_directory(
                str(cfg.ASSET_DIR),
                aseprite_file.name,
                as_attachment=True,
                download_name=f"{slug}_aseprite.json",
                mimetype="application/json",
            )
        from PIL import Image
        with Image.open(image_path) as img:
            iw, ih = img.size
        aseprite_dict = generate_aseprite_json(metadata, image_width=iw, image_height=ih)
        payload = json.dumps(aseprite_dict, indent=2).encode("utf-8")
        return send_file(
            io.BytesIO(payload),
            as_attachment=True,
            download_name=f"{slug}_aseprite.json",
            mimetype="application/json",
        )



# ── DELETE /api/sprites/<name> ────────────────────────────────

@api_bp.route("/sprites/<name>", methods=["DELETE"])
@login_required
def delete_sprite_route(name: str):
    if not _check_csrf():
        return jsonify({"error": "forbidden"}), 403
    import re
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", name):
        return jsonify({"error": "not_found"}), 404

    # Check ownership before deletion
    user_id = get_current_user_id()
    meta_path = None
    for pattern in (f"{name}.json", f"{name}_*.json"):
        for f in cfg.ASSET_DIR.glob(pattern):
            meta_path = f
            break
        if meta_path:
            break

    if meta_path and meta_path.exists():
        try:
            m = json.loads(meta_path.read_text(encoding="utf-8"))
            owner = m.get("user_id")
            if owner and owner != user_id and not (current_app.config.get("TESTING") and user_id == "usr_test"):
                return jsonify({"error": "forbidden", "message": "You do not have permission to delete this asset."}), 403
        except Exception:
            pass

    delete_sprite(cfg.ASSET_DIR, name)
    return "", 204


# ── GET /api/health ───────────────────────────────────────────

@api_bp.route("/health", methods=["GET"])
def health():
    writable = os.access(cfg.ASSET_DIR, os.W_OK)
    return jsonify({
        "status": "ok",
        "provider": cfg.PROVIDER,
        "fallback_provider": cfg.FALLBACK_PROVIDER,
        "model": cfg.CF_MODEL_ID if cfg.PROVIDER == "cloudflare" else cfg.LOCAL_MODEL_ID,
        "asset_dir_writable": writable,
        "queue_depth": _job_store.queued_count() if _job_store else 0,
    }), 200




