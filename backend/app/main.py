from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app.auth import router as auth_router
from app.categories import router as categories_router
from app.config import settings
from app.dashboard import router as dashboard_router
from app.db import check_connection, create_db_engine
from app.imports import router as imports_router
from app.recurring_costs import router as recurring_costs_router
from app.seed import seed_account
from app.transactions import router as transactions_router
from app.wallets import router as wallets_router


def create_app(
    database_url: str | None = None,
    *,
    seed_email: str | None = None,
    seed_password: str | None = None,
) -> FastAPI:
    """Build the application. `database_url` and seed credentials override settings for tests."""
    app = FastAPI(title="Budjetame API", version="0.1.0")
    engine = create_db_engine(database_url or settings.database_url)
    app.state.sessionmaker = sessionmaker(bind=engine, expire_on_commit=False)
    app.state.engine = engine  # tests dispose it at teardown to release the pool

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

    @app.get("/health")
    def health() -> dict[str, str]:
        check_connection(engine)
        return {"status": "ok"}

    return app


# No module-level `app = create_app()`: creating the app seeds the Account,
# which requires a database connection. Uvicorn runs the factory directly:
# `uvicorn app.main:create_app --factory`.
