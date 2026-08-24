"""Pure recurrence math for Recurring Costs (ADR-0010) — issue #56.

Occurrences are derived, never stored: the k-th Occurrence is the start date
plus k×interval, with days 29–31 clamped to the last day of shorter months.
An Occurrence's due date is its own date unless the cost's optional override
shifts it: a day-of-month for month intervals (due in the Occurrence's month)
or a month+day for year intervals (due in the Occurrence's year); day and
week intervals never carry an override. "Today" is the calendar day in
Europe/Rome, the app's single fixed timezone (CONTEXT.md).

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
    """The Europe/Rome calendar day containing the given timestamp — used
    to turn a stored creation timestamp into a start date (an unset start
    date defaults to the creation date, ADR-0010)."""
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


def occurrence_date(start: date, n: int, unit: str, k: int) -> date:
    """The k-th Occurrence of a cost starting on `start` and repeating every
    n `unit`s (k = 0 is the start date itself).

    Day and week intervals count calendar days; month and year intervals
    move calendar months/years with the day clamped to the last day of
    shorter months — per resulting date, so "January 31, every month" is
    Jan 31, Feb 28/29, Mar 31, ... (ADR-0010).
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


def due_date_for(
    occurrence: date, unit: str, due_day: int | None, due_month: int | None
) -> date:
    """The due date of one Occurrence. Without an override it is the
    Occurrence's own date. A month interval's day-of-month override shifts
    it inside the Occurrence's month; a year interval's month+day override
    shifts it inside the Occurrence's year. Days 29–31 clamp to the last day
    of shorter months (ADR-0010). Day and week intervals never carry an
    override."""
    if unit in _DAY_UNITS:
        if due_day is not None or due_month is not None:
            raise ValueError("day and week intervals never carry a due-date override")
        return occurrence
    if unit in _MONTH_UNITS:
        if due_month is not None:
            raise ValueError("month intervals carry a day-of-month override only")
        if due_day is None:
            return occurrence
        return _clamp_day(occurrence.year, occurrence.month, due_day)
    if unit in _YEAR_UNITS:
        if (due_day is None) != (due_month is None):
            raise ValueError("year intervals carry a month+day override")
        if due_day is None or due_month is None:
            return occurrence
        return _clamp_day(occurrence.year, due_month, due_day)
    raise ValueError(f"unknown interval unit: {unit!r}")


def _elapsed_intervals(start: date, n: int, unit: str, today: date) -> int:
    """A safe lower estimate of k for the first Occurrence on or after
    `today` — due dates are strictly increasing in k, so `next_due_date`
    walks forward from here (the override can pull a due date earlier than
    its Occurrence, never into a previous month or year, so at most a few
    steps are ever needed)."""
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
    due_day: int | None,
    due_month: int | None,
    today: date,
    skipped: set[Period],
) -> date:
    """The next due date: the due date of the first Occurrence whose due
    date is `today` or later (an Occurrence due today is not yet a Backlog
    item — CONTEXT.md counts only today and earlier).

    Due dates are strictly increasing in k, so the search starts from the
    interval estimate and walks forward while the due date is still behind
    today, or back when the estimate overshot (the override can only pull a
    due date within its own month/year, so the estimate is off by at most a
    few steps). An Occurrence whose period is in `skipped` (ADR-0016) is
    not due: the walk steps past it, and a dormant skip (a period holding
    no Occurrence of the current sequence) never blocks anything.
    """
    k = _elapsed_intervals(start, n, unit, today)
    while True:
        due = due_date_for(occurrence_date(start, n, unit, k), unit, due_day, due_month)
        if due >= today:
            if k == 0 or (
                due_date_for(occurrence_date(start, n, unit, k - 1), unit, due_day, due_month)
                < today
            ):
                break
            k -= 1
        else:
            k += 1
    while period_of(occurrence_date(start, n, unit, k), unit) in skipped:
        k += 1
    return due_date_for(
        occurrence_date(start, n, unit, k), unit, due_day, due_month
    )


def occurrences_in_window(
    start: date,
    n: int,
    unit: str,
    due_day: int | None,
    due_month: int | None,
    window_start: date,
    window_end: date,
    skipped: set[Period],
) -> list[date]:
    """The due dates of every Occurrence of the definition that fall inside
    the window `[window_start, window_end]`, both edges included, strictly
    increasing — the missing cousin of `next_due_date` and `backlog_count`:
    where they find one boundary, this walks the whole span, so the Budget
    can sum one definition's amount per returned date (issue #64). Overrides
    and the 29–31 clamping apply per Occurrence exactly as in
    `due_date_for`. An Occurrence whose period is in `skipped` (ADR-0016)
    never enters the window — the Budget must not count a skipped
    Occurrence's amount.

    Due dates are strictly increasing in k, so the walk starts at the
    interval estimate and only ever advances — at most a few steps before
    the window, then one step per due date inside it.
    """
    if window_end < window_start:
        raise ValueError(
            f"window end {window_end} is before window start {window_start}"
        )
    k = _elapsed_intervals(start, n, unit, window_start)
    dues: list[date] = []
    while True:
        occurrence = occurrence_date(start, n, unit, k)
        due = due_date_for(occurrence, unit, due_day, due_month)
        if due < window_start:
            k += 1
            continue
        if due > window_end:
            return dues
        if period_of(occurrence, unit) not in skipped:
            dues.append(due)
        k += 1


def backlog_count(
    start: date,
    n: int,
    unit: str,
    due_day: int | None,
    due_month: int | None,
    today: date,
    paid: set[date],
    skipped: set[Period],
) -> int:
    """The Backlog (issue #58): how many of the cost's Occurrences are
    Unpaid and due `today` or earlier in Europe/Rome — the "N unpaid"
    badge. `paid` is the set of Occurrence dates covered by linked Expenses
    (the stored pins, issue #57): an Occurrence is Unpaid exactly when its
    own date is not in it, so an Occurrence a link covers is never counted
    back in, no matter how the definition (interval, start date) was edited
    since the pin was stored. `skipped` is the set of periods (ADR-0016)
    whose Occurrence the user excused: a Skipped Occurrence never counts,
    and a dormant skip (a period holding no Occurrence) never enters the
    count.

    The override can pull a due date ahead of its Occurrence (the 15th
    occurrence due the 1st) or behind it, so the boundary walk mirrors
    `next_due_date`'s: start at the interval estimate and adjust; due dates
    are strictly increasing in k, so the first k whose due date is beyond
    today ends the count.
    """
    k = _elapsed_intervals(start, n, unit, today)
    while True:
        due = due_date_for(occurrence_date(start, n, unit, k), unit, due_day, due_month)
        if due > today:
            if k == 0:
                return 0
            k -= 1
            continue
        if k == 0 or due_date_for(
            occurrence_date(start, n, unit, k + 1), unit, due_day, due_month
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
