"""The app's single fixed timezone and its day-boundary conversions.

Transaction dates are stored as UTC timestamps, but the calendar day a user
picks is a day in Europe/Rome — the app's one fixed timezone (CONTEXT.md).
The API therefore exchanges dates as \"YYYY-MM-DD\" meaning the calendar day in
Europe/Rome, and converts at this boundary. Months and years for reporting
bucket in Europe/Rome too, so a stored timestamp always lands on the same
calendar day the user chose.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")


def from_rome_day(day: str) -> datetime:
    """Midnight of the given Europe/Rome calendar day, as a UTC timestamp."""
    naive = datetime.strptime(day, "%Y-%m-%d")
    return naive.replace(tzinfo=ROME).astimezone(timezone.utc)


def to_rome_day(timestamp: datetime) -> str:
    """The Europe/Rome calendar day containing the given UTC timestamp."""
    return timestamp.astimezone(ROME).strftime("%Y-%m-%d")


def current_rome_month() -> str:
    """The calendar month in Europe/Rome right now, as "YYYY-MM"."""
    return datetime.now(ROME).strftime("%Y-%m")


def rome_month_bounds(month: str) -> tuple[datetime, datetime]:
    """The UTC instants for the start of `month` ("YYYY-MM") and the start of
    the following month, so reporting can bucket a Europe/Rome month
    (CONTEXT.md). The upper bound is exclusive: a Transaction on the first day
    of the next month never lands in `month`."""
    year, m = (int(part) for part in month.split("-"))
    start = from_rome_day(f"{year:04d}-{m:02d}-01")
    if m == 12:
        next_start = from_rome_day(f"{year + 1:04d}-01-01")
    else:
        next_start = from_rome_day(f"{year:04d}-{m + 1:02d}-01")
    return start, next_start
