"""Pure recurrence math for Recurring Costs — issue #56.

Occurrences are derived, never stored: start date + k×interval, with days
29–31 clamped to the last day of shorter months (ADR-0010). An Occurrence's
due date is its own date unless the override shifts it (day-of-month for
month intervals, month+day for year intervals). Pure unit tests — no
database, no API seam, like the dates helpers.

The expected dates are hand-worked literals, not recomputed by the same
arithmetic the module performs: 2026 is not a leap year, 2028 is.
"""

from datetime import date
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.recurrence import (
    due_date_for,
    next_due_date,
    occurrence_date,
    rome_day_of,
    rome_today,
)

ROME = ZoneInfo("Europe/Rome")


# --- occurrence_date: start + k×interval -----------------------------------

def test_occurrence_days_step_forward() -> None:
    start = date(2026, 1, 1)
    assert occurrence_date(start, 5, "days", 0) == date(2026, 1, 1)
    assert occurrence_date(start, 5, "days", 1) == date(2026, 1, 6)
    assert occurrence_date(start, 5, "days", 2) == date(2026, 1, 11)
    assert occurrence_date(start, 5, "days", 30) == date(2026, 5, 31)


def test_occurrence_weeks_step_forward() -> None:
    # 2026-01-01 is a Thursday.
    start = date(2026, 1, 1)
    assert occurrence_date(start, 2, "weeks", 1) == date(2026, 1, 15)
    assert occurrence_date(start, 1, "weeks", 3) == date(2026, 1, 22)


def test_occurrence_months_clamp_to_the_last_day_of_shorter_months() -> None:
    # January 31 + 1 month is February 28 in 2026 (not a leap year); the
    # next step preserves the 31st — clamping is per resulting date, not a
    # sticky day carried forward.
    start = date(2026, 1, 31)
    assert occurrence_date(start, 1, "months", 0) == date(2026, 1, 31)
    assert occurrence_date(start, 1, "months", 1) == date(2026, 2, 28)
    assert occurrence_date(start, 1, "months", 2) == date(2026, 3, 31)
    assert occurrence_date(start, 1, "months", 3) == date(2026, 4, 30)


def test_occurrence_months_use_leap_february() -> None:
    start = date(2028, 1, 31)
    assert occurrence_date(start, 1, "months", 1) == date(2028, 2, 29)
    assert occurrence_date(start, 1, "months", 2) == date(2028, 3, 31)


def test_occurrence_months_with_an_interval_larger_than_one() -> None:
    start = date(2026, 1, 31)
    assert occurrence_date(start, 3, "months", 1) == date(2026, 4,30)


def test_occurrence_years_clamp_february_29() -> None:
    start = date(2024, 2, 29)
    assert occurrence_date(start, 1, "years", 0) == date(2024, 2, 29)
    assert occurrence_date(start, 1, "years", 1) == date(2025, 2, 28)
    assert occurrence_date(start, 1, "years", 2) == date(2026, 2, 28)
    assert occurrence_date(start, 1, "years", 4) == date(2028, 2, 29)


def test_occurrence_years_step_forward() -> None:
    start = date(2026, 3, 10)
    assert occurrence_date(start, 2, "years", 1) == date(2028, 3, 10)
    assert occurrence_date(start, 1, "years", 3) == date(2029, 3, 10)


def test_occurrence_rejects_unknown_unit_and_nonpositive_intervals() -> None:
    with pytest.raises(ValueError):
        occurrence_date(date(2026, 1, 1), 1, "fortnights", 1)
    with pytest.raises(ValueError):
        occurrence_date(date(2026, 1, 1), 0, "days", 1)
    with pytest.raises(ValueError):
        occurrence_date(date(2026, 1, 1), -2, "days", 1)


# --- due_date_for: the override shift --------------------------------------

def test_due_without_override_is_the_occurrence_date() -> None:
    occurrence = date(2026, 3, 15)
    assert due_date_for(occurrence, "days", None, None) == occurrence
    assert due_date_for(occurrence, "months", None, None) == occurrence
    assert due_date_for(occurrence, "years", None, None) == occurrence


def test_month_due_day_shifts_within_the_occurrence_month() -> None:
    # The rent example from the spec: the sequence starts on the 15th but is
    # due on the 1st — of the same month, so due can precede the occurrence.
    occurrence = date(2026, 3, 15)
    assert due_date_for(occurrence, "months", 1, None) == date(2026, 3, 1)
    assert due_date_for(occurrence, "months", 28, None) == date(2026, 3, 28)


