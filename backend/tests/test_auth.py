"""Auth (US4). Everything here asserts through the HTTP seam except
`test_seeded_account_exists_exactly_once_with_a_hashed_password` — the suite's
single deliberate exception to the "assert only on API responses and observable
state" rule, documented in that test (issue #19).
"""

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
    """US4: the seeded Account exists exactly once and its password is stored
    only as a bcrypt hash, never as the plaintext.

    This is the suite's single deliberate exception to the "assert only on API
    responses and observable state" rule (issue #19): no API path exposes the
    stored hash, so the HTTP seam cannot distinguish hashed storage from
    plaintext storage — and US4 must be locked. That the hash *verifies* (the
    seed password logs in) is already locked through the seam by
    `test_login_issues_a_bearer_token_for_seeded_credentials`; only the
    not-plaintext property needs this database read.
    """
    engine = create_db_engine(database_url)
    with engine.connect() as conn:
        count = conn.execute(select(func.count()).select_from(Account)).scalar_one()
        stored = conn.execute(
            select(Account.password_hash).where(Account.email == SEED_EMAIL)
        ).scalar_one()

    engine.dispose()
    assert count == 1
    assert stored != SEED_PASSWORD
    assert bcrypt.checkpw(SEED_PASSWORD.encode(), stored.encode())


async def test_register_creates_account_and_auto_logs_in(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register", json={"email": "New.User@Example.com", "password": "hunter2-hunter2"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert isinstance(body["access_token"], str) and body["access_token"] != ""

    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "new.user@example.com"  # stored lowercased


async def test_register_rejects_a_duplicate_email_case_insensitively(client: AsyncClient) -> None:
    first = await client.post(
        "/auth/register", json={"email": "Dup@Example.com", "password": "hunter2-hunter2"}
    )
    assert first.status_code == 200

    second = await client.post(
        "/auth/register", json={"email": "dup@example.com", "password": "hunter2-hunter2"}
    )
    assert second.status_code == 409


async def test_register_rejects_a_short_password(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register", json={"email": "shorty@example.com", "password": "short"}
    )
    assert response.status_code == 422


async def test_register_rejects_a_malformed_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register", json={"email": "not-an-email", "password": "hunter2-hunter2"}
    )
    assert response.status_code == 422


async def test_fresh_account_starts_empty(client: AsyncClient) -> None:
    register = await client.post(
        "/auth/register", json={"email": "fresh@example.com", "password": "hunter2-hunter2"}
    )
    token = register.json()["access_token"]

    wallets = await client.get("/wallets", headers={"Authorization": f"Bearer {token}"})
    assert wallets.status_code == 200
    assert wallets.json() == []


async def test_registered_account_cannot_see_another_accounts_data(client: AsyncClient) -> None:
    """ADR-0020: a registered Account is an ordinary tenant — foreign data stays a 403."""
    seed_login = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    seed_token = seed_login.json()["access_token"]
    wallet = await client.post(
        "/wallets",
        headers={"Authorization": f"Bearer {seed_token}"},
        json={"name": "Seed wallet", "type": "checking"},
    )
    wallet_id = wallet.json()["id"]

    register = await client.post(
        "/auth/register", json={"email": "rival@example.com", "password": "hunter2-hunter2"}
    )
    rival_token = register.json()["access_token"]

    rival_list = await client.get("/wallets", headers={"Authorization": f"Bearer {rival_token}"})
    assert rival_list.status_code == 200
    assert rival_list.json() == []

    rival_fetch = await client.patch(
        f"/wallets/{wallet_id}",
        headers={"Authorization": f"Bearer {rival_token}"},
        json={"name": "Hijack"},
    )
    assert rival_fetch.status_code == 403


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
