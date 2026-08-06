from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import Account
from app.security import hash_password


def seed_account(session_factory: sessionmaker, email: str, password: str) -> None:
    """Create the single Account when the database has none. Idempotent."""
    session: Session = session_factory()
    try:
        count = session.scalar(select(func.count()).select_from(Account))
        if count == 0:
            session.add(Account(email=email.lower(), password_hash=hash_password(password)))
            session.commit()
    finally:
        session.close()
