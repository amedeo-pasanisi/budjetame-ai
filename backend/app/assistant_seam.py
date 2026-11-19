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
to 502. Three typed subclasses (issue #129) are what an adapter raises for
the provider outcomes it only has to map, never handle: `AssistantKeyRejected`
for a 401 (one reply pointing at Assistant Settings, no retry),
`AssistantProviderBusy` for a 429 or 503, carrying the delay the provider
announced — parsed by the adapter from the `Retry-After` header or the
body's `retryDelay` with the helpers below — which the turn loop waits out
and retries once while it fits the turn budget, and `AssistantProviderTimeout`
when the adapter's own request timeout — which it sets to the turn budget,
`settings.assistant_turn_seconds`, since the loop cannot interrupt a call
— ran out (the "gave up" reply) (ADR-0035).

The loop reads time through the `Clock` protocol so the seconds-per-turn
bound is testable without sleeping: production uses `SystemClock`, tests
inject a `FakeClock` the scripted fake advances by the time a reply "took".
"""

import re
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from math import ceil
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
    """Base of what an adapter raises when the provider cannot answer. An
    untyped one (a 500, a network failure) reaches the endpoint as a 502;
    the typed subclasses below become replies of a 200 turn (issue #129)."""


class AssistantAdapterMissing(AssistantSeamError):
    """No adapter is registered for the Account's provider (yet)."""


class AssistantKeyRejected(AssistantSeamError):
    """The provider refused the Assistant Key (its 401): the turn answers
    with one reply pointing at Assistant Settings and never retries
    (ADR-0035). Adapters raise it as `AssistantKeyRejected()`; the message
    is for logs and must never carry the key."""

    def __init__(self, message: str = "The provider rejected the Assistant Key") -> None:
        super().__init__(message)


class AssistantProviderBusy(AssistantSeamError):
    """The provider could not take the request now (its 429 or 503).
    `retry_after_seconds` is the delay it announced — the adapter parses
    `Retry-After` or the body's `retryDelay` (see `retry_after_from_header`
    and `retry_delay_from_body`) — or None when it announced none, in which
    case the loop waits `AssistantBounds.retry_default_seconds`. The loop
    retries once while the delay fits the remaining turn budget, otherwise
    replies that the provider is busy, naming the seconds (ADR-0035)."""

    def __init__(
        self,
        message: str = "The provider is busy",
        *,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class AssistantProviderTimeout(AssistantSeamError):
    """The adapter's request timed out. The loop cannot interrupt a call,
    so each adapter bounds its own request at the turn budget
    (`settings.assistant_turn_seconds`) and raises this; the turn answers
    that the Assistant gave up (issue #129)."""

    def __init__(self, message: str = "The provider did not answer in time") -> None:
        super().__init__(message)


# --- Reading the delay a provider announces ---------------------------------

_DURATION = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(s|ms)?\s*$", re.IGNORECASE)


def retry_after_from_header(value: str | None) -> float | None:
    """The seconds a `Retry-After` header asks for: a delay in seconds or
    an HTTP date (RFC 9110); None when absent or unreadable. A date in the
    past is zero seconds, never negative."""
    if value is None or not value.strip():
        return None
    if value.strip().isdigit():
        return float(value.strip())
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


def retry_delay_from_body(body: Mapping[str, Any] | None) -> float | None:
    """The seconds a Gemini-shaped error body asks for: `retryDelay` as a
    duration string ("12.5s", "800ms") at the top level, under `error`, or
    in `error.details[]` (google.rpc.RetryInfo); None when absent."""
    if not body:
        return None
    candidates: list[Any] = [body.get("retryDelay")]
    error = body.get("error")
    if isinstance(error, Mapping):
        candidates.append(error.get("retryDelay"))
        details = error.get("details")
        if isinstance(details, list):
            candidates.extend(
                detail.get("retryDelay") for detail in details if isinstance(detail, Mapping)
            )
    for candidate in candidates:
        seconds = _duration_seconds(candidate)
        if seconds is not None:
            return seconds
    return None


def _duration_seconds(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value >= 0 else None
    if isinstance(value, str):
        match = _DURATION.match(value)
        if match is None:
            return None
        number, unit = match.groups()
        return float(number) / (1000 if (unit or "s").lower() == "ms" else 1)
    return None


def whole_seconds(seconds: float) -> int:
    """A delay as the whole seconds a reply or a `Retry-After` header
    names: rounded up, at least 1."""
    return max(1, ceil(seconds))


# --- The clock the turn budget is measured on ----------------------------------


class Clock(Protocol):
    """Monotonic time plus the wait the loop makes before its one retry.
    Production is `SystemClock`; tests inject `FakeClock`."""

    def monotonic(self) -> float: ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    """The real clock: `time.monotonic` and `time.sleep`."""

    def monotonic(self) -> float:
        return time.monotonic()

    def sleep(self, seconds: float) -> None:
        if seconds > 0:
            time.sleep(seconds)


@dataclass
class FakeClock:
    """A clock tests move by hand: `advance` is time passing (the fake
    model reports how long a reply took), `sleep` records the wait the loop
    asked for and passes it at once, so turn-budget tests are instant."""

    now: float = 0.0
    sleeps: list[float] = field(default_factory=list)

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += max(0.0, seconds)

    def advance(self, seconds: float) -> None:
        self.now += seconds


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


@dataclass(frozen=True)
class Slow:
    """A scripted step that took `seconds` on the fake clock before its
    outcome (a reply or an exception): how a test spends the turn budget
    without sleeping."""

    seconds: float
    outcome: "AssistantReply | Exception"


ScriptedStep = AssistantReply | Exception | Slow


@dataclass
class ScriptedAssistantModel:
    """The test double of the seam: answers each call with the next scripted
    step, in order, and records every call. A step is a reply to return, an
    exception to raise (a typed seam error, issue #129) or `Slow(seconds,
    outcome)`, which first advances the `FakeClock` the app was built with.
    `script(...)` sets the steps (replacing any left over); running past
    the script is a test bug and raises rather than inventing a reply."""

    replies: list[ScriptedStep] = field(default_factory=list)
    calls: list[CompletionCall] = field(default_factory=list)
    clock: FakeClock | None = None

    def script(self, *steps: ScriptedStep) -> None:
        self.replies = list(steps)

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
        step = self.replies.pop(0)
        if isinstance(step, Slow):
            if self.clock is None:
                raise AssertionError("ScriptedAssistantModel: a Slow step needs a FakeClock")
            self.clock.advance(step.seconds)
            step = step.outcome
        if isinstance(step, Exception):
            raise step
        return step
