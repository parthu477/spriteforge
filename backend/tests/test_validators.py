# ==============================================================
# backend/tests/test_validators.py
# Tests for validators.py (US-02 data contracts, input validation)
# ==============================================================
import pytest
from backend.validators import validate_generate, slugify, grid_to_rows_cols


class TestValidateGenerate:
    def _valid(self):
        return {"prompt": "a knight walking", "grid": "1x4", "style": "pixel_art"}

    def test_valid_minimal(self):
        assert validate_generate(self._valid()) == {}

    def test_valid_with_all_fields(self):
        data = {**self._valid(), "name": "knight_walk", "seed": 42}
        assert validate_generate(data) == {}

    def test_prompt_too_short(self):
        errors = validate_generate({**self._valid(), "prompt": "hi"})
        assert "prompt" in errors

    def test_prompt_too_long(self):
        errors = validate_generate({**self._valid(), "prompt": "x" * 301})
        assert "prompt" in errors

    def test_prompt_control_chars(self):
        errors = validate_generate({**self._valid(), "prompt": "hello\x00world"})
        assert "prompt" in errors

    def test_invalid_grid(self):
        errors = validate_generate({**self._valid(), "grid": "3x3"})
        assert "grid" in errors

    def test_valid_grids(self):
        for g in ("1x4", "1x6", "1x8", "2x4", "4x4"):
            assert "grid" not in validate_generate({**self._valid(), "grid": g})

    def test_invalid_style(self):
        errors = validate_generate({**self._valid(), "style": "watercolor"})
        assert "style" in errors

    def test_seed_negative(self):
        errors = validate_generate({**self._valid(), "seed": -1})
        assert "seed" in errors

    def test_seed_too_large(self):
        errors = validate_generate({**self._valid(), "seed": 5_000_000_000})
        assert "seed" in errors

    def test_seed_zero_valid(self):
        assert "seed" not in validate_generate({**self._valid(), "seed": 0})

    def test_seed_max_valid(self):
        assert "seed" not in validate_generate({**self._valid(), "seed": 4_294_967_295})

    def test_seed_bool_rejected(self):
        errors = validate_generate({**self._valid(), "seed": True})
        assert "seed" in errors

    def test_name_invalid_after_slug(self):
        # A name that slugifies to empty
        errors = validate_generate({**self._valid(), "name": "!!!###"})
        assert "name" in errors

    def test_unknown_fields_ignored(self):
        errors = validate_generate({**self._valid(), "unknown_key": "ignored"})
        assert errors == {}

    def test_multi_action_valid_4x4(self):
        data = {**self._valid(), "grid": "4x4", "multi_action": True}
        assert validate_generate(data) == {}

    def test_multi_action_non_boolean_rejected(self):
        data = {**self._valid(), "grid": "4x4", "multi_action": "yes"}
        errors = validate_generate(data)
        assert "multi_action" in errors

    def test_multi_action_non_4x4_rejected(self):
        data = {**self._valid(), "grid": "1x4", "multi_action": True}
        errors = validate_generate(data)
        assert "grid" in errors


class TestSlugify:
    def test_simple(self):
        assert slugify("Hello World") == "hello_world"

    def test_special_chars(self):
        s = slugify("knight@walk#2!")
        assert s == "knight_walk_2"

    def test_max_length(self):
        assert len(slugify("a" * 100)) <= 48

    def test_starts_with_letter(self):
        s = slugify("_test")
        assert s[0].isalnum()

    def test_empty_returns_empty(self):
        assert slugify("!!!") == ""


class TestGridToRowsCols:
    def test_1x4(self):
        assert grid_to_rows_cols("1x4") == (1, 4)

    def test_2x4(self):
        assert grid_to_rows_cols("2x4") == (2, 4)

    def test_invalid_raises(self):
        with pytest.raises(ValueError):
            grid_to_rows_cols("bad")