def test_month_due_day_clamps_to_shorter_months() -> None:
    # A 31st due on February lands on February 28.
    assert due_date_for(date(2026, 2, 20), "months", 31, None) == date(2026, 2, 28)
    # A 31st due on April lands on April 30.
    assert due_date_for(date(2026, 4, 20), "months", 31, None) == date(2026, 4, 30)
    # Leap February keeps the 29th.
    assert due_date_for(date(2028, 2, 20), "months", 29, None) == date(2028, 2, 29)


def test_year_due_month_and_day_shift_within_the_occurrence_year() -> None:
    occurrence = date(2026, 5, 10)
    assert due_date_for(occurrence, "years", 1, 12) == date(2026, 12, 1)
    assert due_date_for(occurrence, "years", 15, 2) == date(2026, 2, 15)


def test_year_due_day_clamps_to_the_due_month() -> None:
    # A Feb 29 due in a non-leap year lands on February 28.
    assert due_date_for(date(2026, 5, 10), "years", 29, 2) == date(2026, 2, 28)
    assert due_date_for(date(2028, 5, 10), "years", 29, 2) == date(2028, 2, 29)


def test_due_rejects_an_override_for_day_and_week_intervals() -> None:
    for unit in ("days", "weeks"):
        with pytest.raises(ValueError):
            due_date_for(date(2026, 3, 15), unit, 1, None)


# --- next_due_date: the first occurrence due today or later ----------------

def test_next_due_for_days_walks_to_the_first_due_not_before_today() -> None:
    start = date(2026, 1, 1)
    # Due today counts as next (the Backlog owns only earlier days).
    assert next_due_date(start, 5, "days", None, None, date(2026, 1, 6)) == date(2026, 1, 6)
    assert next_due_date(start, 5, "days", None, None, date(2026, 1, 7)) == date(2026, 1, 11)
    assert next_due_date(start, 5, "days", None, None, date(2026, 2, 11)) == date(2026, 2, 15)


def test_next_due_with_a_monthly_override() -> None:
    # Sequence from the 15th, due on the 1st: the first day of each month.
    start = date(2026, 3, 15)
    assert next_due_date(start, 1, "months", 1, None, date(2026, 2, 10)) == date(2026, 3, 1)
    assert next_due_date(start, 1, "months", 1, None, date(2026, 3, 1)) == date(2026, 3, 1)
    assert next_due_date(start, 1, "months", 1, None, date(2026, 3, 2)) == date(2026, 4, 1)


def test_next_due_walks_across_clamped_months() -> None:
    # Start on the 31st, due on the 31st: dues are 01-31, 02-28, 03-31, ...
    start = date(2026, 1, 31)
    assert next_due_date(start, 1, "months", 31, None, date(2026, 2, 10)) == date(2026, 2, 28)
    assert next_due_date(start, 1, "months", 31, None, date(2026, 3, 1)) == date(2026, 3, 31)


def test_next_due_for_a_yearly_override() -> None:
    start = date(2026, 5, 10)
    assert (
        next_due_date(start, 1, "years", 1, 12, date(2026, 11, 30)) == date(2026, 12, 1)
    )
    assert (
        next_due_date(start, 1, "years", 1, 12, date(2027, 1, 1)) == date(2027, 12, 1)
    )


def test_next_due_with_an_early_override_skips_a_past_first_due() -> None:
    # A December 31 start due on the 1st: the December due is already behind
    # by mid-December, so the next due is January 1.
    start = date(2026, 12, 31)
    assert next_due_date(start, 1, "months", 1, None, date(2026, 12, 15)) == date(2027, 1, 1)


def test_next_due_before_the_start_is_the_first_occurrence() -> None:
    start = date(2026, 3, 15)
    assert next_due_date(start, 1, "months", None, None, date(2026, 2, 1)) == date(2026, 3, 15)


def test_next_due_rejects_unknown_unit() -> None:
    with pytest.raises(ValueError):
        next_due_date(date(2026, 1, 1), 1, "fortnights", None, None, date(2026, 1, 1))


# --- rome_today -------------------------------------------------------------

def test_rome_today_matches_the_europe_rome_calendar() -> None:
    """Today is derived from the Europe/Rome clock, not the local machine
    timezone (the app's single fixed timezone, CONTEXT.md)."""
    assert rome_today() == datetime.now(ROME).date()


def test_rome_day_of_buckets_a_timestamp_into_rome_days() -> None:
    # 2026-08-31 22:00 UTC is already 2026-09-01 in Europe/Rome.
    assert rome_day_of(datetime(2026, 8, 31, 22, 0, tzinfo=timezone.utc)) == date(2026, 9, 1)
    # 2026-08-31 21:00 UTC is still 2026-08-31 in Europe/Rome.
    assert rome_day_of(datetime(2026, 8, 31, 21, 0, tzinfo=timezone.utc)) == date(2026, 8, 31)
