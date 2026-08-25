"""Auth (US4). Everything here asserts through the HTTP seam except
`test_seeded_account_exists_exactly_once_with_a_hashed_password` — the suite's
single deliberate exception to the "assert only on API responses and observable
state" rule, documented in that test (issue #19).
"""

import bcrypt
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import create_db_engine
from app.google_auth import GoogleIdentity
from app.main import create_app
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


async def test_seeded_account_exists_with_a_hashed_password(
    client: AsyncClient, database_url: str
) -> None:
    """US4: the seeded Account exists and its password is stored only as a
    bcrypt hash, never as the plaintext. (With multi-user, ADR-0020, other
    Accounts may exist — the seed's own properties are what this locks, not
    a global count.)

    This is the suite's single deliberate exception to the "assert only on
    API responses and observable state" rule (issue #19): no API path
    exposes the stored hash, so the HTTP seam cannot distinguish hashed
    storage from plaintext storage — and US4 must be locked. That the hash
    *verifies* (the seed password logs in) is already locked through the
    seam by `test_login_issues_a_bearer_token_for_seeded_credentials`; only
    the not-plaintext property needs this database read.
    """
    engine = create_db_engine(database_url)
    with engine.connect() as conn:
        stored = conn.execute(
            select(Account.password_hash).where(Account.email == SEED_EMAIL)
        ).scalar_one()

    engine.dispose()
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


class FakeGoogleVerifier:
    """The verifier seam's fake: the test sets `identity` to decide what a
    sign-in resolves to (or None for an invalid token)."""

    def __init__(self) -> None:
        self.identity: GoogleIdentity | None = None

    def verify(self, id_token: str) -> GoogleIdentity | None:
        return self.identity


@pytest.fixture
async def google_client(database_url: str) -> AsyncIterator[tuple[AsyncClient, FakeGoogleVerifier]]:
    """The app with a fake Google verifier and a known client id, so Google
    sign-in tests never touch Google (issue #81)."""
    verifier = FakeGoogleVerifier()
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        google_verifier=verifier,
        google_client_id="test-client-id.apps.googleusercontent.com",
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client, verifier
    app.state.engine.dispose()


async def test_google_sign_in_auto_provisions_a_new_account(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    """ADR-0020: a first Google sign-in creates the Account on the spot — no
    registration form, no password (the nullable password_hash, issue #81)."""
    client, verifier = google_client
    verifier.identity = GoogleIdentity(email="gmail.user@gmail.com", email_verified=True)

    response = await client.post("/auth/google", json={"id_token": "a-google-token"})

    assert response.status_code == 200
    token = response.json()["access_token"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "gmail.user@gmail.com"


async def test_google_sign_in_links_to_an_existing_account(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    """ADR-0021: the verified email is the identity key — Google sign-in with
    an email that already has a password Account enters that Account; both
    doors keep working."""
    client, verifier = google_client
    registered = await client.post(
        "/auth/register", json={"email": "same@example.com", "password": "hunter2-hunter2"}
    )
    registered_id = (
        await client.get(
            "/auth/me", headers={"Authorization": f"Bearer {registered.json()['access_token']}"}
        )
    ).json()["id"]

    verifier.identity = GoogleIdentity(email="same@example.com", email_verified=True)
    google = await client.post("/auth/google", json={"id_token": "a-google-token"})

    assert google.status_code == 200
    linked_id = (
        await client.get(
            "/auth/me", headers={"Authorization": f"Bearer {google.json()['access_token']}"}
        )
    ).json()["id"]
    assert linked_id == registered_id

    password_login = await client.post(
        "/auth/login", json={"email": "same@example.com", "password": "hunter2-hunter2"}
    )
    assert password_login.status_code == 200


async def test_google_sign_in_rejects_an_unverified_email(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    """A token whose email Google has not verified is rejected: the email is
    the identity key (ADR-0021), so it must be proven."""
    client, verifier = google_client
    verifier.identity = GoogleIdentity(email="unverified@gmail.com", email_verified=False)

    response = await client.post("/auth/google", json={"id_token": "a-google-token"})

    assert response.status_code == 401


async def test_google_sign_in_rejects_an_invalid_token(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    client, verifier = google_client
    verifier.identity = None

    response = await client.post("/auth/google", json={"id_token": "forged-token"})

    assert response.status_code == 401


async def test_google_only_account_cannot_sign_in_with_a_password(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    """A Google-provisioned Account has no password: any password fails (the
    nullable hash signs in through Google only, issue #81)."""
    client, verifier = google_client
    verifier.identity = GoogleIdentity(email="passless@gmail.com", email_verified=True)
    assert (await client.post("/auth/google", json={"id_token": "t"})).status_code == 200

    response = await client.post(
        "/auth/login", json={"email": "passless@gmail.com", "password": "anything"}
    )
    assert response.status_code == 401


async def test_auth_config_exposes_the_google_client_id(
    google_client: tuple[AsyncClient, FakeGoogleVerifier],
) -> None:
    """The public sign-in options: the client id is public (it ships to the
    browser anyway) and empty means no Google button (issue #81)."""
    client, _ = google_client

    response = await client.get("/auth/config")

    assert response.status_code == 200
    assert response.json() == {"google_client_id": "test-client-id.apps.googleusercontent.com"}
