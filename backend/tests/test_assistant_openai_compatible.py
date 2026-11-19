"""The OpenAI-compatible adapter of the provider seam (ADR-0035, issues
#122/#131): the translation both ways between the seam's neutral shape and
the chat-completions shape, and the mapping of provider statuses to the
seam's typed errors, exercised against recorded shapes through an
`httpx.MockTransport`. No test touches the network; the turn loop above
the adapter keeps running on the scripted fake in `test_assistant_turns.py`.
"""

import json
from typing import Any

import httpx
import pytest

from app.assistant_openai_compatible import OpenAICompatibleModel
from app.assistant_providers import PROVIDERS, ProviderSpec
from app.assistant_seam import (
    ADAPTERS,
    INVALID_TOOL_INPUT_KEY,
    AssistantKeyRejected,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantSeamError,
    Message,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
    ToolSpec,
    assistant_model_for,
)
from app.config import settings
from app.models import AssistantProvider

KEY = "sk-or-v1-openai-compatible-test-key-7f3a"

OPENROUTER = PROVIDERS[AssistantProvider.OPENROUTER]
GEMINI = PROVIDERS[AssistantProvider.GEMINI]

CREATE_TOOL = ToolSpec(
    name="create_draft_transaction",
    description="Write a Draft Transaction",
    input_schema={
        "type": "object",
        "properties": {"amount": {"type": ["number", "null"]}},
        "required": ["amount"],
        "additionalProperties": False,
    },
)


def _text_reply(text: str | None, finish_reason: str = "stop") -> dict[str, Any]:
    return {
        "id": "chatcmpl-1",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": finish_reason,
            }
        ],
    }


class Recorder:
    """A mock transport that answers with a fixed response and keeps every
    request it saw, so a test reads the wire shape the adapter produced."""

    def __init__(
        self,
        status: int = 200,
        body: Any = None,
        headers: dict[str, str] | None = None,
        *,
        raw: bytes | None = None,
    ) -> None:
        self.requests: list[httpx.Request] = []
        self._status = status
        self._body = body
        self._headers = headers or {}
        self._raw = raw

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self._raw is not None:
            return httpx.Response(self._status, content=self._raw, headers=self._headers)
        return httpx.Response(self._status, json=self._body, headers=self._headers)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    @property
    def body(self) -> dict[str, Any]:
        payload: dict[str, Any] = json.loads(self.requests[-1].content)
        return payload


def _model(
    recorder: Recorder, provider: ProviderSpec = OPENROUTER, **kwargs: Any
) -> OpenAICompatibleModel:
    return OpenAICompatibleModel(
        provider=provider, model="test/model", key=KEY, transport=recorder.transport, **kwargs
    )


def _complete(
    model: OpenAICompatibleModel, messages: list[Message] | None = None, **kwargs: Any
) -> Any:
    return model.complete(
        system=kwargs.pop("system", "You are the Assistant."),
        tools=kwargs.pop("tools", [CREATE_TOOL]),
        messages=messages
        or [Message(role="user", content=[TextBlock(text="30 euro at Esselunga")])],
        tool_choice=kwargs.pop("tool_choice", "auto"),
    )


# --- The request ----------------------------------------------------------------


@pytest.mark.parametrize("provider", [OPENROUTER, GEMINI], ids=["openrouter", "gemini"])
def test_posts_chat_completions_under_the_fixed_base_url_with_the_bearer_key(
    provider: ProviderSpec,
) -> None:
    recorder = Recorder(body=_text_reply("Done."))
    reply = _complete(_model(recorder, provider))

    request = recorder.requests[0]
    assert request.method == "POST"
    assert str(request.url) == f"{provider.base_url}/chat/completions"
    assert request.headers["Authorization"] == f"Bearer {KEY}"
    assert request.headers["Content-Type"] == "application/json"
    assert reply.content == [TextBlock(text="Done.")]
    assert reply.stop_reason == "end_turn"


def test_request_carries_system_message_function_tools_and_tool_choice() -> None:
    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder), system="Be brief.", tool_choice="none")

    body = recorder.body
    assert body["model"] == "test/model"
    assert body["messages"] == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "30 euro at Esselunga"},
    ]
    assert body["tools"] == [
        {
            "type": "function",
            "function": {
                "name": CREATE_TOOL.name,
                "description": CREATE_TOOL.description,
                "parameters": CREATE_TOOL.input_schema,
            },
        }
    ]
    assert body["tool_choice"] == "none"
    assert body["max_tokens"] > 0
    assert body.get("stream", False) is False


def test_tool_choice_auto_passes_through() -> None:
    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder), tool_choice="auto")
    assert recorder.body["tool_choice"] == "auto"


