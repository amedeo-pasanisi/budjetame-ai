"""Assistant Settings (issue #126, ADR-0035): the per-Account provider,
encrypted Assistant Key and model, over the HTTP seam.

The key is write-only: it goes in through PUT and is never read back from
any response body, Backup or Export workbook. Tests lock that by searching
the raw bytes of every body and file for the key they stored.
"""

import logging
from collections.abc import AsyncIterator
from io import BytesIO
from itertools import count
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from conftest import SEED_EMAIL, SEED_PASSWORD, delete_account, insert_foreign_account

_UNIQUE = count(1)

# A plausible-looking key that no fixture elsewhere could contain by accident.
KEY = "sk-ant-assistant-settings-test-key-9f3a7c2e1b4d"


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _set(
    client: AsyncClient, token: str, provider: str, key: str, model: str | None = None
) -> dict[str, object]:
    body: dict[str, object] = {"provider": provider, "key": key}
    if model is not None:
        body["model"] = model
    response = await client.put("/assistant/settings", json=body, headers=_auth(token))
    assert response.status_code == 200, response.text
    assert key not in response.text
    return response.json()


async def _status(client: AsyncClient, token: str) -> dict[str, object]:
    response = await client.get("/assistant/settings", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _remove(client: AsyncClient, token: str) -> None:
    response = await client.delete("/assistant/settings", headers=_auth(token))
    assert response.status_code == 204, response.text


def _workbook_text(content: bytes) -> str:
    """Every XML part of an .xlsx, decoded: a deflated zip hides literal
    bytes, so leakage is searched in the unpacked parts."""
    with ZipFile(BytesIO(content)) as archive:
        return "".join(
            archive.read(name).decode("utf-8", errors="replace") for name in archive.namelist()
        )


# --- Lifecycle --------------------------------------------------------------


async def test_status_starts_not_configured(client: AsyncClient) -> None:
    token = await _login(client)
    await _remove(client, token)  # the shared seed may carry an earlier test's key

    assert await _status(client, token) == {
        "configured": False,
        "provider": None,
        "model": None,
        "last4": None,
    }


async def test_set_stores_provider_model_and_reports_last4(client: AsyncClient) -> None:
    token = await _login(client)

    body = await _set(client, token, "anthropic", KEY, "claude-sonnet-5-5")

    assert body == {
        "configured": True,
        "provider": "anthropic",
        "model": "claude-sonnet-5-5",
        "last4": KEY[-4:],
    }
    assert await _status(client, token) == body


async def test_set_without_a_model_picks_the_provider_default(client: AsyncClient) -> None:
    token = await _login(client)

    body = await _set(client, token, "anthropic", KEY)

    assert body["model"] == "claude-opus-5-5"


async def test_switching_provider_replaces_the_key_and_resets_the_model(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY, "claude-sonnet-5-5")

    other_key = "sk-or-v1-another-key-for-openrouter-77aa"
    body = await _set(client, token, "openrouter", other_key)

    assert body["provider"] == "openrouter"
    assert body["last4"] == "77aa"
    assert body["model"] == "nvidia/nemotron-nano-9b-v2:free"


async def test_gemini_has_its_own_default_model(client: AsyncClient) -> None:
    token = await _login(client)

    body = await _set(client, token, "gemini", "AIzaSy-gemini-test-key-0001")

    assert body["model"] == "gemini-4-hydrogen"


async def test_remove_clears_all_three(client: AsyncClient) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY, "claude-sonnet-5-5")

    await _remove(client, token)

    assert await _status(client, token) == {
        "configured": False,
        "provider": None,
        "model": None,
        "last4": None,
    }


async def test_remove_is_idempotent(client: AsyncClient) -> None:
    token = await _login(client)
    await _remove(client, token)
    await _remove(client, token)


# --- Validation --------------------------------------------------------------


