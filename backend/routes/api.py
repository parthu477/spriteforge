from flask import Blueprint, jsonify, request, send_from_directory
import datetime
import logging
import os
import random

from backend.config import cfg
from backend.jobs import JobStore
from backend.validators import validate_generate, slugify, grid_to_rows_cols
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
from backend.services.processing import remove_background, normalise_grid, build_metadata
from backend.services.exporter import export_sprite, delete_sprite

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
    seed: int = data.get("seed") if data.get("seed") is not None else random.randint(0, 4_294_967_295)
    name_raw: str = data.get("name") or ""
    name = slugify(name_raw) or slugify(prompt[:48]) or "sprite"
    rows, columns = grid_to_rows_cols(grid)

    def task(job_id: str) -> None:
        short_id = job_id[:6]
        _run_job(job_id, short_id, prompt, name, style, seed, rows, columns)

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
) -> None:
    extra = {"job_id": job_id}
    try:
        # ── Step 1: Generate image ────────────────────────────
        _job_store.update_stage(job_id, "generating")
        positive, negative = build_prompt(prompt, style, rows, columns)

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
            if not cfg.FALLBACK_PROVIDER or cfg.FALLBACK_PROVIDER == cfg.PROVIDER:
                raise
            fallback = get_provider(cfg.FALLBACK_PROVIDER)
            image = fallback.generate(positive, negative,
                                      min(width, fallback.max_side),
                                      min(height, fallback.max_side), seed)
            provider_used = cfg.FALLBACK_PROVIDER
            model_used = fallback.model

        # ── Step 2: Background removal ────────────────────────
        _job_store.update_stage(job_id, "removing_background")
        try:
            image = remove_background(image, cfg.REMBG_MODEL, cfg.ALPHA_THRESHOLD)
        except ValueError as exc:
            _job_store.fail(job_id, "removing_background", "bg_removal_failed", str(exc))
            return

        # ── Step 3: Grid processing ───────────────────────────
        _job_store.update_stage(job_id, "processing")
        try:
            image, fw, fh, frame_count = normalise_grid(
                image, rows, columns,
                cell_size=cfg.CELL_SIZE,
                style=style,
                max_texture_size=cfg.MAX_TEXTURE_SIZE,
            )
        except ValueError as exc:
            _job_store.fail(job_id, "processing", "processing_failed", str(exc))
            return

        # ── Step 4: Export ────────────────────────────────────
        _job_store.update_stage(job_id, "exporting")
        image_file = f"{name}_{short_id}.png"
        generated_at = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
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
        )
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
    import re
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        return jsonify({"error": "not_found"}), 404

    job = _job_store.get(job_id)
    if not job:
        return jsonify({"error": "not_found"}), 404

    resp: dict = {
        "job_id": job.job_id,
        "status": job.status,
        "stage": job.stage,
        "created_at": datetime.datetime.utcfromtimestamp(job.created_at).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if job.status == "done":
        resp["duration_ms"] = job.duration_ms
        resp["metadata"] = job.metadata
        resp["preview_url"] = job.preview_url
    elif job.status == "failed":
        resp["error"] = job.error
    return jsonify(resp), 200


# ── GET /api/sprites ──────────────────────────────────────────

@api_bp.route("/sprites", methods=["GET"])
def list_sprites():
    results = []
    for jf in sorted(cfg.ASSET_DIR.glob("*.json")):
        try:
            import json as _j
            meta = _j.loads(jf.read_text(encoding="utf-8"))
            results.append({
                "name": meta.get("name", jf.stem),
                "image_url": f"/api/sprites/{meta.get('image_file', '')}",
                "metadata": meta,
            })
        except Exception:
            pass
    return jsonify(results), 200


# ── GET /api/sprites/<file> ───────────────────────────────────

@api_bp.route("/sprites/<path:filename>", methods=["GET"])
def serve_sprite(filename: str):
    import re
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,70}\.png", filename):
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(str(cfg.ASSET_DIR), filename)


# ── DELETE /api/sprites/<name> ────────────────────────────────

@api_bp.route("/sprites/<name>", methods=["DELETE"])
def delete_sprite_route(name: str):
    if not _check_csrf():
        return jsonify({"error": "forbidden"}), 403
    import re
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,47}", name):
        return jsonify({"error": "not_found"}), 404
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
