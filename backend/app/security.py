from datetime import datetime, timedelta, timezone
import hashlib
import secrets

import bcrypt
import jwt

from app.config import settings


def hash_password(password: str) -> str:
    """Hash a plaintext password for storage (bcrypt)."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """Return True when `password` matches the stored bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(account_id: int) -> str:
    """Issue a signed JWT carrying the account id as `sub`."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(account_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int | None:
    """Return the account id encoded in `token`, or None when invalid or expired."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.isdigit():
        return None
    return int(sub)


def new_reset_token() -> str:
    """A fresh password-reset token for an email link (issue #83)."""
    return secrets.token_urlsafe(32)


def hash_reset_token(token: str) -> str:
    """The stored form of a reset token: only the sha256 is persisted, so a
    database leak cannot be replayed."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
