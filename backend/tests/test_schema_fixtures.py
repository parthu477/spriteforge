# ==============================================================
# backend/tests/test_schema_fixtures.py
# US-02: Validate shared fixtures against sprite.schema.json
# AC 2.2: Python unit tests using jsonschema
# ==============================================================
import json
from pathlib import Path

import jsonschema
import pytest

FIXTURES_DIR = Path(__file__).parent.parent.parent / "shared" / "fixtures"
SCHEMA_PATH = Path(__file__).parent.parent.parent / "shared" / "sprite.schema.json"

with open(SCHEMA_PATH) as f:
    SCHEMA = json.load(f)


def load_json(filename: str) -> dict:
    return json.loads((FIXTURES_DIR / filename).read_text(encoding="utf-8"))


# ── Fixtures that must be VALID ────────────────────────────────

@pytest.mark.parametrize("filename", [
    "valid_1x4.json",
    "valid_2x4_partial.json",
    "valid_4x4_multi_action.json",
])
def test_valid_fixture_passes_schema(filename):
    data = load_json(filename)
    jsonschema.validate(instance=data, schema=SCHEMA)  # raises if invalid


# ── Fixtures that must be INVALID ─────────────────────────────

def _is_invalid(filename: str) -> bool:
    """Return True if the file fails schema validation."""
    try:
        data = json.loads((FIXTURES_DIR / filename).read_bytes())
    except json.JSONDecodeError:
        return True  # malformed JSON is definitely invalid
    try:
        jsonschema.validate(instance=data, schema=SCHEMA)
        # Additional cross-field checks not in JSON Schema:
        # image_file pattern
        import re
        if not re.fullmatch(r"^[a-z0-9][a-z0-9_-]{0,63}\.png$", data.get("image_file", "")):
            return True
        # frame_count <= rows * columns
        if data.get("frame_count", 0) > data.get("rows", 0) * data.get("columns", 0):
            return True
        return False
    except jsonschema.ValidationError:
        return True


@pytest.mark.parametrize("filename", [
    "invalid_missing_key.json",
    "invalid_traversal.json",
    "invalid_absolute.json",
    "invalid_frame_count.json",
    "invalid_types.json",
    "malformed.json",
])
def test_invalid_fixture_fails_schema(filename):
    assert _is_invalid(filename), f"{filename} should fail validation but it passed."


def test_huge_fixture_exceeds_64kb():
    size = (FIXTURES_DIR / "huge.json").stat().st_size
    assert size > 64 * 1024, f"huge.json must be > 64 KB, got {size} bytes"
