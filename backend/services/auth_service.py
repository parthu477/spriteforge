# ==============================================================
# SpriteForge Backend — auth_service.py
# Issue #46: SQLite-backed user authentication service
# ==============================================================
from __future__ import annotations

import logging
import os
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Dict, Optional
from werkzeug.security import generate_password_hash, check_password_hash

log = logging.getLogger(__name__)

# Default SQLite database path in backend/data/users.db
_DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "users.db"


class AuthService:
    """Lightweight, secure user authentication service backed by SQLite."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or _DEFAULT_DB_PATH
        self._ensure_db()

    def _get_connection(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_db(self) -> None:
        """Initialise SQLite schema if not present."""
        with self._get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            conn.commit()

    def validate_username(self, username: str) -> Optional[str]:
        """Validate username format. Returns error string if invalid, None if OK."""
        if not username or len(username) < 3 or len(username) > 32:
            return "Username must be between 3 and 32 characters."
        if not re.match(r"^[a-zA-Z0-9_-]+$", username):
            return "Username can only contain letters, numbers, underscores, and hyphens."
        return None

    def validate_password(self, password: str) -> Optional[str]:
        """Validate password strength. Returns error string if invalid, None if OK."""
        if not password or len(password) < 8:
            return "Password must be at least 8 characters."
        return None

    def register(
        self, username: str, password: str, display_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Register a new user with hashed password."""
        username_clean = (username or "").strip()
        u_err = self.validate_username(username_clean)
        if u_err:
            raise ValueError(u_err)

        p_err = self.validate_password(password)
        if p_err:
            raise ValueError(p_err)

        user_id = f"usr_{uuid.uuid4().hex[:12]}"
        password_hash = generate_password_hash(password, method="pbkdf2:sha256")
        display = (display_name or "").strip() or username_clean

        try:
            with self._get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO users (id, username, password_hash, display_name)
                    VALUES (?, ?, ?, ?);
                    """,
                    (user_id, username_clean, password_hash, display),
                )
                conn.commit()
        except sqlite3.IntegrityError:
            raise ValueError(f"Username '{username_clean}' is already registered.")

        return {
            "id": user_id,
            "username": username_clean,
            "display_name": display,
        }

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate user credentials. Returns user dict on success, None on failure."""
        username_clean = (username or "").strip()
        if not username_clean or not password:
            return None

        with self._get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM users WHERE LOWER(username) = LOWER(?);",
                (username_clean,),
            )
            row = cursor.fetchone()

        if not row:
            return None

        if not check_password_hash(row["password_hash"], password):
            return None

        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"] or row["username"],
            "created_at": row["created_at"],
        }

    def get_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch user by ID."""
        if not user_id:
            return None
        with self._get_connection() as conn:
            cursor = conn.execute("SELECT * FROM users WHERE id = ?;", (user_id,))
            row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"] or row["username"],
            "created_at": row["created_at"],
        }


# Singleton service instance
auth_service = AuthService()
