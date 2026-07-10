import hashlib
import secrets
from datetime import UTC, datetime

from argon2 import PasswordHasher

_password_hasher = PasswordHasher()


def utc_now() -> datetime:
    return datetime.now(UTC)


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except Exception:
        return False


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def dashboard_cookie_settings(token: str, max_age: int) -> dict[str, object]:
    return {
        "key": "dashboard_session",
        "value": token,
        "max_age": max_age,
        "httponly": True,
        "secure": True,
        "samesite": "lax",
    }
