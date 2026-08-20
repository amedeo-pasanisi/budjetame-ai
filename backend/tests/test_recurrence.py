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
    backlog_count,
    due_date_for,
    next_due_date,
    occurrence_date,
    occurrences_in_window,
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


# --- occurrences_in_window: every due date inside a window ----------------

def test_window_walker_days_interval_with_inclusive_edges() -> None:
    # Every 5 days from 2026-01-01: dues are 01-01, 01-06, 01-11, 01-16,
    # 01-21, 01-26, 01-31, 02-05, ... The window keeps the first due on its
    # start edge and the last due on its end edge.
    start = date(2026, 1, 1)
    assert occurrences_in_window(
        start, 5, "days", None, None, date(2026, 1, 6), date(2026, 1, 31)
    ) == [
        date(2026, 1, 6),
        date(2026, 1, 11),
        date(2026, 1, 16),
        date(2026, 1, 21),
        date(2026, 1, 26),
        date(2026, 1, 31),
    ]


def test_window_walker_weeks_interval() -> None:
    # Every 2 weeks from 2026-01-01 (a Thursday): 01-01, 01-15, 01-29,
    # 02-12, ...
    start = date(2026, 1, 1)
    assert occurrences_in_window(
        start, 2, "weeks", None, None, date(2026, 1, 15), date(2026, 2, 12)
    ) == [date(2026, 1, 15), date(2026, 1, 29), date(2026, 2, 12)]


def test_window_walker_months_with_clamping() -> None:
    # Start on the 31st, due on the 31st: February's due clamps to the 28th
    # (2026 is not a leap year), March's is back on the 31st.
    start = date(2026, 1, 31)
    assert occurrences_in_window(
        start, 1, "months", 31, None, date(2026, 2, 1), date(2026, 4, 30)
    ) == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_window_walker_months_with_an_override() -> None:
    # The rent example: occurrences on the 15th, due on the 1st — the
    # window holds each month's first day, including the first occurrence's
    # due ahead of its own date.
    start = date(2026, 3, 15)
    assert occurrences_in_window(
        start, 1, "months", 1, None, date(2026, 3, 1), date(2026, 5, 31)
    ) == [date(2026, 3, 1), date(2026, 4, 1), date(2026, 5, 1)]


def test_window_walker_uses_leap_february() -> None:
    # 2028 is a leap year: February's due keeps the 29th.
    start = date(2028, 1, 31)
    assert occurrences_in_window(
        start, 1, "months", None, None, date(2028, 2, 1), date(2028, 4, 30)
    ) == [date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30)]


def test_window_walker_years_with_an_override() -> None:
    # Occurrences on May 10, due December 1 of the same year: the December
    # window holds that year's due; a window that never crosses a due is
    # empty.
    start = date(2026, 5, 10)
    assert occurrences_in_window(
        start, 1, "years", 1, 12, date(2026, 12, 1), date(2026, 12, 31)
    ) == [date(2026, 12, 1)]
    assert occurrences_in_window(
        start, 1, "years", 1, 12, date(2026, 1, 1), date(2026, 11, 30)
    ) == []


def test_window_walker_before_the_start_is_empty() -> None:
    assert occurrences_in_window(
        date(2026, 3, 15), 1, "months", None, None, date(2026, 1, 1), date(2026, 2, 28)
    ) == []


def test_window_walker_an_early_override_pulls_the_first_due_in() -> None:
    # A December 31 start due on the 1st: the first due precedes the start
    # date itself, so a window over the start month still holds it.
    start = date(2026, 12, 31)
    assert occurrences_in_window(
        start, 1, "months", 1, None, date(2026, 12, 1), date(2026, 12, 31)
    ) == [date(2026, 12, 1)]


def test_window_walker_a_gap_between_dues_is_empty() -> None:
    # Every 5 days from 2026-01-01: no due falls between 01-02 and 01-05.
    assert occurrences_in_window(
        date(2026, 1, 1), 5, "days", None, None, date(2026, 1, 2), date(2026, 1, 5)
    ) == []


