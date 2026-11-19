"""The OpenAI-compatible adapter of the provider seam (ADR-0035, issues
#122/#131): one `OpenAICompatibleModel` for every provider that speaks the
chat-completions shape, parameterized by the `base_url` of its row in the
fixed provider table (`app.assistant_providers`: OpenRouter, Google
Gemini). The base URL never comes from the user: the server sends an
Account's Assistant Key only to a host that table names.

The adapter translates the seam's neutral shape to the wire shape and
back; nothing of the provider's shape leaks above it.
"""

import json
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import uuid4

import httpx

from app.assistant_providers import PROVIDERS, ProviderSpec
from app.assistant_seam import (
    ADAPTERS,
    INVALID_TOOL_INPUT_KEY,
    AssistantKeyRejected,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantReply,
    AssistantSeamError,
    Message,
    StopReason,
    TextBlock,
    ToolCallBlock,
    ToolChoice,
    ToolResultBlock,
    ToolSpec,
    retry_after_from_header,
    retry_delay_from_body,
)
from app.config import settings
from app.models import AssistantProvider

# The ceiling on a reply's length; the Assistant answers in a line or two
# per Draft, so this is never reached by a well-behaved model.
_MAX_TOKENS = 4096
# How much of a provider's error message a seam error carries (the turn
# endpoint's 502 detail): enough to read why, never a whole body.
_MESSAGE_CHARS = 200

# OpenRouter's optional attribution headers (its "app attribution"): the
# app's site and name, shown in its usage dashboard. Constants, never the
# Account's.
OPENROUTER_REFERER = "https://budjetame.de"
OPENROUTER_TITLE = "Budjetame"

_EXTRA_HEADERS: dict[AssistantProvider, dict[str, str]] = {
    AssistantProvider.OPENROUTER: {"HTTP-Referer": OPENROUTER_REFERER, "X-Title": OPENROUTER_TITLE},
}


