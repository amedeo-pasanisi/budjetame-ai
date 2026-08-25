from collections.abc import Iterator

from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.google_auth import GoogleVerifier
from app.mailer import Mailer

bearer_scheme = HTTPBearer(auto_error=False)


def get_session(request: Request) -> Iterator[Session]:
    """One DB session per request, scoped to the app's sessionmaker."""
    session: Session = request.app.state.sessionmaker()
    try:
        yield session
    finally:
        session.close()


def get_google_verifier(request: Request) -> GoogleVerifier:
    """The app's Google ID-token verifier (issue #81): the real one in
    production, whatever tests injected via create_app."""
    return request.app.state.google_verifier


def get_mailer(request: Request) -> Mailer:
    """The app's mailer (issue #83): SmtpMailer when configured, LoggingMailer
    in dev, whatever tests injected via create_app."""
    return request.app.state.mailer
