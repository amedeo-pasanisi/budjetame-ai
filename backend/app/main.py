from fastapi import FastAPI

from app.config import settings
from app.db import check_connection, create_db_engine


def create_app(database_url: str | None = None) -> FastAPI:
    """Build the application. `database_url` overrides settings for tests."""
    app = FastAPI(title="Budjetame API", version="0.1.0")
    engine = create_db_engine(database_url or settings.database_url)

    @app.get("/health")
    def health() -> dict[str, str]:
        check_connection(engine)
        return {"status": "ok"}

    return app


app = create_app()