async def test_set_rejects_an_unknown_provider(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.put(
        "/assistant/settings",
        json={"provider": "mistral", "key": KEY},
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert KEY not in response.text


async def test_a_missing_provider_is_a_422_that_does_not_echo_the_key(
    client: AsyncClient,
) -> None:
    """FastAPI's own validation 422 would carry the whole body as `input`."""
    token = await _login(client)

    response = await client.put(
        "/assistant/settings", json={"key": KEY}, headers=_auth(token)
    )

    assert response.status_code == 422
    assert KEY not in response.text
    assert response.json()["detail"][0]["loc"] == ["provider"]


async def test_a_malformed_body_is_a_422_that_does_not_echo_it(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.put(
        "/assistant/settings",
        content=f'{{"provider": "anthropic", "key": "{KEY}"',  # unterminated
        headers={**_auth(token), "Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert KEY not in response.text


async def test_set_never_logs_the_key(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    token = await _login(client)
    with caplog.at_level(logging.DEBUG):
        await _set(client, token, "anthropic", KEY)
        await _status(client, token)

    assert all(KEY not in record.getMessage() for record in caplog.records)


async def test_set_rejects_a_blank_key_without_echoing_the_body(client: AsyncClient) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)

    response = await client.put(
        "/assistant/settings",
        json={"provider": "anthropic", "key": "   "},
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "The Assistant Key cannot be empty"
    # The earlier setting survives a rejected replace.
    assert (await _status(client, token))["last4"] == KEY[-4:]


async def test_set_trims_the_key_and_the_model(client: AsyncClient) -> None:
    token = await _login(client)

    body = await _set(client, token, "anthropic", f"  {KEY}\n", "  claude-haiku-5-5 ")

    assert body["last4"] == KEY[-4:]
    assert body["model"] == "claude-haiku-5-5"


async def test_endpoints_require_auth(client: AsyncClient) -> None:
    assert (await client.get("/assistant/settings")).status_code == 401
    assert (
        await client.put("/assistant/settings", json={"provider": "anthropic", "key": KEY})
    ).status_code == 401
    assert (await client.delete("/assistant/settings")).status_code == 401


# --- Scoping (ADR-0003) --------------------------------------------------------


async def test_settings_are_per_account(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)
    email = f"assistant-settings-foreign-{next(_UNIQUE)}@budjetame.dev"
    foreign_id = insert_foreign_account(database_url, email)
    try:
        response = await client.post(
            "/auth/login", json={"email": email, "password": "whatever"}
        )
        foreign_token = response.json()["access_token"]

        assert (await _status(client, foreign_token))["configured"] is False
    finally:
        delete_account(database_url, foreign_id)


# --- The key never leaves the server ----------------------------------------


async def test_key_is_absent_from_account_backup_and_export(client: AsyncClient) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)

    me = await client.get("/auth/me", headers=_auth(token))
    assert me.status_code == 200
    assert KEY not in me.text
    assert "assistant" not in me.text

    backup = await client.get("/backup/export", headers=_auth(token))
    assert backup.status_code == 200
    assert KEY not in _workbook_text(backup.content)
    assert "assistant" not in _workbook_text(backup.content).lower()

    export = await client.get("/transactions/export", headers=_auth(token))
    assert export.status_code == 200
    assert KEY not in _workbook_text(export.content)


async def test_restore_leaves_the_stored_key_as_it_was(client: AsyncClient) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY, "claude-sonnet-5-5")
    backup = await client.get("/backup/export", headers=_auth(token))

    restored = await client.post(
        "/backup/restore",
        files={
            "file": (
                "backup.xlsx",
                backup.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=_auth(token),
    )
    assert restored.status_code == 200, restored.text

    assert await _status(client, token) == {
        "configured": True,
        "provider": "anthropic",
        "model": "claude-sonnet-5-5",
        "last4": KEY[-4:],
    }


async def test_restore_never_writes_a_key(client: AsyncClient) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)
    backup = await client.get("/backup/export", headers=_auth(token))
    await _remove(client, token)

    restored = await client.post(
        "/backup/restore",
        files={
            "file": (
                "backup.xlsx",
                backup.content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        headers=_auth(token),
    )
    assert restored.status_code == 200, restored.text

    assert (await _status(client, token))["configured"] is False


# --- A different server secret ----------------------------------------------


@pytest.fixture
async def rotated_client(database_url: str) -> AsyncIterator[AsyncClient]:
    """The same database behind an app whose Assistant Key secret differs:
    what a deployment looks like after the secret was lost or rotated."""
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        assistant_key_secret="a-different-secret-than-the-one-that-stored-the-key",
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.state.engine.dispose()


async def test_a_key_under_another_secret_reads_as_not_configured(
    client: AsyncClient, rotated_client: AsyncClient
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY, "claude-sonnet-5-5")

    status = await _status(rotated_client, token)

    assert status["configured"] is False
    assert status["last4"] is None
    # The provider and model are still what the Account chose: only the key
    # must be re-entered.
    assert status["provider"] == "anthropic"
    assert status["model"] == "claude-sonnet-5-5"


async def test_re_entering_the_key_under_the_new_secret_configures_again(
    client: AsyncClient, rotated_client: AsyncClient
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)

    body = await _set(rotated_client, token, "anthropic", KEY)

    assert body["configured"] is True
    assert (await _status(rotated_client, token))["configured"] is True
    # ...and the original app can no longer read it.
    assert (await _status(client, token))["configured"] is False
