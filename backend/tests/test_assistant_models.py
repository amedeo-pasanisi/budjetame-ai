"""The Assistant model catalogue (issue #127, ADR-0035): `GET
/assistant/models` over the HTTP seam, with the catalogue fetch replaced by
a scripted fake injected through `create_app` — no test touches the
network. The fake hands back raw provider payloads, so the rules (the
OpenRouter `tools` filter and free flag, Gemini's `models/` prefix) run for
real above the seam.
"""

import logging
from collections.abc import AsyncIterator
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.assistant_catalogue import CatalogueKeyRejected, CatalogueUnavailable
from app.main import create_app
from conftest import SEED_EMAIL, SEED_PASSWORD

OPENROUTER = "https://openrouter.ai/api/v1"
GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai"

KEY = "sk-or-v1-assistant-models-test-key-5c1d9e7a3b"
GEMINI_KEY = "AIzaSy-assistant-models-test-key-0042"


class FakeCatalogueFetcher:
    """Scripted `CatalogueFetcher`: one payload per base URL, or one error
    for every call; records what it was asked, key included, so tests can
    assert which key went where."""

    def __init__(self) -> None:
        self.payloads: dict[str, list[dict[str, Any]]] = {}
        self.error: Exception | None = None
        self.calls: list[tuple[str, str | None]] = []

    def fetch_models(self, base_url: str, key: str | None) -> list[dict[str, Any]]:
        self.calls.append((base_url, key))
        if self.error is not None:
            raise self.error
        return self.payloads[base_url]


@pytest.fixture
def fetcher() -> FakeCatalogueFetcher:
    return FakeCatalogueFetcher()


