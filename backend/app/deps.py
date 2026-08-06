from collections.abc import Iterator

from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

bearer_scheme = HTTPBearer(auto_error=False)


def get_session(request: Request) -> Iterator[Session]:
    """One DB session per request, scoped to the app's sessionmaker."""
    session: Session = request.app.state.sessionmaker()
    try:
        yield session
    finally:
        session.close()
