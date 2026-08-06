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