def test_window_walker_a_full_month_of_daily_dues() -> None:
    # The Budget's own use: one daily definition inside a whole month
    # window returns every day of the month, strictly increasing.
    start = date(2026, 1, 1)
    dues = occurrences_in_window(
        start, 1, "days", None, None, date(2026, 1, 1), date(2026, 1, 31)
    )
    assert len(dues) == 31
    assert dues[0] == date(2026, 1, 1)
    assert dues[-1] == date(2026, 1, 31)
    assert all(a < b for a, b in zip(dues, dues[1:]))


def test_window_walker_rejects_a_reversed_window() -> None:
    with pytest.raises(ValueError):
        occurrences_in_window(
            date(2026, 1, 1), 1, "days", None, None, date(2026, 2, 1), date(2026, 1, 1)
        )


# --- backlog_count: Unpaid Occurrences due today or earlier ---------------

def test_backlog_counts_unpaid_occurrences_due_today_or_earlier() -> None:
    # A daily cost starting 2026-01-01, judged on 2026-01-10: the first ten
    # Occurrences (1st..10th) are due on or before today — the "10 unpaid"
    # badge of a daily cost missed for ten days.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    assert backlog_count(start, 1, "days", None, None, today, set()) == 10


def test_backlog_skips_occurrences_covered_by_a_pin() -> None:
    # The paid set is the stored Occurrence pins (issue #57): an Occurrence
    # in it is never counted, even when its due date has passed. Paying the
    # oldest two drops the badge 10 -> 8.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    paid = {occurrence_date(start, 1, "days", k) for k in (0, 2)}
    assert backlog_count(start, 1, "days", None, None, today, paid) == 8
    # An Occurrence outside the derived sequence (e.g. after an interval
    # edit reshaped it) simply never enters the count: it stays covered by
    # its link, but it is not an Occurrence of the current definition.
    paid_elsewhere = {date(2025, 12, 1)}
    assert backlog_count(start, 1, "days", None, None, today, paid_elsewhere) == 10


def test_backlog_counts_today_but_never_future_occurrences() -> None:
    # Due today counts (CONTEXT.md: "today or earlier"); due tomorrow never
    # does — future Occurrences appear as the next due date instead.
    today = date(2026, 1, 10)
    assert backlog_count(date(2026, 1, 10), 1, "days", None, None, today, set()) == 1
    assert backlog_count(date(2026, 1, 11), 1, "days", None, None, today, set()) == 0


def test_backlog_with_a_monthly_override_judges_the_due_date() -> None:
    # The rent example: Occurrences on the 15th, due on the 1st. Judged on
    # 2026-01-10, the October, November, December, and January Occurrences
    # are all due on or before today — the January one is due the 1st, ahead
    # of its own date (the override is the point).
    today = date(2026, 1, 10)
    start = date(2025, 10, 15)
    assert backlog_count(start, 1, "months", 1, None, today, set()) == 4
    # Paying the oldest two (October and November Occurrences) leaves two.
    paid = {
        occurrence_date(start, 1, "months", 0),
        occurrence_date(start, 1, "months", 1),
    }
    assert backlog_count(start, 1, "months", 1, None, today, paid) == 2


def test_backlog_with_a_yearly_override() -> None:
    # Occurrences on May 10, due December 1: judged on 2026-05-01 the 2023,
    # 2024, and 2025 Occurrences are due; judged on 2026-12-01 the 2026 one
    # joins (due today counts).
    start = date(2023, 5, 10)
    assert backlog_count(start, 1, "years", 1, 12, date(2026, 5, 1), set()) == 3
    assert backlog_count(start, 1, "years", 1, 12, date(2026, 12, 1), set()) == 4


def test_backlog_walks_across_clamped_months() -> None:
    # Every 3 months from 2025-04-30: 2025-04-30, 2025-07-30, 2025-10-30,
    # 2026-01-30, ... Judged on 2026-01-10 the first three are due.
    start = date(2025, 4, 30)
    assert backlog_count(start, 3, "months", None, None, date(2026, 1, 10), set()) == 3


def test_backlog_before_the_start_is_zero() -> None:
    assert backlog_count(date(2026, 3, 15), 1, "months", None, None, date(2026, 2, 1), set()) == 0


def test_backlog_rejects_unknown_unit() -> None:
    with pytest.raises(ValueError):
        backlog_count(date(2026, 1, 1), 1, "fortnights", None, None, date(2026, 1, 1), set())


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
