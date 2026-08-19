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
) -> date:
    """The next due date: the due date of the first Occurrence whose due
    date is `today` or later (an Occurrence due today is not yet a Backlog
    item — CONTEXT.md counts only today and earlier).

    Due dates are strictly increasing in k, so the search starts from the
    interval estimate and walks forward while the due date is still behind
    today, or back when the estimate overshot (the override can only pull a
    due date within its own month/year, so the estimate is off by at most a
    few steps).
    """
    k = _elapsed_intervals(start, n, unit, today)
    while True:
        due = due_date_for(occurrence_date(start, n, unit, k), unit, due_day, due_month)
        if due >= today:
            if k == 0 or (
                due_date_for(occurrence_date(start, n, unit, k - 1), unit, due_day, due_month)
                < today
            ):
                return due
            k -= 1
        else:
            k += 1
