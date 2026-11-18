"""The provider seam of the Assistant (ADR-0035, issues #122/#128): one
interface, "given the system prompt, the tools and the messages, return the
next assistant message", in a neutral shape no provider owns.

The turn loop (`app.services.assistant`) sees only this shape; an adapter
translates it to and from one provider's wire format — Anthropic native
(issue #130) and OpenAI-compatible with a base URL from the fixed provider
table (issue #131) — and registers itself in `ADAPTERS`. Production builds
the model for an Account through `assistant_model_for`; tests inject
`ScriptedAssistantModel` through `create_app(assistant_model_factory=...)`,
like the mailer and the Google verifier, so the loop, the tools and the
Draft writes run for real with no network.

The neutral shape doubles as the wire shape of `POST /assistant/turns`: the
client carries the transcript exactly as these models serialise it and
hands it back untouched, so the conversation is stored nowhere (ADR-0035).

Seam errors derive from `AssistantSeamError`, which the turn endpoint maps
to one status; issue #129 adds the typed provider failures (401, 429/503
with a delay) as subclasses and turns them into replies.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.assistant_providers import ProviderSpec
from app.models import AssistantProvider

# --- The neutral message shape ---------------------------------------------


class TextBlock(BaseModel):
    """Written words, from either side."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["text"] = "text"
    text: str


class ToolCallBlock(BaseModel):
    """The model asking for one tool with the input it chose; `id` ties the
    result back to it."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool_call"] = "tool_call"
    id: str
    name: str
    input: dict[str, Any]


class ToolResultBlock(BaseModel):
    """What a tool answered, as text the model reads: JSON for a success,
    the rule message for an error (`is_error`), so the model can correct
    its input and try again."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool_result"] = "tool_result"
    tool_call_id: str
    content: str
    is_error: bool = False


Block = Annotated[TextBlock | ToolCallBlock | ToolResultBlock, Field(discriminator="type")]


class Message(BaseModel):
    """One transcript entry. A user message carries text or tool results;
    an assistant message carries text and tool calls."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: list[Block]


StopReason = Literal["end_turn", "tool_use", "max_tokens", "refusal"]


class AssistantReply(BaseModel):
    """The next assistant message as the seam returns it: its blocks and
    why the model stopped. `tool_use` means the loop must answer the tool
    calls and ask again."""

    model_config = ConfigDict(extra="forbid")

    content: list[TextBlock | ToolCallBlock]
    stop_reason: StopReason

    @property
    def tool_calls(self) -> list[ToolCallBlock]:
        return [block for block in self.content if isinstance(block, ToolCallBlock)]

    @property
    def text(self) -> str:
        return "\n".join(block.text for block in self.content if isinstance(block, TextBlock)).strip()


@dataclass(frozen=True)
class ToolSpec:
    """One tool as the model sees it: a JSON Schema the adapter hands over
    as-is (strict: every field required and nullable, no extra keys)."""

    name: str
    description: str
    input_schema: dict[str, Any]


ToolChoice = Literal["auto", "none"]


# --- The interface -----------------------------------------------------------


class AssistantModel(Protocol):
    """The one seam: the next assistant message for a conversation.
    `tool_choice="none"` asks for a final written answer with no further
    tool calls (the step cap, ADR-0035)."""

    def complete(
        self,
        *,
        system: str,
        tools: Sequence[ToolSpec],
        messages: Sequence[Message],
        tool_choice: ToolChoice,
    ) -> AssistantReply: ...


class AssistantSeamError(Exception):
    """Base of what an adapter raises when the provider cannot answer; the
    endpoint maps it to one status. Issue #129 adds the typed failures."""


class AssistantAdapterMissing(AssistantSeamError):
    """No adapter is registered for the Account's provider (yet)."""


class AssistantModelFactory(Protocol):
    """Builds the seam implementation for one turn from the Account's
    provider row, model id and Assistant Key. Two roles share the shape:
    each adapter registers one in `ADAPTERS` (issues #130/#131), and
    `create_app` injects one — `assistant_model_for` in production, a
    closure returning a scripted fake in tests. Keyword-only, so the two
    strings (model, key) can never be swapped in silence."""

    def __call__(self, *, provider: ProviderSpec, model: str, key: str) -> AssistantModel: ...


# One adapter constructor per provider; the lookup below reads it.
ADAPTERS: dict[AssistantProvider, AssistantModelFactory] = {}


def assistant_model_for(*, provider: ProviderSpec, model: str, key: str) -> AssistantModel:
    """The production lookup: the adapter registered for the Account's
    provider, bound to its model id and Assistant Key for one turn."""
    factory = ADAPTERS.get(provider.id)
    if factory is None:
        raise AssistantAdapterMissing(f"No adapter for the provider {provider.label} yet")
    return factory(provider=provider, model=model, key=key)


# --- The scripted fake -------------------------------------------------------


@dataclass(frozen=True)
class CompletionCall:
    """One call the loop made on the fake, kept for assertions: the prompt
    and the messages exactly as a real adapter would have received them."""

    system: str
    tools: tuple[ToolSpec, ...]
    messages: tuple[Message, ...]
    tool_choice: ToolChoice


@dataclass
class ScriptedAssistantModel:
    """The test double of the seam: answers each call with the next scripted
    reply, in order, and records every call. `script(...)` sets the replies
    (replacing any left over); running past the script is a test bug and
    raises rather than inventing a reply."""

    replies: list[AssistantReply] = field(default_factory=list)
    calls: list[CompletionCall] = field(default_factory=list)

    def script(self, *replies: AssistantReply) -> None:
        self.replies = list(replies)

    def complete(
        self,
        *,
        system: str,
        tools: Sequence[ToolSpec],
        messages: Sequence[Message],
        tool_choice: ToolChoice,
    ) -> AssistantReply:
        self.calls.append(
            CompletionCall(
                system=system,
                tools=tuple(tools),
                messages=tuple(message.model_copy(deep=True) for message in messages),
                tool_choice=tool_choice,
            )
        )
        if not self.replies:
            raise AssertionError("ScriptedAssistantModel: the script ran out of replies")
        return self.replies.pop(0)
