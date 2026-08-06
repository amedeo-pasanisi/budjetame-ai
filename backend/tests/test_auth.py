import bcrypt
from httpx import AsyncClient
from sqlalchemy import func, select

from app.db import create_db_engine
from app.models import Account

from conftest import SEED_EMAIL, SEED_PASSWORD


async def test_login_issues_a_bearer_token_for_seeded_credentials(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str) and body["access_token"] != ""


async def test_login_rejects_an_unknown_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login", json={"email": "stranger@budjetame.dev", "password": "whatever"}
    )

    assert response.status_code == 401


async def test_login_rejects_a_wrong_password(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": "not-the-password"}
    )

    assert response.status_code == 401


async def test_login_rejects_a_malformed_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login", json={"email": "not-an-email", "password": "whatever"}
    )

    assert response.status_code == 422


async def test_seeded_account_exists_exactly_once_with_a_hashed_password(
    client: AsyncClient, database_url: str
) -> None:
    engine = create_db_engine(database_url)
    with engine.connect() as conn:
        count = conn.execute(select(func.count()).select_from(Account)).scalar_one()
        stored = conn.execute(
            select(Account.password_hash).where(Account.email == SEED_EMAIL)
        ).scalar_one()

    assert count == 1
    assert stored != SEED_PASSWORD
    assert bcrypt.checkpw(SEED_PASSWORD.encode(), stored.encode())


async def test_me_requires_authentication(client: AsyncClient) -> None:
    response = await client.get("/auth/me")

    assert response.status_code == 401


async def test_me_rejects_an_invalid_token(client: AsyncClient) -> None:
    response = await client.get("/auth/me", headers={"Authorization": "Bearer not-a-token"})

    assert response.status_code == 401


async def test_me_returns_the_authenticated_account(client: AsyncClient) -> None:
    login = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    token = login.json()["access_token"]

    response = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == SEED_EMAIL
    assert isinstance(body["id"], int)
