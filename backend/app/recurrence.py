"""Pure recurrence math for Recurring Costs (ADR-0010) — issue #56.

Occurrences are derived, never stored: the k-th Occurrence is the start date
plus k×interval, with days 29–31 clamped to the last day of shorter months.
Every definition carries a start date — left empty at creation it is set to
the creation day (ADR-0024) — and an Occurrence's due date is its own date:
the definition's only date knob is the start date, the due-date override is
gone. "Today" is the calendar day in Europe/Rome, the app's single fixed
timezone (CONTEXT.md).

No I/O, no database: everything here works on `datetime.date` values, so the
derivation is unit-tested directly like the dates helpers. The HTTP layer
and the service layer wire stored definitions into these functions.
"""

import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")

_DAY_UNITS = {"days", "weeks"}
_MONTH_UNITS = {"months"}
_YEAR_UNITS = {"years"}
_UNITS = _DAY_UNITS | _MONTH_UNITS | _YEAR_UNITS

# The skip anchor (ADR-0016): the Occurrence's own date for day/week
# intervals, (year, month) for month intervals, the year for year
# intervals. One period names at most one Occurrence of a sequence (the
# interval is at least one unit).
Period = date | tuple[int, int] | int


def rome_today() -> date:
    """The calendar day in Europe/Rome right now (CONTEXT.md: the app's
    single fixed timezone)."""
    return datetime.now(ROME).date()


def rome_day_of(timestamp: datetime) -> date:
    """The Europe/Rome calendar day containing the given timestamp — used to
    turn a stored creation timestamp into a start date (an empty start date
    at creation is set to the creation day, ADR-0024)."""
    return timestamp.astimezone(ROME).date()


