"""The Anthropic native adapter of the Assistant seam (ADR-0035, issues
#122/#130): `app.assistant_seam.AssistantModel` implemented with the
official Anthropic SDK, registered in `ADAPTERS` for
`AssistantProvider.ANTHROPIC` and selected per turn from the Account's
Assistant Settings by `assistant_model_for`.

The request, as the parent spec fixes it: the system prompt as the
`system` field, the four Draft tools with `strict: true` (every input the
model sends validates against its schema, so the loop's input hygiene is
belt and braces here), `tool_choice` auto — none once the loop reached
its step cap and asks for the written answer — effort low (one line per
Draft needs no deliberation), the model id from the Assistant Settings,
and a `max_tokens` with room for a few tool calls and a reply. Thinking is
left at the model's default: on the current models it cannot be turned
off, and the effort setting keeps it short.

Translation: the seam's neutral messages become Anthropic's — text and
`tool_use` blocks in assistant messages, `tool_result` blocks inside user
messages — and the reply's text and `tool_use` blocks come back as the
seam's blocks. The `thinking` blocks a current model returns are dropped,
not replayed: the seam's transcript has no place for them, and the system
prompt is rebuilt every turn with today's date and names, so a replayed
block would be bound to a prompt that no longer exists. Dropping them is
the documented no-beta path; the model answers each call without the
reasoning of the previous one, which a Draft does not need.

Provider outcomes map to the seam's typed errors and are never handled
here (issue #129): a 401 is `AssistantKeyRejected`; a 429, a 503 or
Anthropic's 529 (overloaded, the same thing as a 503) is
`AssistantProviderBusy` with the delay the `Retry-After` header or the
body announced, None when none was; the SDK's own timeout — the client is
built with the turn budget, `settings.assistant_turn_seconds`, and no SDK
retries, since the loop owns the one retry — is `AssistantProviderTimeout`;
anything else stays an `AssistantSeamError` (a 502 at the endpoint).

The Assistant Key is given to the SDK client and nowhere else: nothing
here logs it, and every error message is scrubbed of it before it leaves
the adapter, so a provider that echoed it could not put it in a log line
or a 502 body.
"""

from collections.abc import Mapping, Sequence
from typing import Literal

import anthropic
from anthropic.types import Message as AnthropicMessage
from anthropic.types import (
    AssistantMessageParam,
    ContentBlockParam,
    MessageParam,
    OutputConfigParam,
    TextBlockParam,
    ToolChoiceParam,
    ToolParam,
    ToolResultBlockParam,
    ToolUseBlockParam,
    UserMessageParam,
)

from app.assistant_providers import ProviderSpec
from app.assistant_seam import (
    ADAPTERS,
    AssistantKeyRejected,
    AssistantModel,
    AssistantProviderBusy,
    AssistantProviderTimeout,
    AssistantReply,
    AssistantSeamError,
    Block,
    Message,
    StopReason,
    TextBlock,
    ToolCallBlock,
    ToolChoice,
    ToolSpec,
    retry_after_from_header,
    retry_delay_from_body,
)
from app.config import settings
from app.models import AssistantProvider

# Room for a few strict tool calls plus a one-line reply per Draft; the
# prototype ran its walkthroughs at this value (issue #122).
MAX_TOKENS = 4096

EFFORT: Literal["low"] = "low"

# The statuses that mean "not now": rate limited, unavailable, and
# Anthropic's own overloaded (529), which the SDK ranks with the 5xx.
BUSY_STATUSES = frozenset({429, 503, 529})


class AnthropicAssistantModel:
    """The seam implementation for one turn: one SDK client, bound to the
    Account's key and the turn budget, and the model id of its Assistant
    Settings."""

    def __init__(self, *, client: anthropic.Anthropic, model: str) -> None:
        self.client = client
        self.model = model

    def complete(
        self,
        *,
        system: str,
        tools: Sequence[ToolSpec],
        messages: Sequence[Message],
        tool_choice: ToolChoice,
    ) -> AssistantReply:
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=[anthropic_tool(tool) for tool in tools],
                tool_choice=anthropic_tool_choice(tool_choice),
                output_config=OutputConfigParam(effort=EFFORT),
                messages=[anthropic_message(message) for message in messages],
            )
        except anthropic.AuthenticationError as error:
            raise AssistantKeyRejected() from error
        except anthropic.APIStatusError as error:
            raise seam_error(error, key=self.client.api_key) from error
        except anthropic.APITimeoutError as error:
            raise AssistantProviderTimeout() from error
        except anthropic.APIConnectionError as error:
            raise AssistantSeamError("Anthropic could not be reached") from error
        except anthropic.APIError as error:
            # What is left: a 2xx body the SDK could not read as a message.
            message = _without_key(f"Anthropic answered unreadably: {error}", self.client.api_key)
            raise AssistantSeamError(message) from error
        return seam_reply(response)


def seam_error(error: anthropic.APIStatusError, *, key: str | None) -> AssistantSeamError:
    """The seam error for a non-2xx answer other than a 401: busy for a
    429, 503 or 529 with the delay announced — `retry-after-ms` (which
    Anthropic sends and its SDK honours), else `Retry-After`, else the
    body — or the untyped one naming the status, the error type and the
    provider's message, scrubbed of the key whatever the provider echoed."""
    if error.status_code in BUSY_STATUSES:
        return AssistantProviderBusy(
            f"Anthropic answered {error.status_code}", retry_after_seconds=_announced_delay(error)
        )
    summary = f"{error.status_code} {error.type or ''}: {_provider_message(error)}"
    return AssistantSeamError(_without_key(f"Anthropic answered {summary}", key))


