"""Password reset (issue #83): everything asserted through the HTTP seam with
a fake mailer — no SMTP in tests. The suite locks: unknown emails are
indistinguishable from known ones (200 either way, nothing sent), tokens are
single-use, expiry is enforced, and only the new password signs in."""

import re
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.mailer import EmailMessage

from conftest import SEED_EMAIL, SEED_PASSWORD

TOKEN_IN_BODY = re.compile(r"token=([A-Za-z0-9_-]+)")


class FakeMailer:
    """The mailer seam's fake: captures outgoing messages for assertions."""

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.sent.append(message)


@pytest.fixture
async def reset_client(database_url: str) -> AsyncIterator[tuple[AsyncClient, FakeMailer]]:
    mailer = FakeMailer()
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        mailer=mailer,
        password_reset_expire_minutes=30,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client, mailer
    app.state.engine.dispose()


async def _register_and_request(
    client: AsyncClient, mailer: FakeMailer, email: str, password: str = "hunter2-hunter2"
) -> str:
    """Register an Account, request a reset, and return the raw token from
    the captured email."""
    await client.post("/auth/register", json={"email": email, "password": password})
    response = await client.post("/auth/forgot-password", json={"email": email})
    assert response.status_code == 204
    match = TOKEN_IN_BODY.search(mailer.sent[-1].body)
    assert match is not None
    return match.group(1)


async def test_forgot_password_sends_a_reset_link_with_a_token(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    client, mailer = reset_client
    await _register_and_request(client, mailer, "owner@example.com")

    assert len(mailer.sent) == 1
    message = mailer.sent[0]
    assert message.to == "owner@example.com"
    assert "/reset-password?token=" in message.body


async def test_forgot_password_does_not_reveal_unknown_emails(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    """An unknown email gets the same 200 as a known one, and no email is
    sent: the endpoint cannot be used to probe which emails have Accounts."""
    client, mailer = reset_client

    response = await client.post("/auth/forgot-password", json={"email": "nobody@example.com"})

    assert response.status_code == 204
    assert mailer.sent == []


async def test_forgot_password_matches_emails_case_insensitively(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    """Registration lowercases the email (issue #82), so a reset requested
    with any casing finds the same Account and mails the stored address."""
    client, mailer = reset_client
    await _register_and_request(client, mailer, "Case@Example.com")

    response = await client.post("/auth/forgot-password", json={"email": "case@example.com"})

    assert response.status_code == 204
    assert mailer.sent[-1].to == "case@example.com"


async def test_reset_password_signs_in_only_with_the_new_password(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    client, mailer = reset_client
    token = await _register_and_request(client, mailer, "owner@example.com")

    response = await client.post(
        "/auth/reset-password", json={"token": token, "new_password": "brand-new-pass-123"}
    )
    assert response.status_code == 204

    old_login = await client.post(
        "/auth/login", json={"email": "owner@example.com", "password": "hunter2-hunter2"}
    )
    assert old_login.status_code == 401
    new_login = await client.post(
        "/auth/login", json={"email": "owner@example.com", "password": "brand-new-pass-123"}
    )
    assert new_login.status_code == 200


async def test_reset_token_is_single_use(reset_client: tuple[AsyncClient, FakeMailer]) -> None:
    client, mailer = reset_client
    token = await _register_and_request(client, mailer, "owner@example.com")

    first = await client.post(
        "/auth/reset-password", json={"token": token, "new_password": "brand-new-pass-123"}
    )
    assert first.status_code == 204

    second = await client.post(
        "/auth/reset-password", json={"token": token, "new_password": "yet-another-pass"}
    )
    assert second.status_code == 400


async def test_reset_rejects_a_token_that_never_existed(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    client, _ = reset_client

    response = await client.post(
        "/auth/reset-password", json={"token": "forged-token", "new_password": "brand-new-pass"}
    )

    assert response.status_code == 400


async def test_reset_rejects_an_expired_token(database_url: str) -> None:
    """A token is dead the moment its expiry passes: built with a zero-minute
    expiry, the link is already expired when the email arrives."""
    mailer = FakeMailer()
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        mailer=mailer,
        password_reset_expire_minutes=0,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        token = await _register_and_request(client, mailer, "owner@example.com")

        response = await client.post(
            "/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"}
        )

        assert response.status_code == 400
    app.state.engine.dispose()


async def test_reset_rejects_a_short_new_password(
    reset_client: tuple[AsyncClient, FakeMailer],
) -> None:
    client, mailer = reset_client
    token = await _register_and_request(client, mailer, "owner@example.com")

    response = await client.post(
        "/auth/reset-password", json={"token": token, "new_password": "short"}
    )

    assert response.status_code == 422