@pytest.fixture
async def client(database_url: str, fetcher: FakeCatalogueFetcher) -> AsyncIterator[AsyncClient]:
    """The app with the fake catalogue fetcher in place of the HTTP one."""
    app = create_app(
        database_url,
        seed_email=SEED_EMAIL,
        seed_password=SEED_PASSWORD,
        catalogue_fetcher=fetcher,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as async_client:
        yield async_client
    app.state.engine.dispose()


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _set(client: AsyncClient, token: str, provider: str, key: str) -> None:
    response = await client.put(
        "/assistant/settings", json={"provider": provider, "key": key}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text


async def _remove(client: AsyncClient, token: str) -> None:
    response = await client.delete("/assistant/settings", headers=_auth(token))
    assert response.status_code == 204, response.text


def _openrouter_entry(
    model_id: str, name: str, *, tools: bool, prompt: str, completion: str
) -> dict[str, Any]:
    """An entry shaped like OpenRouter's public `/models` catalogue."""
    parameters = ["temperature", "max_tokens"] + (["tools", "tool_choice"] if tools else [])
    return {
        "id": model_id,
        "name": name,
        "pricing": {"prompt": prompt, "completion": completion, "request": "0"},
        "supported_parameters": parameters,
    }


# --- Anthropic: the fixed table -----------------------------------------------


async def test_anthropic_lists_the_three_ids_from_the_table_without_a_fetch(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)

    response = await client.get("/assistant/models", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "provider": "anthropic",
        "models": [
            {"id": "claude-opus-5-5", "label": "Claude Opus 5.5", "free": False},
            {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5", "free": False},
            {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5", "free": False},
        ],
    }
    assert fetcher.calls == []


# --- OpenRouter: the public catalogue, tool-capable, free flagged -------------


async def test_openrouter_keeps_tool_capable_models_and_flags_the_free_ones(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)
    fetcher.payloads[OPENROUTER] = [
        _openrouter_entry(
            "nvidia/nemotron-nano-9b-v2:free",
            "NVIDIA: Nemotron Nano 9B V2 (free)",
            tools=True,
            prompt="0",
            completion="0",
        ),
        _openrouter_entry(
            "anthropic/claude-sonnet-5.5",
            "Anthropic: Claude Sonnet 5.5",
            tools=True,
            prompt="0.000003",
            completion="0.000015",
        ),
        _openrouter_entry(
            "meta-llama/llama-3-8b:free",
            "Meta: Llama 3 8B (free)",
            tools=False,
            prompt="0",
            completion="0",
        ),
        _openrouter_entry(
            "some/half-free", "Half free", tools=True, prompt="0", completion="0.000001"
        ),
    ]

    # The query names the provider: the picker fills before the key is saved.
    response = await client.get(
        "/assistant/models", params={"provider": "openrouter"}, headers=_auth(token)
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "provider": "openrouter",
        "models": [
            {
                "id": "anthropic/claude-sonnet-5.5",
                "label": "Anthropic: Claude Sonnet 5.5",
                "free": False,
            },
            {"id": "some/half-free", "label": "Half free", "free": False},
            {
                "id": "nvidia/nemotron-nano-9b-v2:free",
                "label": "NVIDIA: Nemotron Nano 9B V2 (free)",
                "free": True,
            },
        ],
    }
    # The public catalogue needs no key, so none is sent — least of all the
    # Anthropic key the Account stored.
    assert fetcher.calls == [(OPENROUTER, None)]


async def test_openrouter_skips_malformed_entries(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    fetcher.payloads[OPENROUTER] = [
        {"id": "no/parameters", "name": "No parameters"},
        {"name": "No id", "supported_parameters": ["tools"]},
        {"id": "no/pricing", "name": "No pricing", "supported_parameters": ["tools"]},
        {
            "id": "odd/pricing",
            "supported_parameters": ["tools"],
            "pricing": {"prompt": "free", "completion": None},
        },
    ]

    response = await client.get(
        "/assistant/models", params={"provider": "openrouter"}, headers=_auth(token)
    )

    assert response.status_code == 200, response.text
    assert response.json()["models"] == [
        {"id": "no/pricing", "label": "No pricing", "free": False},
        {"id": "odd/pricing", "label": "odd/pricing", "free": False},
    ]


# --- Gemini: the key's models ---------------------------------------------------


async def test_gemini_lists_the_stored_keys_models_with_the_prefix_stripped(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "gemini", GEMINI_KEY)
    fetcher.payloads[GEMINI] = [
        {"id": "models/gemini-4-hydrogen", "object": "model", "owned_by": "google"},
        {"id": "models/gemini-4-flash", "object": "model", "owned_by": "google"},
        {"id": "models/embedding-001", "object": "model", "owned_by": "google"},
        {"object": "model"},
    ]

    response = await client.get("/assistant/models", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert response.json() == {
        "provider": "gemini",
        "models": [
            {"id": "embedding-001", "label": "embedding-001", "free": False},
            {"id": "gemini-4-flash", "label": "gemini-4-flash", "free": False},
            {"id": "gemini-4-hydrogen", "label": "gemini-4-hydrogen", "free": False},
        ],
    }
    assert fetcher.calls == [(GEMINI, GEMINI_KEY)]
    assert GEMINI_KEY not in response.text


async def test_a_key_in_the_header_lists_before_it_is_saved(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _remove(client, token)
    fetcher.payloads[GEMINI] = [{"id": "models/gemini-4-hydrogen"}]

    response = await client.get(
        "/assistant/models",
        params={"provider": "gemini"},
        headers={**_auth(token), "X-Assistant-Key": f" {GEMINI_KEY} "},
    )

    assert response.status_code == 200, response.text
    assert [m["id"] for m in response.json()["models"]] == ["gemini-4-hydrogen"]
    assert fetcher.calls == [(GEMINI, GEMINI_KEY)]


async def test_the_header_key_wins_over_the_stored_one(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "gemini", GEMINI_KEY)
    fetcher.payloads[GEMINI] = []
    replacement = "AIzaSy-assistant-models-replacement-key-7"

    response = await client.get(
        "/assistant/models", headers={**_auth(token), "X-Assistant-Key": replacement}
    )

    assert response.status_code == 200, response.text
    assert fetcher.calls == [(GEMINI, replacement)]


async def test_a_key_stored_for_another_provider_is_never_sent(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "anthropic", KEY)

    response = await client.get(
        "/assistant/models", params={"provider": "gemini"}, headers=_auth(token)
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == (
        "Google Gemini lists its models with a key: enter the Assistant Key first"
    )
    assert fetcher.calls == []


async def test_no_settings_and_no_provider_is_a_409(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _remove(client, token)

    response = await client.get("/assistant/models", headers=_auth(token))

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "No Assistant Settings: choose a provider first"
    assert fetcher.calls == []


# --- Provider failures are never 500s -----------------------------------------


async def test_a_rejected_key_points_at_settings(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    await _set(client, token, "gemini", GEMINI_KEY)
    fetcher.error = CatalogueKeyRejected()

    response = await client.get("/assistant/models", headers=_auth(token))

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == (
        "The provider rejected the Assistant Key: check the key in Settings"
    )
    assert GEMINI_KEY not in response.text


async def test_an_unreadable_catalogue_is_a_502_with_a_message(
    client: AsyncClient, fetcher: FakeCatalogueFetcher
) -> None:
    token = await _login(client)
    fetcher.error = CatalogueUnavailable(f"{OPENROUTER}/models answered 503")

    response = await client.get(
        "/assistant/models", params={"provider": "openrouter"}, headers=_auth(token)
    )

    assert response.status_code == 502, response.text
    assert "type a model id" in response.json()["detail"]


async def test_an_unknown_provider_is_a_422(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.get(
        "/assistant/models", params={"provider": "mistral"}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_listing_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/assistant/models")).status_code == 401


async def test_the_key_is_never_logged(
    client: AsyncClient, fetcher: FakeCatalogueFetcher, caplog: pytest.LogCaptureFixture
) -> None:
    token = await _login(client)
    await _set(client, token, "gemini", GEMINI_KEY)
    header_key = "AIzaSy-assistant-models-header-key-9"
    fetcher.payloads[GEMINI] = [{"id": "models/gemini-4-hydrogen"}]
    with caplog.at_level(logging.DEBUG):
        await client.get("/assistant/models", headers=_auth(token))
        await client.get(
            "/assistant/models", headers={**_auth(token), "X-Assistant-Key": header_key}
        )
        fetcher.error = CatalogueKeyRejected()
        await client.get(
            "/assistant/models", headers={**_auth(token), "X-Assistant-Key": header_key}
        )

    assert all(
        GEMINI_KEY not in record.getMessage() and header_key not in record.getMessage()
        for record in caplog.records
    )