class OpenAICompatibleModel:
    """The seam implementation for one turn: bound to the provider row, the
    model id and the Assistant Key, which travels as a bearer token and is
    neither logged nor put in an error message (a provider message that
    echoes it is redacted). The class itself is the `AssistantModelFactory`
    registered in `ADAPTERS` below.

    `timeout_seconds` bounds each request at the turn budget
    (`settings.assistant_turn_seconds`) since the loop cannot interrupt a
    call (issue #129). httpx applies it per phase (connect, then read), so
    a request to a host that is slow to connect *and* slow to answer can
    outlast the budget by the connect time; the loop's own check between
    calls bounds the rest. `transport` lets tests answer the requests with
    an `httpx.MockTransport`. Production leaves both to their defaults."""

    def __init__(
        self,
        *,
        provider: ProviderSpec,
        model: str,
        key: str,
        timeout_seconds: float | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if provider.base_url is None:
            raise ValueError(f"{provider.label} has no OpenAI-compatible base URL")
        self._url = f"{provider.base_url}/chat/completions"
        self._label = provider.label
        self._model = model
        self._key = key
        self._headers = {
            "Authorization": f"Bearer {key}",
            **_EXTRA_HEADERS.get(provider.id, {}),
        }
        self._timeout = (
            timeout_seconds if timeout_seconds is not None else settings.assistant_turn_seconds
        )
        self._transport = transport

    def complete(
        self,
        *,
        system: str,
        tools: Sequence[ToolSpec],
        messages: Sequence[Message],
        tool_choice: ToolChoice,
    ) -> AssistantReply:
        body = _request_body(
            model=self._model,
            system=system,
            tools=tools,
            messages=messages,
            tool_choice=tool_choice,
        )
        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
                response = client.post(self._url, headers=self._headers, json=body)
        except httpx.TimeoutException as error:
            raise AssistantProviderTimeout(
                f"{self._label} did not answer within {self._timeout:g} s"
            ) from error
        except httpx.HTTPError as error:
            raise AssistantSeamError(
                f"could not reach {self._label}: {self._redact(error)}"
            ) from error
        if response.status_code >= 400:
            self._raise_for_status(response)
        return _reply_from(self._label, _json_body(self._label, response))

    def _raise_for_status(self, response: httpx.Response) -> None:
        """The typed error for an error status (ADR-0035, issue #129): a
        401 or 403 is a rejected key, as is Gemini's 400 whose message names
        the API key (the shape its OpenAI-compatible endpoint answers an
        invalid key with, seen by the catalogue fetcher of issue #127); a
        429 or 503 is busy, with the delay read from `Retry-After` first,
        then the body's `retryDelay` (Gemini's shape); anything else is an
        untyped seam error, a 502 for the client, carrying the provider's
        message so the owner can read why (an unknown model, a model
        without tools)."""
        status = response.status_code
        body = _json_or_none(response)
        detail = _error_message(body) if body else None
        if status in (401, 403) or (status == 400 and detail and "api key" in detail.lower()):
            raise AssistantKeyRejected(f"{self._label} rejected the Assistant Key ({status})")
        if status in (429, 503):
            delay = retry_after_from_header(response.headers.get("Retry-After"))
            if delay is None:
                delay = retry_delay_from_body(body)
            raise AssistantProviderBusy(
                f"{self._label} is busy ({status})", retry_after_seconds=delay
            )
        raise AssistantSeamError(
            f"{self._label} answered {status}" + (f": {self._redact(detail)}" if detail else "")
        )

    def _redact(self, text: object) -> str:
        """The text with the Assistant Key, should a provider echo it,
        replaced: no error message carries the key."""
        return str(text).replace(self._key, "***")


# --- Seam shape to wire shape --------------------------------------------------


def _request_body(
    *,
    model: str,
    system: str,
    tools: Sequence[ToolSpec],
    messages: Sequence[Message],
    tool_choice: ToolChoice,
) -> dict[str, Any]:
    """The chat-completions request: the system prompt as the first
    message, then the transcript, the tools as `function` tools with their
    schemas as-is, and the seam's `tool_choice` passed through (when there
    are tools: the shape rejects a choice without any)."""
    wire_messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for message in messages:
        wire_messages.extend(_wire_messages(message))
    body: dict[str, Any] = {
        "model": model,
        "messages": wire_messages,
        "max_tokens": _MAX_TOKENS,
        "stream": False,
    }
    if tools:
        body["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            }
            for tool in tools
        ]
        body["tool_choice"] = tool_choice
    return body


def _wire_messages(message: Message) -> list[dict[str, Any]]:
    """One seam message as the chat-completions messages it stands for: a
    user message's tool results become one `tool` message each, keyed by
    the call id, followed by its text if any; an assistant message's tool
    calls become `tool_calls` with JSON-encoded arguments, its content the
    text or null when there is none."""
    text = "\n".join(block.text for block in message.content if isinstance(block, TextBlock))
    if message.role == "user":
        wire: list[dict[str, Any]] = [
            {"role": "tool", "tool_call_id": block.tool_call_id, "content": block.content}
            for block in message.content
            if isinstance(block, ToolResultBlock)
        ]
        if text or not wire:
            wire.append({"role": "user", "content": text})
        return wire
    calls = [
        {
            "id": block.id,
            "type": "function",
            "function": {
                "name": block.name,
                "arguments": json.dumps(block.input, ensure_ascii=False),
            },
        }
        for block in message.content
        if isinstance(block, ToolCallBlock)
    ]
    # The shape requires `content` unless `tool_calls` is present: null only
    # beside calls, else the text (empty for a reply that said nothing).
    assistant: dict[str, Any] = {"role": "assistant", "content": text or None if calls else text}
    if calls:
        assistant["tool_calls"] = calls
    return [assistant]


# --- Wire shape to seam shape --------------------------------------------------


def _json_or_none(response: httpx.Response) -> dict[str, Any] | None:
    """The body when it is a JSON object, else None. An error status reads
    its delay and message from it when present; a reply requires it."""
    try:
        body = response.json()
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _json_body(label: str, response: httpx.Response) -> dict[str, Any]:
    body = _json_or_none(response)
    if body is None:
        raise AssistantSeamError(f"{label} answered with a body that is not a JSON object")
    return body


def _error_message(body: Mapping[str, Any]) -> str | None:
    """The provider's own words for an error, when its body carries
    `error.message` (OpenAI's shape, which both providers follow)."""
    error = body.get("error")
    if isinstance(error, Mapping) and isinstance(error.get("message"), str):
        return str(error["message"])[:_MESSAGE_CHARS]
    if isinstance(error, str):
        return error[:_MESSAGE_CHARS]
    return None


def _reply_from(label: str, body: dict[str, Any]) -> AssistantReply:
    """The seam reply for a chat-completions body: the first choice's
    `content` becomes a text block, its `tool_calls` tool-call blocks;
    the stop reason is `tool_use` when there are calls, `max_tokens` when
    the provider stopped for `length`, `end_turn` otherwise. A body with no
    choice is a seam error (OpenRouter puts an upstream failure in `error`
    with a 200)."""
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], Mapping):
        detail = _error_message(body)
        raise AssistantSeamError(
            f"{label} answered with no choices" + (f": {detail}" if detail else "")
        )
    choice = choices[0]
    message = choice.get("message")
    if not isinstance(message, Mapping):
        raise AssistantSeamError(f"{label} answered a choice without a message")
    content: list[TextBlock | ToolCallBlock] = []
    text = _text_of(message.get("content"))
    if text:
        content.append(TextBlock(text=text))
    raw_calls = message.get("tool_calls")
    calls = [
        _tool_call_block(call)
        for call in (raw_calls if isinstance(raw_calls, list) else [])
        if isinstance(call, Mapping)
    ]
    content.extend(calls)
    stop_reason: StopReason
    if calls:
        stop_reason = "tool_use"
    elif choice.get("finish_reason") == "length":
        stop_reason = "max_tokens"
    else:
        stop_reason = "end_turn"
    return AssistantReply(content=content, stop_reason=stop_reason)


