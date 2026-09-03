"""Pure recurrence math for Recurring Costs — issue #56.

Occurrences are derived, never stored: start date + k×interval, with days
29–31 clamped to the last day of shorter months (ADR-0010). An Occurrence's
due date is its own date (ADR-0024): the due-date override is gone, and the
definition's only date is the start date. Pure unit tests — no database, no
API seam, like the dates helpers.

The expected dates are hand-worked literals, not recomputed by the same
arithmetic the module performs: 2026 is not a leap year, 2028 is.
"""

from datetime import date
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.recurrence import (
    backlog_count,
    next_due_date,
    occurrence_date,
    occurrences_in_window,
    period_of,
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


# --- next_due_date: the first occurrence on or after today -----------------

def test_next_due_for_days_walks_to_the_first_due_not_before_today() -> None:
    start = date(2026, 1, 1)
    # Due today counts as next (the Backlog owns only earlier days).
    assert next_due_date(start, 5, "days", date(2026, 1, 6), set()) == date(2026, 1, 6)
    assert next_due_date(start, 5, "days", date(2026, 1, 7), set()) == date(2026, 1, 11)
    assert next_due_date(start, 5, "days", date(2026, 2, 11), set()) == date(2026, 2, 15)


def test_next_due_walks_across_clamped_months() -> None:
    # Start on the 31st: dues are 01-31, 02-28, 03-31, ... — February's is
    # the 28th (2026 is not a leap year), then back on the 31st.
    start = date(2026, 1, 31)
    assert next_due_date(start, 1, "months", date(2026, 2, 10), set()) == date(2026, 2, 28)
    assert next_due_date(start, 1, "months", date(2026, 3, 1), set()) == date(2026, 3, 31)


def test_next_due_before_the_start_is_the_first_occurrence() -> None:
    start = date(2026, 3, 15)
    assert next_due_date(start, 1, "months", date(2026, 2, 1), set()) == date(2026, 3, 15)


def test_next_due_rejects_unknown_unit() -> None:
    with pytest.raises(ValueError):
        next_due_date(date(2026, 1, 1), 1, "fortnights", date(2026, 1, 1), set())


# --- occurrences_in_window: every occurrence inside a window ---------------

def test_window_walker_days_interval_with_inclusive_edges() -> None:
    # Every 5 days from 2026-01-01: occurrences are 01-01, 01-06, 01-11,
    # 01-16, 01-21, 01-26, 01-31, 02-05, ... The window keeps the first
    # occurrence on its start edge and the last on its end edge.
    start = date(2026, 1, 1)
    assert occurrences_in_window(
        start, 5, "days", date(2026, 1, 6), date(2026, 1, 31), set()
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
        start, 2, "weeks", date(2026, 1, 15), date(2026, 2, 12), set()
    ) == [date(2026, 1, 15), date(2026, 1, 29), date(2026, 2, 12)]


def test_window_walker_months_with_clamping() -> None:
    # Start on the 31st: February's occurrence clamps to the 28th (2026 is
    # not a leap year), March's is back on the 31st.
    start = date(2026, 1, 31)
    assert occurrences_in_window(
        start, 1, "months", date(2026, 2, 1), date(2026, 4, 30), set()
    ) == [date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_window_walker_uses_leap_february() -> None:
    # 2028 is a leap year: February's occurrence keeps the 29th.
    start = date(2028, 1, 31)
    assert occurrences_in_window(
        start, 1, "months", date(2028, 2, 1), date(2028, 4, 30), set()
    ) == [date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30)]


def test_window_walker_years_step_forward() -> None:
    # Every year from 2026-05-10: a window that holds that year's occurrence
    # keeps it; a window that never crosses one is empty.
    start = date(2026, 5, 10)
    assert occurrences_in_window(
        start, 1, "years", date(2026, 5, 10), date(2026, 12, 31), set()
    ) == [date(2026, 5, 10)]
    assert occurrences_in_window(
        start, 1, "years", date(2026, 1, 1), date(2026, 5, 9), set()
    ) == []


def test_window_walker_before_the_start_is_empty() -> None:
    assert occurrences_in_window(
        date(2026, 3, 15), 1, "months", date(2026, 1, 1), date(2026, 2, 28), set()
    ) == []


def test_window_walker_a_gap_between_occurrences_is_empty() -> None:
    # Every 5 days from 2026-01-01: no occurrence falls between 01-02 and
    # 01-05.
    assert occurrences_in_window(
        date(2026, 1, 1), 5, "days", date(2026, 1, 2), date(2026, 1, 5), set()
    ) == []


def test_window_walker_a_full_month_of_daily_occurrences() -> None:
    # The Budget's own use: one daily definition inside a whole month
    # window returns every day of the month, strictly increasing.
    start = date(2026, 1, 1)
    dues = occurrences_in_window(
        start, 1, "days", date(2026, 1, 1), date(2026, 1, 31), set()
    )
    assert len(dues) == 31
    assert dues[0] == date(2026, 1, 1)
    assert dues[-1] == date(2026, 1, 31)
    assert all(a < b for a, b in zip(dues, dues[1:]))


def test_window_walker_rejects_a_reversed_window() -> None:
    with pytest.raises(ValueError):
        occurrences_in_window(
            date(2026, 1, 1), 1, "days", date(2026, 2, 1), date(2026, 1, 1),
            set()
        )


# --- backlog_count: Unpaid Occurrences due today or earlier ---------------

def test_backlog_counts_unpaid_occurrences_due_today_or_earlier() -> None:
    # A daily cost starting 2026-01-01, judged on 2026-01-10: the first ten
    # Occurrences (1st..10th) are due on or before today — the "10 unpaid"
    # badge of a daily cost missed for ten days.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    assert backlog_count(start, 1, "days", today, set(), set()) == 10


def test_backlog_skips_occurrences_covered_by_a_pin() -> None:
    # The paid set is the stored Occurrence pins (issue #57): an Occurrence
    # in it is never counted, even when its due date has passed. Paying the
    # oldest two drops the badge 10 -> 8.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    paid = {occurrence_date(start, 1, "days", k) for k in (0, 2)}
    assert backlog_count(start, 1, "days", today, paid, set()) == 8
    # An Occurrence outside the derived sequence (e.g. after an interval
    # edit reshaped it) simply never enters the count: it stays covered by
    # its link, but it is not an Occurrence of the current definition.
    paid_elsewhere = {date(2025, 12, 1)}
    assert backlog_count(start, 1, "days", today, paid_elsewhere, set()) == 10


def test_backlog_counts_today_but_never_future_occurrences() -> None:
    # Due today counts (CONTEXT.md: "today or earlier"); due tomorrow never
    # does — future Occurrences appear as the next due date instead.
    today = date(2026, 1, 10)
    assert backlog_count(date(2026, 1, 10), 1, "days", today, set(), set()) == 1
    assert backlog_count(date(2026, 1, 11), 1, "days", today, set(), set()) == 0


def test_backlog_judges_months_by_their_own_dates() -> None:
    # Every month from 2025-10-15, judged on 2026-01-10: October, November,
    # and December Occurrences are due on or before today; January's is
    # still ahead. Paying the oldest two leaves one.
    today = date(2026, 1, 10)
    start = date(2025, 10, 15)
    assert backlog_count(start, 1, "months", today, set(), set()) == 3
    paid = {
        occurrence_date(start, 1, "months", 0),
        occurrence_date(start, 1, "months", 1),
    }
    assert backlog_count(start, 1, "months", today, paid, set()) == 1


def test_backlog_judges_years_by_their_own_dates() -> None:
    # Every year from 2023-05-10: judged on 2026-05-01 the 2023, 2024, and
    # 2025 Occurrences are due; judged on 2026-05-10 the 2026 one joins
    # (due today counts).
    start = date(2023, 5, 10)
    assert backlog_count(start, 1, "years", date(2026, 5, 1), set(), set()) == 3
    assert backlog_count(start, 1, "years", date(2026, 5, 10), set(), set()) == 4


def test_backlog_walks_across_clamped_months() -> None:
    # Every 3 months from 2025-04-30: 2025-04-30, 2025-07-30, 2025-10-30,
    # 2026-01-30, ... Judged on 2026-01-10 the first three are due.
    start = date(2025, 4, 30)
    assert backlog_count(start, 3, "months", date(2026, 1, 10), set(), set()) == 3


def test_backlog_before_the_start_is_zero() -> None:
    assert backlog_count(date(2026, 3, 15), 1, "months", date(2026, 2, 1), set(), set()) == 0


def test_backlog_rejects_unknown_unit() -> None:
    with pytest.raises(ValueError):
        backlog_count(date(2026, 1, 1), 1, "fortnights", date(2026, 1, 1), set(), set())


# --- period_of: the skip anchor (ADR-0016) ---------------------------------

def test_period_of_is_the_date_for_day_and_week_intervals() -> None:
    assert period_of(date(2026, 7, 15), "days") == date(2026, 7, 15)
    assert period_of(date(2026, 7, 15), "weeks") == date(2026, 7, 15)


def test_period_of_is_the_month_for_month_intervals() -> None:
    assert period_of(date(2026, 7, 15), "months") == (2026, 7)


def test_period_of_is_the_year_for_year_intervals() -> None:
    assert period_of(date(2026, 7, 15), "years") == 2026


def test_period_of_rejects_unknown_unit() -> None:
    with pytest.raises(ValueError):
        period_of(date(2026, 7, 15), "fortnights")


# --- next_due_date walks past Skipped Occurrences (ADR-0016) --------------

def test_next_due_walks_past_a_skipped_occurrence() -> None:
    # Every 5 days from 2026-01-01: skipping the 01-06 Occurrence pushes the
    # next due to 01-11 — a skipped Occurrence is not due.
    start = date(2026, 1, 1)
    skipped = {period_of(date(2026, 1, 6), "days")}
    assert (
        next_due_date(start, 5, "days", date(2026, 1, 6), skipped)
        == date(2026, 1, 11)
    )


def test_next_due_walks_past_a_skipped_month() -> None:
    # Every month from 2026-03-15: skipping March's Occurrence pushes the
    # next due from 03-15 to 04-15.
    start = date(2026, 3, 15)
    skipped = {(2026, 3)}
    assert (
        next_due_date(start, 1, "months", date(2026, 2, 10), skipped)
        == date(2026, 4, 15)
    )


def test_next_due_ignores_a_dormant_skip() -> None:
    # A skip whose period holds no Occurrence of the current sequence (e.g.
    # after a definition edit reshaped it) lies dormant: it never blocks the
    # next due.
    start = date(2026, 1, 1)
    skipped = {period_of(date(2025, 6, 1), "days")}
    assert (
        next_due_date(start, 5, "days", date(2026, 1, 6), skipped)
        == date(2026, 1, 6)
    )


# --- occurrences_in_window drops Skipped Occurrences (ADR-0016) ------------

def test_window_walker_drops_a_skipped_occurrence() -> None:
    # Every 5 days from 2026-01-01: skipping 01-11 leaves 01-06 and 01-16 in
    # the window.
    start = date(2026, 1, 1)
    skipped = {period_of(date(2026, 1, 11), "days")}
    assert occurrences_in_window(
        start,
        5,
        "days",
        date(2026, 1, 6),
        date(2026, 1, 16),
        skipped,
    ) == [date(2026, 1, 6), date(2026, 1, 16)]


def test_window_walker_judges_a_month_skip_by_period() -> None:
    # The Budget's use: a monthly definition whose April Occurrence is
    # skipped — the skip travels with the month, whatever the Occurrence's
    # own date.
    start = date(2026, 3, 15)
    skipped = {(2026, 4)}
    assert occurrences_in_window(
        start,
        1,
        "months",
        date(2026, 3, 1),
        date(2026, 5, 31),
        skipped,
    ) == [date(2026, 3, 15), date(2026, 5, 15)]


# --- backlog_count never counts a Skipped Occurrence (ADR-0016) ------------

def test_backlog_never_counts_a_skipped_occurrence() -> None:
    # A daily cost missed for ten days: skipping the oldest three excuses
    # them — the badge drops 10 -> 7.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    skipped = {
        period_of(occurrence_date(start, 1, "days", k), "days") for k in (0, 1, 2)
    }
    assert backlog_count(start, 1, "days", today, set(), skipped) == 7


def test_backlog_mixes_paid_and_skipped() -> None:
    # Paid and Skipped are independent: the 1st is covered by a link, the
    # 2nd is skipped — both leave the badge.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    paid = {occurrence_date(start, 1, "days", 0)}
    skipped = {period_of(occurrence_date(start, 1, "days", 1), "days")}
    assert backlog_count(start, 1, "days", today, paid, skipped) == 8


def test_backlog_a_skipped_month_never_counts() -> None:
    # Every month from 2025-10-15, judged on 2026-01-10: three Occurrences
    # are due (October, November, December); skipping October's drops the
    # badge to 2.
    today = date(2026, 1, 10)
    start = date(2025, 10, 15)
    skipped = {period_of(start, "months")}  # (2025, 10)
    assert backlog_count(start, 1, "months", today, set(), skipped) == 2


def test_backlog_ignores_a_dormant_skip() -> None:
    # A skip whose period holds no Occurrence never enters the count — like
    # a pin whose date no longer matches the derived sequence.
    today = date(2026, 1, 10)
    start = date(2026, 1, 1)
    skipped = {period_of(date(2025, 12, 1), "days")}
    assert backlog_count(start, 1, "days", today, set(), skipped) == 10


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