def test_openrouter_gets_its_attribution_headers_and_gemini_does_not() -> None:
    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder, OPENROUTER))
    headers = recorder.requests[0].headers
    assert headers["HTTP-Referer"].startswith("https://")
    assert headers["X-Title"] == "Budjetame"

    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder, GEMINI))
    headers = recorder.requests[0].headers
    assert "HTTP-Referer" not in headers
    assert "X-Title" not in headers


def test_a_multi_result_tool_turn_becomes_tool_calls_and_one_tool_message_per_result() -> None:
    recorder = Recorder(body=_text_reply("Both written."))
    transcript = [
        Message(role="user", content=[TextBlock(text="30 at Esselunga and 5 for coffee")]),
        Message(
            role="assistant",
            content=[
                TextBlock(text="Writing two Drafts."),
                ToolCallBlock(
                    id="call_a",
                    name="create_draft_transaction",
                    input={"amount": "30.00", "wallet_id": None},
                ),
                ToolCallBlock(
                    id="call_b", name="create_draft_transaction", input={"amount": "5.00"}
                ),
            ],
        ),
        Message(
            role="user",
            content=[
                ToolResultBlock(tool_call_id="call_a", content='{"id": 7}'),
                ToolResultBlock(
                    tool_call_id="call_b", content="amount must be a positive number", is_error=True
                ),
            ],
        ),
        Message(
            role="assistant",
            content=[ToolCallBlock(id="call_c", name="list_draft_transactions", input={})],
        ),
        Message(role="user", content=[ToolResultBlock(tool_call_id="call_c", content="[]")]),
    ]
    _complete(_model(recorder), transcript)

    messages = recorder.body["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "30 at Esselunga and 5 for coffee"}
    assistant = messages[2]
    assert assistant["role"] == "assistant"
    assert assistant["content"] == "Writing two Drafts."
    assert assistant["tool_calls"] == [
        {
            "id": "call_a",
            "type": "function",
            "function": {
                "name": "create_draft_transaction",
                "arguments": '{"amount": "30.00", "wallet_id": null}',
            },
        },
        {
            "id": "call_b",
            "type": "function",
            "function": {"name": "create_draft_transaction", "arguments": '{"amount": "5.00"}'},
        },
    ]
    assert messages[3] == {"role": "tool", "tool_call_id": "call_a", "content": '{"id": 7}'}
    assert messages[4] == {
        "role": "tool",
        "tool_call_id": "call_b",
        "content": "amount must be a positive number",
    }
    assert messages[5] == {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call_c",
                "type": "function",
                "function": {"name": "list_draft_transactions", "arguments": "{}"},
            }
        ],
    }
    assert messages[6] == {"role": "tool", "tool_call_id": "call_c", "content": "[]"}
    assert len(messages) == 7


def test_an_assistant_message_that_said_nothing_goes_out_with_empty_content() -> None:
    """The shape requires `content` unless `tool_calls` is present, and the
    loop keeps a reply that said nothing in the transcript."""
    recorder = Recorder(body=_text_reply("Done."))
    transcript = [
        Message(role="user", content=[TextBlock(text="hello")]),
        Message(role="assistant", content=[]),
        Message(role="user", content=[TextBlock(text="30 euro at Esselunga")]),
    ]
    _complete(_model(recorder), transcript)
    assert recorder.body["messages"][2] == {"role": "assistant", "content": ""}


# --- The response ---------------------------------------------------------------


def _tool_calls_reply(
    *calls: tuple[str, str, str], text: str | None = None, finish_reason: str = "tool_calls"
) -> dict[str, Any]:
    return {
        "id": "chatcmpl-2",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": text,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {"name": name, "arguments": arguments},
                        }
                        for call_id, name, arguments in calls
                    ],
                },
                "finish_reason": finish_reason,
            }
        ],
    }


def test_tool_calls_become_tool_call_blocks_and_stop_with_tool_use() -> None:
    recorder = Recorder(
        body=_tool_calls_reply(
            ("call_1", "create_draft_transaction", '{"amount": 30, "wallet_id": null}'),
            ("call_2", "create_draft_transaction", '{"amount": 5}'),
            text="Two Drafts coming.",
        )
    )
    reply = _complete(_model(recorder))

    assert reply.stop_reason == "tool_use"
    assert reply.content == [
        TextBlock(text="Two Drafts coming."),
        ToolCallBlock(
            id="call_1", name="create_draft_transaction", input={"amount": 30, "wallet_id": None}
        ),
        ToolCallBlock(id="call_2", name="create_draft_transaction", input={"amount": 5}),
    ]


def test_empty_arguments_are_an_empty_input() -> None:
    recorder = Recorder(body=_tool_calls_reply(("call_1", "list_draft_transactions", "")))
    reply = _complete(_model(recorder))
    assert reply.tool_calls == [ToolCallBlock(id="call_1", name="list_draft_transactions", input={})]


