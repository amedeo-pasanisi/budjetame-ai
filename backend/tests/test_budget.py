"""Pure Budget arithmetic — issue #64.

The Budget (CONTEXT.md) is fully derived, never stored: the service layer
sums a month's Recurring Income and Recurring Cost Occurrences into the
Monthly Spendable, and this module turns that one number into the Daily
Allowance (floored to the cent, the leftover remainder landing on the last
day — ADR-0012), the per-day accrual, and Spendable Today. Pure unit tests
— no database, no API seam, like the recurrence and dates helpers.

The expected values are hand-worked literals, not recomputed by the same
arithmetic the module performs: 2026 is not a leap year, 2028 is. 500 € in
April is the spec's worked example — 16,66 €/day (500 ÷ 30 = 16,666…,
floored to the cent — ADR-0012), so three daily amounts sum exactly to
49,98 € and spending that on day 1 leaves days 2 and 3 at exactly 0.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.budget import (
    accrued_allowance,
    daily_allowance,
    last_day_remainder,
    spendable_today,
)
from app.dates import Month

FEBRUARY = Month(2026, 2)  # 28 days, not a leap year
LEAP_FEBRUARY = Month(2028, 2)  # 29 days
APRIL = Month(2026, 4)  # 30 days
MARCH = Month(2026, 3)  # 31 days


# --- daily_allowance: Monthly Spendable ÷ days, floored to the cent --------

def test_daily_allowance_floors_to_the_cent() -> None:
    # 500 € in a 30-day April: 16,666… €/day floors to 16,66 € — the spec's
    # worked example, so three daily amounts are exactly 49,98 €.
    assert daily_allowance(Decimal("500"), APRIL) == Decimal("16.66")


def test_daily_allowance_divides_by_the_actual_days_of_the_month() -> None:
    # 28, 29 (leap February), 30, and 31 days each get their own rate.
    assert daily_allowance(Decimal("500"), FEBRUARY) == Decimal("17.85")
    assert daily_allowance(Decimal("500"), LEAP_FEBRUARY) == Decimal("17.24")
    assert daily_allowance(Decimal("500"), APRIL) == Decimal("16.66")
    assert daily_allowance(Decimal("500"), MARCH) == Decimal("16.12")


def test_daily_allowance_an_exact_division_keeps_the_cents() -> None:
    assert daily_allowance(Decimal("300"), APRIL) == Decimal("10.00")


def test_daily_allowance_under_a_cent_per_day_still_floors_to_cents() -> None:
    # 1 € over 31 days: 0,032… €/day floors to 0,03 €.
    assert daily_allowance(Decimal("1"), MARCH) == Decimal("0.03")


def test_daily_allowance_of_a_nonpositive_monthly_spendable_floors_at_zero() -> None:
    # Issue #63, story 14: a month whose costs exceed its incomes never
    # suggests spending a negative amount.
    assert daily_allowance(Decimal("0"), APRIL) == Decimal("0.00")
    assert daily_allowance(Decimal("-25.50"), APRIL) == Decimal("0.00")


# --- last_day_remainder: the leftover lands on the last day ----------------

def test_last_day_remainder_is_the_leftover_after_the_floor() -> None:
    # 500 € in April: 30 × 16,66 = 499,80 €, so 0,20 € lands on the last
    # day; February's 17,85 × 28 leaves the same 0,20 €.
    assert last_day_remainder(Decimal("500"), APRIL) == Decimal("0.20")
    assert last_day_remainder(Decimal("500"), FEBRUARY) == Decimal("0.20")
    assert last_day_remainder(Decimal("500"), LEAP_FEBRUARY) == Decimal("0.04")
    assert last_day_remainder(Decimal("500"), MARCH) == Decimal("0.28")


def test_last_day_remainder_is_zero_when_the_month_divides_evenly() -> None:
    assert last_day_remainder(Decimal("300"), APRIL) == Decimal("0.00")


def test_last_day_remainder_of_a_nonpositive_monthly_spendable_is_zero() -> None:
    assert last_day_remainder(Decimal("0"), APRIL) == Decimal("0.00")
    assert last_day_remainder(Decimal("-25.50"), APRIL) == Decimal("0.00")


@pytest.mark.parametrize(
    "month, days",
    [
        (FEBRUARY, 28),
        (LEAP_FEBRUARY, 29),
        (APRIL, 30),
        (MARCH, 31),
    ],
)
def test_the_month_sums_exactly_back_to_the_monthly_spendable(
    month: Month, days: int
) -> None:
    # ADR-0012: per-day amounts plus the last-day remainder always sum
    # exactly to the Monthly Spendable — no cent is ever lost or invented.
    spendable = Decimal("500")
    assert (
        daily_allowance(spendable, month) * days + last_day_remainder(spendable, month)
        == spendable
    )


# --- accrued_allowance: one Daily Allowance per calendar day ---------------

def test_accrual_grows_one_daily_allowance_per_day() -> None:
    # 500 € in April: 16,66 €/day — the spec's example: three days accrue
    # exactly 49,98 €, the whole month sums to 500,00 €.
    assert accrued_allowance(Decimal("500"), APRIL, date(2026, 4, 1)) == Decimal("16.66")
    assert accrued_allowance(Decimal("500"), APRIL, date(2026, 4, 3)) == Decimal("49.98")
    assert accrued_allowance(Decimal("500"), APRIL, date(2026, 4, 29)) == Decimal("483.14")
    assert accrued_allowance(Decimal("500"), APRIL, date(2026, 4, 30)) == Decimal("500.00")


def test_accrual_on_the_last_day_includes_the_remainder_only_there() -> None:
    # Leap February 2028 has 29 days: the 28th holds 28 plain allowances,
    # the 29th adds the 0,04 € remainder — and sums to the full 500,00 €.
    assert (
        accrued_allowance(Decimal("500"), LEAP_FEBRUARY, date(2028, 2, 27))
        == Decimal("465.48")
    )
    assert (
        accrued_allowance(Decimal("500"), LEAP_FEBRUARY, date(2028, 2, 28))
        == Decimal("482.72")
    )
    assert (
        accrued_allowance(Decimal("500"), LEAP_FEBRUARY, date(2028, 2, 29))
        == Decimal("500.00")
    )


def test_accrual_of_a_nonpositive_monthly_spendable_is_zero() -> None:
    assert accrued_allowance(Decimal("0"), APRIL, date(2026, 4, 15)) == Decimal("0.00")
    assert accrued_allowance(Decimal("-25.50"), APRIL, date(2026, 4, 15)) == Decimal("0.00")


def test_accrual_rejects_a_day_outside_the_month() -> None:
    with pytest.raises(ValueError):
        accrued_allowance(Decimal("500"), APRIL, date(2026, 5, 1))
    with pytest.raises(ValueError):
        accrued_allowance(Decimal("500"), APRIL, date(2026, 3, 31))


# --- spendable_today: accrued minus discretionary spent ---------------------

def test_spendable_today_is_accrued_minus_spent() -> None:
    assert (
        spendable_today(Decimal("500"), APRIL, date(2026, 4, 3), Decimal("10.00"))
        == Decimal("39.98")
    )


def test_spendable_today_may_go_negative() -> None:
    # The spec's April example: spending three days' worth (49,98 €) on day
    # 1 leaves day 2 at −16,66 € (shown as 0 until the accrual repays it)
    # and day 3 at exactly 0,00 € — the floor-to-cent rounding is what
    # makes the day-3 figure come out exact (ADR-0012).
    assert (
        spendable_today(Decimal("500"), APRIL, date(2026, 4, 1), Decimal("49.98"))
        == Decimal("-33.32")
    )
    assert (
        spendable_today(Decimal("500"), APRIL, date(2026, 4, 2), Decimal("49.98"))
        == Decimal("-16.66")
    )
    assert (
        spendable_today(Decimal("500"), APRIL, date(2026, 4, 3), Decimal("49.98"))
        == Decimal("0.00")
    )


def test_spendable_today_with_nothing_spent_is_the_accrual() -> None:
    assert spendable_today(Decimal("500"), APRIL, date(2026, 4, 30), Decimal("0")) == Decimal(
        "500.00"
    )
    assert spendable_today(Decimal("500"), APRIL, date(2026, 4, 3), Decimal("0")) == Decimal(
        "49.98"
    )
