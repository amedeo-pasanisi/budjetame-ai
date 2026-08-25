from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app.auth import router as auth_router
from app.categories import router as categories_router
from app.config import settings
from app.dashboard import router as dashboard_router
from app.db import check_connection, create_db_engine
from app.google_auth import GoogleIdTokenVerifier, GoogleVerifier
from app.imports import router as imports_router
from app.recurring_costs import router as recurring_costs_router
from app.recurring_incomes import router as recurring_incomes_router
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
) -> FastAPI:
    """Build the application. `database_url` and the seed credentials override
    settings for tests; `google_client_id` and `google_verifier` do the same
    for the Google sign-in seam (issue #81)."""
    app = FastAPI(title="Budjetame API", version="0.1.0")
    engine = create_db_engine(database_url or settings.database_url)
    app.state.sessionmaker = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.engine = engine  # tests dispose it at teardown to release the pool
    app.state.google_client_id = (
        google_client_id if google_client_id is not None else settings.google_oauth_client_id
    )
    app.state.google_verifier = google_verifier or GoogleIdTokenVerifier(app.state.google_client_id)

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

    @app.get("/health")
    def health() -> dict[str, str]:
        check_connection(engine)
        return {"status": "ok"}

    return app


# No module-level `app = create_app()`: creating the app seeds the Account,
# which requires a database connection. Uvicorn runs the factory directly:
# `uvicorn app.main:create_app --factory`.