def test_unparsable_arguments_become_the_invalid_input_marker_not_a_crash() -> None:
    raw = '{"amount": 30, "wallet_id": '
    recorder = Recorder(body=_tool_calls_reply(("call_1", "create_draft_transaction", raw)))
    reply = _complete(_model(recorder))
    assert reply.stop_reason == "tool_use"
    assert reply.tool_calls == [
        ToolCallBlock(
            id="call_1", name="create_draft_transaction", input={INVALID_TOOL_INPUT_KEY: raw}
        )
    ]


def test_arguments_already_an_object_are_taken_as_is() -> None:
    body = _tool_calls_reply(("call_1", "create_draft_transaction", "{}"))
    body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"] = {"amount": 30}
    reply = _complete(_model(Recorder(body=body)))
    assert reply.tool_calls[0].input == {"amount": 30}


def test_calls_without_an_id_get_fresh_distinct_ids() -> None:
    body = _tool_calls_reply(
        ("", "create_draft_transaction", '{"amount": 30}'),
        ("", "create_draft_transaction", '{"amount": 5}'),
    )
    first = _complete(_model(Recorder(body=body))).tool_calls
    second = _complete(_model(Recorder(body=body))).tool_calls
    ids = {call.id for call in first + second}
    assert len(ids) == 4
    assert all(call_id.startswith("call_") for call_id in ids)


def test_arguments_that_are_not_an_object_also_get_the_marker() -> None:
    recorder = Recorder(body=_tool_calls_reply(("call_1", "create_draft_transaction", "[1, 2]")))
    reply = _complete(_model(recorder))
    assert reply.tool_calls[0].input == {INVALID_TOOL_INPUT_KEY: "[1, 2]"}


def test_finish_reason_length_stops_with_max_tokens() -> None:
    recorder = Recorder(body=_text_reply("The Draft is", finish_reason="length"))
    reply = _complete(_model(recorder))
    assert reply.stop_reason == "max_tokens"
    assert reply.text == "The Draft is"


def test_tool_calls_win_over_finish_reason() -> None:
    recorder = Recorder(
        body=_tool_calls_reply(("call_1", "list_draft_transactions", "{}"), finish_reason="stop")
    )
    assert _complete(_model(recorder)).stop_reason == "tool_use"


def test_null_content_without_tool_calls_is_an_empty_end_turn() -> None:
    recorder = Recorder(body=_text_reply(None))
    reply = _complete(_model(recorder))
    assert reply.content == []
    assert reply.stop_reason == "end_turn"


def test_content_parts_are_joined_into_one_text_block() -> None:
    body = _text_reply(None)
    body["choices"][0]["message"]["content"] = [
        {"type": "text", "text": "Written: "},
        {"type": "text", "text": "30 euro at Esselunga."},
    ]
    reply = _complete(_model(Recorder(body=body)))
    assert reply.content == [TextBlock(text="Written: 30 euro at Esselunga.")]


def test_a_response_without_choices_is_a_seam_error() -> None:
    with pytest.raises(AssistantSeamError, match="no choices"):
        _complete(_model(Recorder(body={"id": "chatcmpl-3", "choices": []})))


def test_a_200_with_an_error_body_is_a_seam_error_naming_the_provider_message() -> None:
    body = {"error": {"message": "This model does not support tools", "code": 400}}
    with pytest.raises(AssistantSeamError, match="does not support tools"):
        _complete(_model(Recorder(body=body)))


def test_a_body_that_is_not_json_is_a_seam_error() -> None:
    with pytest.raises(AssistantSeamError, match="not a JSON object"):
        _complete(_model(Recorder(raw=b"<html>upstream</html>")))


# --- Provider statuses to the typed errors -------------------------------------

GEMINI_429 = {
    "error": {
        "code": 429,
        "message": "You exceeded your current quota, please check your plan and billing details.",
        "status": "RESOURCE_EXHAUSTED",
        "details": [
            {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "RATE_LIMIT_EXCEEDED"},
            {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "33s"},
        ],
    }
}


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (401, {"error": {"message": "No auth credentials found", "code": 401}}),
        (403, {"error": {"message": "Forbidden"}}),
        (400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key."}}),
    ],
    ids=["401", "403", "gemini-400-api-key"],
)
def test_a_rejected_key_is_the_typed_error_without_the_key(status: int, body: Any) -> None:
    with pytest.raises(AssistantKeyRejected) as caught:
        _complete(_model(Recorder(status, body)))
    assert KEY not in str(caught.value)


def test_another_400_is_a_seam_error_not_a_rejected_key() -> None:
    body = {"error": {"message": "Invalid value for 'tool_choice'", "code": 400}}
    with pytest.raises(AssistantSeamError, match="tool_choice") as caught:
        _complete(_model(Recorder(400, body)))
    assert not isinstance(caught.value, AssistantKeyRejected)


