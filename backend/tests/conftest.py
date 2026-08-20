import os
from collections.abc import AsyncIterator, Iterator
from urllib.parse import urlparse

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from testcontainers.community.postgres import PostgresContainer

from app.db import create_db_engine
from app.main import create_app
from app.models import Account
from app.security import hash_password

# Credentials the app seeds into the (empty) database for tests.
SEED_EMAIL = "admin@budjetame.dev"
SEED_PASSWORD = "correct-horse-battery-staple"


def run_migrations(database_url: str) -> None:
    """Apply Alembic migrations to the given database."""
    cfg = Config("alembic.ini")
    cfg.set_main_option("script_location", "alembic")
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


def _database_name(database_url: str) -> str:
    """The database name in a SQLAlchemy URL — its last path segment."""
    return urlparse(database_url).path.rstrip("/").rsplit("/", 1)[-1]


def reset_database(database_url: str) -> None:
    """Drop and recreate the schema, so a reused test database starts each
    session from a fresh seed (the tests assume a fresh seed and never
    clean up after themselves).

    Only a database whose name contains "test" is reset: the reset wipes
    all data in the database, so it must never point at a development or
    production database."""
    name = _database_name(database_url)
    if "test" not in name.lower():
        raise RuntimeError(
            f"refusing to reset {name!r}: TEST_DATABASE_URL must name a test "
            "database (the name must contain 'test')"
        )
    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A real Postgres instance with migrations applied. By default a
    testcontainers Postgres in Docker; TEST_DATABASE_URL overrides it with an
    existing server (e.g. on machines without Docker), reset and migrated
    fresh here. Either way the database is disposable: tests assume a fresh
    seed."""
    if os.environ.get("TEST_DATABASE_URL"):
        url = os.environ["TEST_DATABASE_URL"]
        reset_database(url)
        run_migrations(url)
        yield url
        return
    with PostgresContainer("postgres:16-alpine") as postgres:
        url = postgres.get_connection_url(driver="psycopg")
        run_migrations(url)
        yield url


@pytest.fixture
async def client(database_url: str) -> AsyncIterator[AsyncClient]:
    """The app driven through its HTTP seam against the real database."""
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    # Close this test's engine pool at teardown: the container allows 100
    # connections, and un-disposed pools across 100+ tests would exhaust it.
    app.state.engine.dispose()


def insert_foreign_account(database_url: str, email: str) -> int:
    """Fixture helper: a second Account, for ADR-0003 scoping tests."""
    engine = create_db_engine(database_url)
    try:
        with Session(engine) as session:
            account = Account(email=email, password_hash=hash_password("whatever"))
            session.add(account)
            session.commit()
            return account.id
    finally:
        engine.dispose()


def delete_account(database_url: str, account_id: int) -> None:
    """Tear down a fixture Account; its owned rows cascade (ondelete=CASCADE)."""
    engine = create_db_engine(database_url)
    try:
        with Session(engine) as session:
            session.delete(session.get(Account, account_id))
            session.commit()
    finally:
        engine.dispose()