def _text_of(content: Any) -> str:
    """A message's `content`: a string, null, or (some providers) a list of
    parts whose text parts are joined."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part["text"])
            for part in content
            if isinstance(part, Mapping) and part.get("type") == "text" and "text" in part
        )
    return ""


def _tool_call_block(call: Mapping[str, Any]) -> ToolCallBlock:
    """One `tool_calls` entry as a `ToolCallBlock`. `arguments` is the JSON
    text of the input; one that does not decode to an object becomes the
    `INVALID_TOOL_INPUT_KEY` marker the loop answers with a tool error (the
    module docstring of `app.assistant_seam`), never an exception. A call
    without an id gets a fresh one, unique across the transcript, so the
    result can still be keyed to it."""
    function = call.get("function")
    function = function if isinstance(function, Mapping) else {}
    name = str(function.get("name") or "")
    call_id = str(call.get("id") or f"call_{uuid4().hex[:12]}")
    arguments = function.get("arguments")
    input: dict[str, Any]
    if arguments is None or arguments == "":
        input = {}
    elif isinstance(arguments, Mapping):
        # Already an object: a compatible server that skips the encoding.
        input = dict(arguments)
    else:
        raw = str(arguments)
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
        input = parsed if isinstance(parsed, dict) else {INVALID_TOOL_INPUT_KEY: raw}
    return ToolCallBlock(id=call_id, name=name, input=input)


# --- Registration -------------------------------------------------------------------

# Every provider row with a base URL speaks this shape, so a new provider
# is one table row (ADR-0035); `app.main` imports this module so the lookup
# finds the adapter in production.
for _spec in PROVIDERS.values():
    if _spec.base_url is not None:
        ADAPTERS[_spec.id] = OpenAICompatibleModel
