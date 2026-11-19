"""The Anthropic adapter of the Assistant seam (ADR-0035, issues #122/#130),
tested against recorded request and response shapes: the SDK client is
real, its HTTP transport is a mock that records what was sent and answers
with crafted bodies and statuses, so no test touches the network and the
SDK's own error classes are what the adapter maps.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from itertools import count
from typing import Any

import httpx2
import pytest
from anthropic import Anthropic, DefaultHttpxClient
from httpx import ASGITransport, AsyncClient

from app.assistant_anthropic import AnthropicAssistantModel
from app.assistant_providers import PROVIDERS
from app.assistant_seam import (
    AssistantKeyRejected,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantReply,
    AssistantSeamError,
    Message,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
    ToolSpec,
    assistant_model_for,
)
from app.config import settings
from app.main import create_app
from app.models import AssistantProvider
from conftest import SEED_EMAIL, SEED_PASSWORD

_UNIQUE = count(1)

KEY = "sk-ant-anthropic-adapter-test-key-7f3a"
MODEL = "claude-opus-5-5"

Responder = Callable[[httpx2.Request], httpx2.Response]


def _message_body(
    content: list[dict[str, Any]], stop_reason: str = "end_turn"
) -> dict[str, Any]:
    """A `/v1/messages` success body as Anthropic sends it."""
    return {
        "id": "msg_01",
        "type": "message",
        "role": "assistant",
        "model": MODEL,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


def _error_body(error_type: str, message: str, **extra: Any) -> dict[str, Any]:
    """A `/v1/messages` error body as Anthropic sends it."""
    return {"type": "error", "error": {"type": error_type, "message": message, **extra}}


def _answer(status: int, body: dict[str, Any], headers: dict[str, str] | None = None) -> Responder:
    def respond(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, json=body, headers=headers or {})

    return respond


@dataclass
class RecordedProvider:
    """The provider's end of the wire: every request the adapter made and
    the scripted answers, one per request, in order."""

    answers: list[Responder] = field(default_factory=list)
    requests: list[httpx2.Request] = field(default_factory=list)

    def handle(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        if not self.answers:
            raise AssertionError("RecordedProvider: no scripted answer left")
        return self.answers.pop(0)(request)

    @property
    def last_body(self) -> dict[str, Any]:
        body: dict[str, Any] = json.loads(self.requests[-1].content)
        return body


@pytest.fixture
def provider() -> RecordedProvider:
    return RecordedProvider()


def _sdk_client(provider: RecordedProvider, key: str) -> Anthropic:
    """The real SDK client with the recorded provider as its transport."""
    return Anthropic(
        api_key=key,
        max_retries=0,
        http_client=DefaultHttpxClient(transport=httpx2.MockTransport(provider.handle)),
    )


def _model(provider: RecordedProvider, key: str = KEY) -> AnthropicAssistantModel:
    return AnthropicAssistantModel(client=_sdk_client(provider, key), model=MODEL)


TOOLS = (
    ToolSpec(
        name="list_draft_transactions",
        description="The Draft Transactions of this conversation.",
        input_schema={
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    ),
    ToolSpec(
        name="discard_draft_transaction",
        description="Remove a Draft of this conversation.",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "integer"}},
            "required": ["id"],
            "additionalProperties": False,
        },
    ),
)


# --- The request -------------------------------------------------------------


def test_complete_sends_system_strict_tools_tool_choice_low_effort_and_the_model(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(_answer(200, _message_body([{"type": "text", "text": "ok"}])))

    _model(provider).complete(
        system="You draft.",
        tools=TOOLS,
        messages=[Message(role="user", content=[TextBlock(text="trenta euro")])],
        tool_choice="auto",
    )

    request = provider.requests[-1]
    assert str(request.url) == "https://api.anthropic.com/v1/messages"
    # The SDK's API version, pinned on purpose: it governs what the request
    # means (the prototype of #122 sent this one), so a bump must be noticed.
    assert request.headers["anthropic-version"] == "2026-10-21"
    body = provider.last_body
    assert body["model"] == MODEL
    assert body["system"] == "You draft."
    assert body["tool_choice"] == {"type": "auto"}
    assert body["output_config"] == {"effort": "low"}
    assert body["max_tokens"] == 4096
    assert body["tools"] == [
        {
            "name": "list_draft_transactions",
            "description": "The Draft Transactions of this conversation.",
            "input_schema": TOOLS[0].input_schema,
            "strict": True,
        },
        {
            "name": "discard_draft_transaction",
            "description": "Remove a Draft of this conversation.",
            "input_schema": TOOLS[1].input_schema,
            "strict": True,
        },
    ]
    assert body["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "trenta euro"}]}
    ]
    assert "thinking" not in body


def test_tool_choice_none_and_the_transcript_are_sent_in_the_anthropic_shape(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(_answer(200, _message_body([{"type": "text", "text": "done"}])))
    transcript = [
        Message(role="user", content=[TextBlock(text="trenta euro")]),
        Message(
            role="assistant",
            content=[
                TextBlock(text="Creo la bozza."),
                ToolCallBlock(id="toolu_01", name="create_draft_transaction", input={"amount": 30}),
            ],
        ),
        Message(
            role="user",
            content=[ToolResultBlock(tool_call_id="toolu_01", content='{"id": 7}')],
        ),
        Message(
            role="assistant",
            content=[
                ToolCallBlock(id="toolu_02", name="discard_draft_transaction", input={"id": 99})
            ],
        ),
        Message(
            role="user",
            content=[
                ToolResultBlock(
                    tool_call_id="toolu_02",
                    content="Not a Draft of this conversation",
                    is_error=True,
                )
            ],
        ),
    ]

    _model(provider).complete(system="s", tools=TOOLS, messages=transcript, tool_choice="none")

    body = provider.last_body
    assert body["tool_choice"] == {"type": "none"}
    assert body["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": "trenta euro"}]},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Creo la bozza."},
                {
                    "type": "tool_use",
                    "id": "toolu_01",
                    "name": "create_draft_transaction",
                    "input": {"amount": 30},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_01",
                    "content": '{"id": 7}',
                    "is_error": False,
                }
            ],
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_02",
                    "name": "discard_draft_transaction",
                    "input": {"id": 99},
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_02",
                    "content": "Not a Draft of this conversation",
                    "is_error": True,
                }
            ],
        },
    ]


# --- The reply ---------------------------------------------------------------


def test_reply_keeps_text_and_tool_use_blocks_and_drops_thinking(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(
        _answer(
            200,
            _message_body(
                [
                    {"type": "thinking", "thinking": "", "signature": "EqQBCgIYAhIM"},
                    {"type": "text", "text": "Creo la bozza."},
                    {
                        "type": "tool_use",
                        "id": "toolu_01A",
                        "name": "create_draft_transaction",
                        "input": {"type": "expense", "amount": 30, "description": "Esselunga"},
                    },
                ],
                stop_reason="tool_use",
            ),
        )
    )

    reply = _model(provider).complete(
        system="s",
        tools=TOOLS,
        messages=[Message(role="user", content=[TextBlock(text="trenta euro")])],
        tool_choice="auto",
    )

    assert reply.stop_reason == "tool_use"
    assert reply.content == [
        TextBlock(text="Creo la bozza."),
        ToolCallBlock(
            id="toolu_01A",
            name="create_draft_transaction",
            input={"type": "expense", "amount": 30, "description": "Esselunga"},
        ),
    ]
    assert reply.text == "Creo la bozza."


@pytest.mark.parametrize(
    ("anthropic_stop", "seam_stop"),
    [
        ("end_turn", "end_turn"),
        ("tool_use", "tool_use"),
        ("max_tokens", "max_tokens"),
        ("refusal", "refusal"),
        ("stop_sequence", "end_turn"),
        ("model_context_window_exceeded", "max_tokens"),
    ],
)
def test_stop_reasons_map_to_the_seams_four(
    provider: RecordedProvider, anthropic_stop: str, seam_stop: str
) -> None:
    provider.answers.append(
        _answer(200, _message_body([{"type": "text", "text": "x"}], stop_reason=anthropic_stop))
    )

    reply = _model(provider).complete(
        system="s",
        tools=TOOLS,
        messages=[Message(role="user", content=[TextBlock(text="x")])],
        tool_choice="auto",
    )

    assert reply.stop_reason == seam_stop


# --- Provider statuses onto the seam's typed errors -------------------------


def _complete(provider: RecordedProvider, key: str = KEY) -> AssistantReply:
    return _model(provider, key).complete(
        system="s",
        tools=TOOLS,
        messages=[Message(role="user", content=[TextBlock(text="x")])],
        tool_choice="auto",
    )


def test_a_401_is_the_rejected_key_without_the_key_in_the_message(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(
        _answer(401, _error_body("authentication_error", "invalid x-api-key"))
    )

    with pytest.raises(AssistantKeyRejected) as raised:
        _complete(provider)

    assert KEY not in str(raised.value)


def test_a_429_is_busy_with_the_retry_after_header_delay(provider: RecordedProvider) -> None:
    provider.answers.append(
        _answer(
            429,
            _error_body("rate_limit_error", "This request would exceed your rate limit"),
            headers={"retry-after": "7"},
        )
    )

    with pytest.raises(AssistantProviderBusy) as raised:
        _complete(provider)

    assert raised.value.retry_after_seconds == 7.0
    assert KEY not in str(raised.value)


def test_a_429_prefers_the_retry_after_ms_header(provider: RecordedProvider) -> None:
    provider.answers.append(
        _answer(
            429,
            _error_body("rate_limit_error", "limit"),
            headers={"retry-after-ms": "1500", "retry-after": "2"},
        )
    )

    with pytest.raises(AssistantProviderBusy) as raised:
        _complete(provider)

    assert raised.value.retry_after_seconds == 1.5


def test_a_429_without_an_announced_delay_is_busy_with_none(provider: RecordedProvider) -> None:
    provider.answers.append(_answer(429, _error_body("rate_limit_error", "limit")))

    with pytest.raises(AssistantProviderBusy) as raised:
        _complete(provider)

    assert raised.value.retry_after_seconds is None


def test_a_503_is_busy_with_the_delay_the_body_announces(provider: RecordedProvider) -> None:
    provider.answers.append(
        _answer(503, _error_body("api_error", "unavailable", retryDelay="12s"))
    )

    with pytest.raises(AssistantProviderBusy) as raised:
        _complete(provider)

    assert raised.value.retry_after_seconds == 12.0


def test_a_529_overloaded_is_busy_too(provider: RecordedProvider) -> None:
    provider.answers.append(_answer(529, _error_body("overloaded_error", "Overloaded")))

    with pytest.raises(AssistantProviderBusy) as raised:
        _complete(provider)

    assert raised.value.retry_after_seconds is None


def test_the_sdk_timeout_is_the_provider_timeout(provider: RecordedProvider) -> None:
    def time_out(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout("no answer in time", request=request)

    provider.answers.append(time_out)

    with pytest.raises(AssistantProviderTimeout):
        _complete(provider)


def test_any_other_status_is_a_seam_error_naming_the_status_but_never_the_key(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(
        _answer(400, _error_body("invalid_request_error", f"bad key {KEY} in request"))
    )

    with pytest.raises(AssistantSeamError) as raised:
        _complete(provider)

    error = raised.value
    assert not isinstance(
        error, (AssistantKeyRejected, AssistantProviderBusy, AssistantProviderTimeout)
    )
    assert "400" in str(error)
    assert "invalid_request_error" in str(error)
    assert KEY not in str(error)


def test_an_unknown_model_is_a_seam_error_carrying_the_providers_message(
    provider: RecordedProvider,
) -> None:
    provider.answers.append(_answer(404, _error_body("not_found_error", "model: claude-nope")))

    with pytest.raises(AssistantSeamError) as raised:
        _complete(provider)

    assert "model: claude-nope" in str(raised.value)


@pytest.mark.parametrize(
    "answer",
    [
        pytest.param(
            lambda request: httpx2.Response(
                200, text="<html>gateway</html>", headers={"content-type": "text/html"}
            ),
            id="html",
        ),
        pytest.param(_answer(200, {"foo": "bar"}), id="foreign-json"),
    ],
)
def test_a_2xx_that_is_not_a_message_is_a_seam_error(
    provider: RecordedProvider, answer: Responder
) -> None:
    provider.answers.append(answer)

    with pytest.raises(AssistantSeamError) as raised:
        _complete(provider)

    assert not isinstance(
        raised.value, (AssistantKeyRejected, AssistantProviderBusy, AssistantProviderTimeout)
    )


def test_a_connection_failure_is_a_seam_error(provider: RecordedProvider) -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    provider.answers.append(refuse)

    with pytest.raises(AssistantSeamError) as raised:
        _complete(provider)

    assert not isinstance(raised.value, AssistantProviderTimeout)


# --- Registration: selected per turn for an Anthropic Account ---------------


def test_the_production_lookup_builds_the_anthropic_adapter_bound_to_key_model_and_budget() -> None:
    model = assistant_model_for(
        provider=PROVIDERS[AssistantProvider.ANTHROPIC], model="claude-sonnet-5-5", key=KEY
    )

    assert isinstance(model, AnthropicAssistantModel)
    assert model.model == "claude-sonnet-5-5"
    assert model.client.api_key == KEY
    assert model.client.timeout == settings.assistant_turn_seconds
    # The loop owns the one retry after the announced delay (ADR-0035).
    assert model.client.max_retries == 0


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/register",
        json={"email": f"anthropic-{next(_UNIQUE)}@example.com", "password": "hunter2-hunter2"},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create(client: AsyncClient, token: str, path: str, body: dict[str, Any]) -> int:
    response = await client.post(path, json=body, headers=_auth(token))
    assert response.status_code == 201, response.text
    draft_id: int = response.json()["id"]
    return draft_id


async def _turn(
    client: AsyncClient, token: str, text: str, transcript: list[dict[str, Any]]
) -> dict[str, Any]:
    response = await client.post(
        "/assistant/turns", json={"transcript": transcript, "text": text}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


def _tool_use(name: str, input: dict[str, Any], call_id: str) -> Responder:
    return _answer(
        200,
        _message_body(
            [{"type": "tool_use", "id": call_id, "name": name, "input": input}],
            stop_reason="tool_use",
        ),
    )


def _text(text: str) -> Responder:
    return _answer(200, _message_body([{"type": "text", "text": text}]))


async def test_a_turn_for_an_anthropic_account_goes_through_the_adapter(
    database_url: str, provider: RecordedProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Walkthrough 1 of #122 over HTTP with the production adapter lookup:
    only the SDK's transport is a mock, recording the wire and answering
    with Anthropic-shaped bodies. The key reaching the client is the one
    saved in Assistant Settings, decrypted for the turn."""
    keys_given: list[str] = []

    def mock_client(key: str) -> Anthropic:
        keys_given.append(key)
        return _sdk_client(provider, key)

    monkeypatch.setattr("app.assistant_anthropic.new_client", mock_client)
    app = create_app(database_url, seed_email=SEED_EMAIL, seed_password=SEED_PASSWORD)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token = await _login(client)
        response = await client.put(
            "/assistant/settings",
            json={"provider": "anthropic", "key": KEY, "model": MODEL},
            headers=_auth(token),
        )
        assert response.status_code == 200, response.text
        wallet_id = await _create(
            client,
            token,
            "/wallets",
            {"name": "Anthropic adapter Carta", "type": "checking", "opening_balance": "0.00"},
        )
        category_id = await _create(
            client,
            token,
            "/categories",
            {"name": "Anthropic adapter Cibo", "type": "expense", "color": "#ef4444"},
        )
        draft = {
            "type": "expense",
            "amount": 30,
            "date": None,
            "wallet_id": wallet_id,
            "source_wallet_id": None,
            "destination_wallet_id": None,
            "category_id": category_id,
            "recurring_cost_id": None,
            "recurring_income_id": None,
            "description": "Esselunga",
        }

        # Turn 1: the sentence creates one Draft and gets one line back.
        provider.answers += [
            _tool_use("create_draft_transaction", draft, "toolu_create"),
            _text("Spesa 30,00 € Carta / Cibo: Esselunga"),
        ]
        first = await _turn(client, token, "ho speso 30 euro all'Esselunga con la carta, cibo", [])
        assert first["reply"] == "Spesa 30,00 € Carta / Cibo: Esselunga"
        assert keys_given == [KEY]
        drafts = (await client.get("/draft-transactions", headers=_auth(token))).json()
        assert [d["amount"] for d in drafts if d["wallet_id"] == wallet_id] == ["30.00"]
        draft_id = next(d["id"] for d in drafts if d["wallet_id"] == wallet_id)
        # The second request replayed the tool round in Anthropic's shape.
        second_request = json.loads(provider.requests[1].content)
        assert second_request["messages"][1]["content"] == [
            {
                "type": "tool_use",
                "id": "toolu_create",
                "name": "create_draft_transaction",
                "input": draft,
            }
        ]
        result_block = second_request["messages"][2]["content"][0]
        assert result_block["type"] == "tool_result"
        assert result_block["tool_use_id"] == "toolu_create"
        assert result_block["is_error"] is False
        assert json.loads(result_block["content"])["id"] == draft_id

        # Turn 2: the correction updates that Draft through the transcript.
        provider.answers += [
            _tool_use(
                "update_draft_transaction",
                {**{k: None for k in draft}, "id": draft_id, "amount": 35},
                "toolu_update",
            ),
            _text("Aggiornato: 35,00 €"),
        ]
        second = await _turn(client, token, "no, erano 35", first["transcript_tail"])
        assert second["reply"] == "Aggiornato: 35,00 €"
        drafts = (await client.get("/draft-transactions", headers=_auth(token))).json()
        assert [d["amount"] for d in drafts if d["id"] == draft_id] == ["35.00"]

        # Turn 3: "lascia stare" discards it.
        provider.answers += [
            _tool_use("discard_draft_transaction", {"id": draft_id}, "toolu_discard"),
            _text("Bozza scartata."),
        ]
        transcript = first["transcript_tail"] + second["transcript_tail"]
        third = await _turn(client, token, "lascia stare", transcript)
        assert third["reply"] == "Bozza scartata."
        drafts = (await client.get("/draft-transactions", headers=_auth(token))).json()
        assert [d for d in drafts if d["id"] == draft_id] == []
        assert len(provider.requests) == 6
        # The key travelled in a request header only, never in a body.
        for request in provider.requests:
            assert KEY not in request.content.decode()
            auth_headers = request.headers.get("authorization", "") + request.headers.get(
                "x-api-key", ""
            )
            assert KEY in auth_headers
    app.state.engine.dispose()
