from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app.assistant_catalogue import CatalogueFetcher, HttpCatalogueFetcher
from app.assistant_models import router as assistant_models_router
from app.assistant import router as assistant_router
from app.assistant_bounds import AssistantBounds, AssistantRuntime
from app.assistant_seam import AssistantModelFactory, Clock, SystemClock, assistant_model_for

# The provider adapters register themselves in `ADAPTERS` on import (ADR-0035):
# the Anthropic native one (issue #130) and the OpenAI-compatible one for
# OpenRouter and Gemini (issue #131).
import app.assistant_anthropic
import app.assistant_openai_compatible
from app.assistant_settings import router as assistant_settings_router
from app.auth import router as auth_router
from app.categories import router as categories_router
from app.config import settings
from app.dashboard import router as dashboard_router
from app.draft_transactions import router as draft_transactions_router
from app.db import check_connection, create_db_engine
from app.google_auth import GoogleIdTokenVerifier, GoogleVerifier
from app.backup import router as backup_router
from app.imports import router as imports_router
from app.mailer import LoggingMailer, Mailer, SmtpMailer
from app.recurring import costs_router as recurring_costs_router
from app.recurring import incomes_router as recurring_incomes_router
from app.seed import seed_account
from app.transactions import router as transactions_router
from app.wallets import router as wallets_router


def create_app(
    database_url: str | None = None,
    *,
    seed_email: str | None = None,
    seed_password: str | None = None,
    google_client_id: str | None = None,
    google_verifier: GoogleVerifier | None = None,
    mailer: Mailer | None = None,
    password_reset_expire_minutes: int | None = None,
    public_base_url: str | None = None,
    assistant_key_secret: str | None = None,
    catalogue_fetcher: CatalogueFetcher | None = None,
    assistant_model_factory: AssistantModelFactory | None = None,
    assistant_bounds: AssistantBounds | None = None,
    assistant_clock: Clock | None = None,
) -> FastAPI:
    """Build the application. `database_url` and the seed credentials override
    settings for tests; `google_client_id`/`google_verifier` override the
    Google sign-in seam (issue #81), `mailer`/`password_reset_expire_minutes`
    the password-reset seam (issue #83) and `assistant_key_secret` the secret
    the Assistant Key is encrypted under (ADR-0035, issue #126),
    `catalogue_fetcher` the provider model-listing seam (issue #127),
    `assistant_model_factory` the provider seam of the Assistant (issue
    #128: a scripted fake in tests, the per-provider adapter lookup
    otherwise), and `assistant_bounds`/`assistant_clock` the Assistant's
    per-Account bounds and the clock its turn budget is measured on (issue
    #129: the settings and the system clock otherwise)."""
    app = FastAPI(title="Budjetame API", version="0.1.0")
    engine = create_db_engine(database_url or settings.database_url)
    app.state.sessionmaker = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.engine = engine  # tests dispose it at teardown to release the pool
    app.state.google_client_id = (
        google_client_id if google_client_id is not None else settings.google_oauth_client_id
    )
    app.state.google_verifier = google_verifier or GoogleIdTokenVerifier(app.state.google_client_id)
    app.state.mailer = mailer or (
        SmtpMailer(
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_password,
            sender=settings.smtp_from,
            tls=settings.smtp_tls,
        )
        if settings.smtp_host
        else LoggingMailer()
    )
    app.state.password_reset_expire_minutes = (
        password_reset_expire_minutes
        if password_reset_expire_minutes is not None
        else settings.password_reset_expire_minutes
    )
    app.state.public_base_url = public_base_url or settings.public_base_url
    app.state.assistant_key_secret = assistant_key_secret or settings.assistant_key_secret
    app.state.catalogue_fetcher = catalogue_fetcher or HttpCatalogueFetcher()
    app.state.assistant_model_factory = assistant_model_factory or assistant_model_for
    app.state.assistant_runtime = AssistantRuntime(
        bounds=assistant_bounds or AssistantBounds.from_settings(),
        clock=assistant_clock or SystemClock(),
    )

    seed_account(
        app.state.sessionmaker,
        seed_email or settings.seed_account_email,
        seed_password or settings.seed_account_password,
    )

    app.include_router(auth_router)
    app.include_router(wallets_router)
    app.include_router(categories_router)
    app.include_router(transactions_router)
    app.include_router(dashboard_router)
    app.include_router(imports_router)
    app.include_router(recurring_costs_router)
    app.include_router(recurring_incomes_router)
    app.include_router(backup_router)
    app.include_router(assistant_settings_router)
    app.include_router(draft_transactions_router)
    app.include_router(assistant_models_router)
    app.include_router(assistant_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        check_connection(engine)
        return {"status": "ok"}

    return app


# No module-level `app = create_app()`: creating the app seeds the Account,
# which requires a database connection. Uvicorn runs the factory directly:
# `uvicorn app.main:create_app --factory`.