def _announced_delay(error: anthropic.APIStatusError) -> float | None:
    milliseconds = error.response.headers.get("retry-after-ms")
    if milliseconds is not None and milliseconds.strip().isdigit():
        return int(milliseconds.strip()) / 1000
    delay = retry_after_from_header(error.response.headers.get("retry-after"))
    if delay is not None:
        return delay
    return retry_delay_from_body(error.body if isinstance(error.body, Mapping) else None)


def _without_key(message: str, key: str | None) -> str:
    return message.replace(key, "[key]") if key else message


def _provider_message(error: anthropic.APIStatusError) -> str:
    """The provider's own sentence for a failed request (`error.message`
    of the body), falling back to the SDK's summary."""
    if isinstance(error.body, Mapping):
        detail = error.body.get("error")
        if isinstance(detail, Mapping) and isinstance(detail.get("message"), str):
            return str(detail["message"])
    return error.message


# --- From the Anthropic shape ----------------------------------------------

# Anthropic's stop reasons onto the seam's four. `stop_sequence` cannot
# happen (none is sent) and `pause_turn` only with server tools (none are
# declared): both read as a finished answer. A context window overrun is
# the model running out of room, like `max_tokens`.
_STOP_REASONS: dict[str, StopReason] = {
    "end_turn": "end_turn",
    "tool_use": "tool_use",
    "max_tokens": "max_tokens",
    "refusal": "refusal",
    "stop_sequence": "end_turn",
    "pause_turn": "end_turn",
    "model_context_window_exceeded": "max_tokens",
}


def seam_reply(response: object) -> AssistantReply:
    """The response's text and `tool_use` blocks as the seam's; thinking
    blocks (and any other kind) are dropped, see the module docstring. The
    SDK does not reject a 2xx it cannot read (an HTML page comes back as a
    string, a foreign JSON as a message with no content): that is a seam
    error, not a reply."""
    if not isinstance(response, AnthropicMessage) or response.content is None:
        raise AssistantSeamError("Anthropic answered with a body that is not a message")
    content: list[TextBlock | ToolCallBlock] = []
    for block in response.content:
        if block.type == "text":
            content.append(TextBlock(text=block.text))
        elif block.type == "tool_use":
            tool_input = block.input if isinstance(block.input, dict) else {}
            content.append(ToolCallBlock(id=block.id, name=block.name, input=tool_input))
    stop_reason = _STOP_REASONS.get(response.stop_reason or "end_turn", "end_turn")
    return AssistantReply(content=content, stop_reason=stop_reason)


# --- To the Anthropic shape ------------------------------------------------


def anthropic_tool(tool: ToolSpec) -> ToolParam:
    """A seam tool as a strict Anthropic tool: the schema as-is (the seam
    already makes every field required and forbids extra keys)."""
    return {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
        "strict": True,
    }


def anthropic_tool_choice(tool_choice: ToolChoice) -> ToolChoiceParam:
    """The seam's two choices as Anthropic's: `auto` lets the model call
    tools, `none` asks for the written answer (the step cap)."""
    return {"type": "none"} if tool_choice == "none" else {"type": "auto"}


def anthropic_message(message: Message) -> MessageParam:
    """A seam message as Anthropic's: tool calls become `tool_use` blocks
    of the assistant message, tool results `tool_result` blocks of the
    user message that answers them."""
    content = [_anthropic_block(block) for block in message.content]
    if message.role == "assistant":
        return AssistantMessageParam(role="assistant", content=content)
    return UserMessageParam(role="user", content=content)


def _anthropic_block(block: Block) -> ContentBlockParam:
    if isinstance(block, TextBlock):
        return TextBlockParam(type="text", text=block.text)
    if isinstance(block, ToolCallBlock):
        return ToolUseBlockParam(type="tool_use", id=block.id, name=block.name, input=block.input)
    return ToolResultBlockParam(
        type="tool_result",
        tool_use_id=block.tool_call_id,
        content=block.content,
        is_error=block.is_error,
    )


# --- The factory and its registration -------------------------------------


def anthropic_assistant_model(*, provider: ProviderSpec, model: str, key: str) -> AssistantModel:
    """The `AssistantModelFactory` for Anthropic: a client holding the
    Account's key for this turn only."""
    return AnthropicAssistantModel(client=new_client(key), model=model)


def new_client(key: str) -> anthropic.Anthropic:
    """The SDK client for one turn: the key, the turn budget as the request
    timeout (the loop cannot interrupt a call, issue #129) and no SDK
    retries — the loop makes the one retry after the announced delay, and
    silent SDK retries would both hide that delay and overrun the budget.
    The timeout is httpx's: the longest wait to connect or for the next
    bytes, not a total; a reply that trickles past the budget is caught by
    the loop's own deadline check after the call."""
    return anthropic.Anthropic(
        api_key=key, timeout=settings.assistant_turn_seconds, max_retries=0
    )


ADAPTERS[AssistantProvider.ANTHROPIC] = anthropic_assistant_model
