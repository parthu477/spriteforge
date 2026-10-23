# ==============================================================
# SpriteForge Backend — logging_setup.py
# US-17: Structured logging with token redaction
# ==============================================================
"""Configure root logger with:
- Console handler (structured format)
- Rotating file handler (5 MB, 3 backups)
- Token-redaction filter (Bearer + HF tokens)
"""
from __future__ import annotations

import logging
import logging.handlers
import re
from pathlib import Path

# Patterns that must never appear in logs
_REDACT_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"hf_[A-Za-z0-9]{34,}"),
    re.compile(r"(?:CF_API_TOKEN|HF_TOKEN|GEMINI_API_KEY)\s*=\s*\S+", re.IGNORECASE),
    re.compile(r"key=(?:AQ\.[A-Za-z0-9\-._~+/]+|AIza[A-Za-z0-9\-_]{35})", re.IGNORECASE),
]

LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [job=%(job_id)s] %(message)s"
DATE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class _RedactionFilter(logging.Filter):
    """Replace sensitive tokens in log records."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for pat in _REDACT_PATTERNS:
            msg = pat.sub("[REDACTED]", msg)
        record.msg = msg
        record.args = ()
        return True


class _JobIdFilter(logging.Filter):
    """Inject job_id into every record (default '-')."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "job_id"):
            record.job_id = "-"  # type: ignore[attr-defined]
        return True


def setup_logging(level: str = "INFO", log_dir: Path | None = None) -> None:
    """Call once at application startup."""
    numeric_level = getattr(logging, level.upper(), logging.INFO)

    root = logging.getLogger()
    root.setLevel(numeric_level)

    # Shared formatter + filters
    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)
    redact = _RedactionFilter()
    job_id_filter = _JobIdFilter()

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(numeric_level)
    ch.setFormatter(formatter)
    ch.addFilter(redact)
    ch.addFilter(job_id_filter)
    root.addHandler(ch)

    # Rotating file handler
    if log_dir is None:
        log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "spriteforge.log"

    fh = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    fh.setLevel(numeric_level)
    fh.setFormatter(formatter)
    fh.addFilter(redact)
    fh.addFilter(job_id_filter)
    root.addHandler(fh)

    logging.getLogger("werkzeug").setLevel(logging.WARNING)
