from collections.abc import Iterator

from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.assistant_catalogue import CatalogueFetcher
from app.assistant_bounds import AssistantRuntime
from app.assistant_seam import AssistantModelFactory
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


def get_assistant_key_secret(request: Request) -> str:
    """The server secret the Assistant Key is encrypted under (ADR-0035,
    issue #126): settings in production, whatever tests injected via
    create_app."""
    secret: str = request.app.state.assistant_key_secret
    return secret


def get_catalogue_fetcher(request: Request) -> CatalogueFetcher:
    """The Assistant's catalogue fetcher (ADR-0035, issue #127): the httpx
    one in production, whatever tests injected via create_app."""
    fetcher: CatalogueFetcher = request.app.state.catalogue_fetcher
    return fetcher
def get_assistant_model_factory(request: Request) -> AssistantModelFactory:
    """The provider seam of the Assistant (ADR-0035, issue #128): the
    per-provider adapter lookup in production, whatever tests injected via
    create_app (a scripted fake)."""
    factory: AssistantModelFactory = request.app.state.assistant_model_factory
    return factory


def get_assistant_runtime(request: Request) -> AssistantRuntime:
    """The Assistant's bounds, clock and turns-per-hour window (ADR-0035,
    issue #129): settings and the system clock in production, whatever
    tests injected via create_app."""
    runtime: AssistantRuntime = request.app.state.assistant_runtime
    return runtime
