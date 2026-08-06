import os
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
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
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client


def insert_foreign_account(database_url: str, email: str) -> int:
    """Fixture helper: a second Account, for ADR-0003 scoping tests."""
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        account = Account(email=email, password_hash=hash_password("whatever"))
        session.add(account)
        session.commit()
        return account.id


def delete_account(database_url: str, account_id: int) -> None:
    """Tear down a fixture Account; its owned rows cascade (ondelete=CASCADE)."""
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        session.delete(session.get(Account, account_id))
        session.commit()