def test_429_with_retry_after_header_is_busy_with_the_delay() -> None:
    recorder = Recorder(429, {"error": {"message": "Rate limited"}}, {"Retry-After": "12"})
    with pytest.raises(AssistantProviderBusy) as caught:
        _complete(_model(recorder))
    assert caught.value.retry_after_seconds == 12.0


def test_429_with_gemini_retry_delay_in_the_body_is_busy_with_the_delay() -> None:
    with pytest.raises(AssistantProviderBusy) as caught:
        _complete(_model(Recorder(429, GEMINI_429), GEMINI))
    assert caught.value.retry_after_seconds == 33.0


def test_the_header_delay_wins_over_the_body_delay() -> None:
    recorder = Recorder(429, GEMINI_429, {"Retry-After": "7"})
    with pytest.raises(AssistantProviderBusy) as caught:
        _complete(_model(recorder, GEMINI))
    assert caught.value.retry_after_seconds == 7.0


def test_503_without_a_delay_is_busy_with_none() -> None:
    body = {"error": {"code": 503, "message": "The model is overloaded. Please try again later."}}
    with pytest.raises(AssistantProviderBusy) as caught:
        _complete(_model(Recorder(503, body), GEMINI))
    assert caught.value.retry_after_seconds is None


def test_503_with_a_body_that_is_not_json_is_still_busy() -> None:
    with pytest.raises(AssistantProviderBusy) as caught:
        _complete(_model(Recorder(503, raw=b"Service Unavailable", headers={"Retry-After": "3"})))
    assert caught.value.retry_after_seconds == 3.0


@pytest.mark.parametrize(
    ("status", "body", "fragment"),
    [
        (404, {"error": {"message": "No endpoints found for test/model", "code": 404}}, "No endpoints"),
        (500, {"error": {"message": "Internal error"}}, "500"),
        (502, None, "502"),
    ],
    ids=["404", "500", "502-empty"],
)
def test_other_error_statuses_are_untyped_seam_errors(status: int, body: Any, fragment: str) -> None:
    with pytest.raises(AssistantSeamError, match=fragment) as caught:
        _complete(_model(Recorder(status, body)))
    assert type(caught.value) is AssistantSeamError
    assert KEY not in str(caught.value)


def test_an_error_message_that_echoes_the_key_is_redacted() -> None:
    body = {"error": {"message": f"Invalid key {KEY} for this account"}}
    with pytest.raises(AssistantSeamError) as caught:
        _complete(_model(Recorder(500, body)))
    assert KEY not in str(caught.value)
    assert "Invalid key" in str(caught.value)


# --- The request timeout and network failures ------------------------------------


def test_the_request_timeout_is_the_turn_budget_from_settings() -> None:
    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder))
    timeout = recorder.requests[0].extensions["timeout"]
    assert timeout["read"] == settings.assistant_turn_seconds
    assert timeout["connect"] == settings.assistant_turn_seconds


def test_the_timeout_can_be_given_explicitly() -> None:
    recorder = Recorder(body=_text_reply("Done."))
    _complete(_model(recorder, timeout_seconds=4.5))
    assert recorder.requests[0].extensions["timeout"]["read"] == 4.5


def _raising(error: Exception) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return httpx.MockTransport(handler)


def test_a_timed_out_request_is_the_typed_timeout() -> None:
    model = OpenAICompatibleModel(
        provider=OPENROUTER, model="test/model", key=KEY, transport=_raising(httpx.ReadTimeout("slow"))
    )
    with pytest.raises(AssistantProviderTimeout) as caught:
        _complete(model)
    assert KEY not in str(caught.value)


def test_an_unreachable_provider_is_an_untyped_seam_error() -> None:
    model = OpenAICompatibleModel(
        provider=GEMINI, model="test/model", key=KEY, transport=_raising(httpx.ConnectError("down"))
    )
    with pytest.raises(AssistantSeamError, match="could not reach") as caught:
        _complete(model)
    assert type(caught.value) is AssistantSeamError
    assert KEY not in str(caught.value)


# --- Registration ---------------------------------------------------------------


def test_the_adapter_is_registered_for_openrouter_and_gemini_when_the_app_is_wired() -> None:
    import app.main  # noqa: F401  (the wiring imports the adapter so production finds it)

    assert ADAPTERS[AssistantProvider.OPENROUTER] is ADAPTERS[AssistantProvider.GEMINI]
    for provider in (OPENROUTER, GEMINI):
        model = assistant_model_for(provider=provider, model="test/model", key=KEY)
        assert isinstance(model, OpenAICompatibleModel)


def test_the_adapter_refuses_a_provider_without_a_base_url() -> None:
    with pytest.raises(ValueError, match="base URL"):
        OpenAICompatibleModel(
            provider=PROVIDERS[AssistantProvider.ANTHROPIC], model="claude", key=KEY
        )