def _clamp_day(year: int, month: int, day: int) -> date:
    """The given calendar day, clamped to the last day of its month — the
    last-day rule for days 29–31 landing on shorter months (ADR-0010)."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def _add_months(start: date, months: int) -> date:
    """`start` moved forward `months` calendar months, the day preserved and
    clamped to the target month's last day (a January 31 + 1 month lands on
    February 28/29; the next step still starts from the 31st, not the clamped
    day)."""
    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    return _clamp_day(year, month, start.day)


def _add_years(start: date, years: int) -> date:
    """`start` moved forward `years` calendar years, month and day preserved
    and clamped (a February 29 lands on February 28 in non-leap years)."""
    return _clamp_day(start.year + years, start.month, start.day)


def period_span_end(period: Period) -> date:
    """The latest calendar day an Occurrence of the given period can fall
    on: the period's own date for day/week intervals, the last day of the
    month for (year, month) periods, December 31st for a year period. One
    period of a sequence holds at most one Occurrence, and that Occurrence
    lies inside the period's span, so a walk over a sequence can bound the
    hunt for a skipped Occurrence by the span end of the largest stored
    period (ADR-0026)."""
    if isinstance(period, tuple):
        year, month = period
        return date(year, month, calendar.monthrange(year, month)[1])
    if isinstance(period, int):
        return date(period, 12, 31)
    return period


def occurrence_date(start: date, n: int, unit: str, k: int) -> date:
    """The k-th Occurrence of a definition starting on `start` and repeating
    every n `unit`s (k = 0 is the start date itself).

    Day and week intervals count calendar days; month and year intervals
    move calendar months/years with the day clamped to the last day of
    shorter months — per resulting date, so "January 31, every month" is
    Jan 31, Feb 28/29, Mar 31, ... (ADR-0010). An Occurrence's due date is
    its own date (ADR-0024): there is no override to shift it.
    """
    if n < 1:
        raise ValueError(f"interval must be positive, got {n}")
    step = k * n
    if unit in _DAY_UNITS:
        days = step if unit == "days" else step * 7
        return start + timedelta(days=days)
    if unit in _MONTH_UNITS:
        return _add_months(start, step)
    if unit in _YEAR_UNITS:
        return _add_years(start, step)
    raise ValueError(f"unknown interval unit: {unit!r}")


def period_of(occurrence: date, unit: str) -> Period:
    """The skip period of one Occurrence under a unit (ADR-0016): the date
    itself for day and week intervals, (year, month) for month intervals,
    the year for year intervals. Occurrences are one per period per unit
    (the interval is at least one unit), so a period names at most one
    Occurrence of a given sequence.

    A skip is stored as the Occurrence's own date at skip time; its
    effective period under the *current* unit is this function of that
    date — which is what makes the skip travel with the Occurrence when
    the definition is edited: a skipped month becomes its year when the
    interval changes to years, a skipped year becomes the month of the
    skipped Occurrence when it changes to months.
    """
    if unit in _DAY_UNITS:
        return occurrence
    if unit in _MONTH_UNITS:
        return (occurrence.year, occurrence.month)
    if unit in _YEAR_UNITS:
        return occurrence.year
    raise ValueError(f"unknown interval unit: {unit!r}")


def _elapsed_intervals(start: date, n: int, unit: str, today: date) -> int:
    """A safe lower estimate of k for the first Occurrence on or after
    `today` — Occurrence dates are strictly increasing in k, so
    `next_due_date` walks forward from here (the clamp can push an
    Occurrence ahead of its interval boundary, so the estimate can sit one
    occurrence behind; at most a few steps are ever needed)."""
    if unit in _DAY_UNITS:
        days = (today - start).days
        return max(0, days // (n if unit == "days" else n * 7))
    if unit in _MONTH_UNITS:
        months = (today.year - start.year) * 12 + (today.month - start.month)
        return max(0, months // n)
    if unit in _YEAR_UNITS:
        return max(0, (today.year - start.year) // n)
    raise ValueError(f"unknown interval unit: {unit!r}")


def next_due_date(
    start: date,
    n: int,
    unit: str,
    today: date,
    skipped: set[Period],
) -> date:
    """The next due date: the first Occurrence whose own date is `today` or
    later (an Occurrence due today is not yet a Backlog item — CONTEXT.md
    counts only today and earlier).

    Occurrence dates are strictly increasing in k, so the search starts from
    the interval estimate and walks forward while the date is still behind
    today, or back when the estimate overshot (the clamp can push an
    Occurrence past today's day within the same month/year, so the estimate
    is off by at most a few steps). An Occurrence whose period is in
    `skipped` (ADR-0016) is not due: the walk steps past it, and a dormant
    skip (a period holding no Occurrence of the current sequence) never
    blocks anything.
    """
    k = _elapsed_intervals(start, n, unit, today)
    while True:
        due = occurrence_date(start, n, unit, k)
        if due >= today:
            if k == 0 or occurrence_date(start, n, unit, k - 1) < today:
                break
            k -= 1
        else:
            k += 1
    while period_of(occurrence_date(start, n, unit, k), unit) in skipped:
        k += 1
    return occurrence_date(start, n, unit, k)


def occurrences_in_window(
    start: date,
    n: int,
    unit: str,
    window_start: date,
    window_end: date,
    skipped: set[Period],
) -> list[date]:
    """The dates of every Occurrence of the definition that fall inside the
    window `[window_start, window_end]`, both edges included, strictly
    increasing — the missing cousin of `next_due_date` and `backlog_count`:
    where they find one boundary, this walks the whole span, so the Budget
    can sum one definition's amount per returned date (issue #64). The
    29–31 clamping applies per Occurrence exactly as in `occurrence_date`
    (ADR-0024: an Occurrence's due date is its own date). An Occurrence
    whose period is in `skipped` (ADR-0016) never enters the window — the
    Budget must not count a skipped Occurrence's amount.

    Occurrence dates are strictly increasing in k, so the walk starts at the
    interval estimate and only ever advances — at most a few steps before
    the window, then one step per date inside it.
    """
    if window_end < window_start:
        raise ValueError(
            f"window end {window_end} is before window start {window_start}"
        )
    k = _elapsed_intervals(start, n, unit, window_start)
    dues: list[date] = []
    while True:
        occurrence = occurrence_date(start, n, unit, k)
        if occurrence < window_start:
            k += 1
            continue
        if occurrence > window_end:
            return dues
        if period_of(occurrence, unit) not in skipped:
            dues.append(occurrence)
        k += 1


def backlog_count(
    start: date,
    n: int,
    unit: str,
    today: date,
    paid: set[date],
    skipped: set[Period],
) -> int:
    """The Backlog (issue #58): how many of the definition's Occurrences are
    Unpaid and due `today` or earlier in Europe/Rome — the "N unpaid"
    badge. `paid` is the set of Occurrence dates covered by linked
    Transactions (the stored pins, issue #57): an Occurrence is Unpaid
    exactly when its own date is not in it, so an Occurrence a link covers
    is never counted back in, no matter how the definition (interval, start
    date) was edited since the pin was stored. `skipped` is the set of
    periods (ADR-0016) whose Occurrence the user excused: a Skipped
    Occurrence never counts, and a dormant skip (a period holding no
    Occurrence) never enters the count.

    An Occurrence due today counts: it is unpaid until its linked payment
    is recorded. The boundary walk starts at the interval estimate and
    adjusts; Occurrence dates are strictly increasing in k, so the first k
    whose date is beyond today ends the count.
    """
    k = _elapsed_intervals(start, n, unit, today)
    while True:
        due = occurrence_date(start, n, unit, k)
        if due > today:
            if k == 0:
                return 0
            k -= 1
            continue
        if k == 0 or occurrence_date(
            start, n, unit, k + 1
        ) > today:
            break
        k += 1
    # k is the last Occurrence index due on or before today.
    return sum(
        1
        for i in range(k + 1)
        if occurrence_date(start, n, unit, i) not in paid
        and period_of(occurrence_date(start, n, unit, i), unit) not in skipped
    )
