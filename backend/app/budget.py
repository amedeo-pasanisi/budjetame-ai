"""Pure Budget arithmetic for the Dashboard card — issue #64.

The Budget (CONTEXT.md) is fully derived, never stored: the service layer
sums the month's Recurring Income and Recurring Cost Occurrences into a
Monthly Spendable, and everything else is arithmetic on that one Decimal
and the calendar. The Daily Allowance divides it by the days of the month
and floors to the cent; the leftover remainder lands on the last day of the
month, so the month always sums exactly back to the Monthly Spendable and
every figure is reproducible by hand (ADR-0012: 500 € in April is 16,66
€/day, so three daily amounts are exactly 49,98 €). A Monthly Spendable of
0 or less floors the Daily Allowance at 0, so the card never suggests
spending a negative amount (issue #63, story 14).

No I/O, no database: everything here works on `Decimal` and `date` values,
so the arithmetic is unit-tested directly like the recurrence and dates
helpers. The service layer wires stored definitions and Transactions into
these functions.
"""

import calendar
from datetime import date
from decimal import ROUND_DOWN, Decimal

from app.dates import Month

_CENT = Decimal("0.01")


def _days_in(month: Month) -> int:
    """The number of days in the month (28, 29, 30, or 31)."""
    return calendar.monthrange(month.year, month.month)[1]


def daily_allowance(monthly_spendable: Decimal, month: Month) -> Decimal:
    """The month's Daily Allowance: Monthly Spendable ÷ the days of the
    month, floored to the cent (500 € in a 30-day month → 16,66 €). A
    Monthly Spendable of 0 or less floors at 0. The per-day amounts plus
    `last_day_remainder` always sum exactly back to the Monthly Spendable
    (ADR-0012)."""
    if monthly_spendable <= 0:
        return Decimal("0.00")
    return (monthly_spendable / Decimal(_days_in(month))).quantize(
        _CENT, rounding=ROUND_DOWN
    )


def last_day_remainder(monthly_spendable: Decimal, month: Month) -> Decimal:
    """The leftover cents after the Daily Allowance is paid out: Monthly
    Spendable − days × Daily Allowance, always ≥ 0, landing on the last day
    of the month only, so the month still sums exactly to the Monthly
    Spendable (ADR-0012). 0 when the Monthly Spendable divides evenly or is
    0 or less."""
    if monthly_spendable <= 0:
        return Decimal("0.00")
    return monthly_spendable - daily_allowance(monthly_spendable, month) * _days_in(month)


def accrued_allowance(monthly_spendable: Decimal, month: Month, today: date) -> Decimal:
    """The allowance accrued from the 1st through `today`, today included:
    one Daily Allowance per calendar day, plus the last-day remainder when
    `today` is the month's last day. `today` must be a day of `month`."""
    if (today.year, today.month) != (month.year, month.month):
        raise ValueError(f"{today} is not in {month.iso}")
    accrued = daily_allowance(monthly_spendable, month) * today.day
    if today.day == _days_in(month):
        accrued += last_day_remainder(monthly_spendable, month)
    return accrued


def spendable_today(
    monthly_spendable: Decimal, month: Month, today: date, spent: Decimal
) -> Decimal:
    """Spendable Today: the allowance accrued from the 1st through `today`
    minus the Discretionary Expenses dated in that span. May go negative —
    future accruals repay the debt, and the card shows 0 until then (issue
    #63, story 12)."""
    return accrued_allowance(monthly_spendable, month, today) - spent
