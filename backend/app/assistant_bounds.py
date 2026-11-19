"""The Assistant's per-Account bounds (ADR-0035, issues #122/#129) and the
runtime they are enforced with, so a leaked session token cannot burn an
Assistant Key quickly: turns per Account per hour, tool steps per turn and
seconds per turn, each a `BUDJETAME_ASSISTANT_*` setting and overridable
through `create_app(assistant_bounds=..., assistant_clock=...)` for tests.

`TurnWindow` holds the turns-per-hour state in memory, per process. This
app runs as one instance (ADR-0024), so a process-wide window is the whole
truth; a restart forgets it, which only ever lets a few more turns
through. The turn loop in `app.services.assistant` applies the other two
bounds and reads time through the seam's `Clock`.
"""

import threading
from collections import deque
from dataclasses import dataclass, field

from app.assistant_seam import Clock
from app.config import settings


@dataclass(frozen=True)
class AssistantBounds:
    """The four numbers of ADR-0035. Production reads them from settings
    (`from_settings`, the one place the defaults live); tests pass their
    own."""

    turns_per_hour: int
    max_tool_steps: int
    turn_seconds: float
    # The wait before the one retry of a provider 429/503 that announced no delay.
    retry_default_seconds: float

    @classmethod
    def from_settings(cls) -> "AssistantBounds":
        return cls(
            turns_per_hour=settings.assistant_turns_per_hour,
            max_tool_steps=settings.assistant_max_tool_steps,
            turn_seconds=settings.assistant_turn_seconds,
            retry_default_seconds=settings.assistant_retry_default_seconds,
        )


class TurnWindow:
    """A sliding one-hour window of turn times per Account. `admit` records
    the turn and returns None, or returns the seconds until the oldest turn
    in the window ages out when the Account is at its limit — the
    `Retry-After` the endpoint sends with the 429. A refused turn is not
    recorded; a turn that ran and failed was."""

    WINDOW_SECONDS = 3600.0

    def __init__(self) -> None:
        self._turns: dict[int, deque[float]] = {}
        self._lock = threading.Lock()  # sync routes run on a thread pool

    def admit(self, account_id: int, *, now: float, limit: int) -> float | None:
        with self._lock:
            turns = self._turns.setdefault(account_id, deque())
            while turns and now - turns[0] >= self.WINDOW_SECONDS:
                turns.popleft()
            if len(turns) >= limit:
                return self.WINDOW_SECONDS - (now - turns[0])
            turns.append(now)
            return None


@dataclass(frozen=True)
class AssistantRuntime:
    """What one app enforces the bounds with: the bounds, the clock the
    turn budget and the window are measured on, and the window itself.
    Built once by `create_app`, read by the turn endpoint."""

    bounds: AssistantBounds
    clock: Clock
    window: TurnWindow = field(default_factory=TurnWindow)
