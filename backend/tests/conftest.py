import os
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from testcontainers.community.postgres import PostgresContainer

from app.main import create_app


def run_migrations(database_url: str) -> None:
    """Apply Alembic migrations to the given database."""
    cfg = Config("alembic.ini")
    cfg.set_main_option("script_location", "alembic")
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A real Postgres instance (Docker) with migrations applied."""
    with PostgresContainer("postgres:16-alpine") as postgres:
        url = postgres.get_connection_url(driver="psycopg")
        run_migrations(url)
        yield url


@pytest.fixture
async def client(database_url: str) -> Iterator[AsyncClient]:
    """The app driven through its HTTP seam against the real database."""
    app = create_app(database_url)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
