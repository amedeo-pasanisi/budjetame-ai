"""The app's single fixed timezone and its day-boundary conversions.

Transaction dates are stored as UTC timestamps, but the calendar day a user
picks is a day in Europe/Rome — the app's one fixed timezone (CONTEXT.md).
The API therefore exchanges dates as "YYYY-MM-DD" meaning the calendar day in
Europe/Rome, and converts at this boundary. Months and years for reporting
bucket in Europe/Rome too, so a stored timestamp always lands on the same
calendar day the user chose.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROME = ZoneInfo("Europe/Rome")

# What <input type="month"> sends and the dashboard echoes back (US27).
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@dataclass(frozen=True, slots=True)
class Month:
    """A calendar month in Europe/Rome, exchanged as "YYYY-MM" (CONTEXT.md).

    The one definition of month handling — parse, validate, format, compare
    and step — instead of ad-hoc string splitting and formatting at each use
    site (issue #16).
    """

    year: int
    month: int

    @classmethod
    def parse(cls, value: str) -> "Month":
        """The month the "YYYY-MM" string names. Anything else — a day, a
        non-zero-padded month, a nonsense string — is a ValueError: invalid
        shapes are rejected at parse, never silently formatted."""
        if not isinstance(value, str) or _MONTH_PATTERN.fullmatch(value) is None:
            raise ValueError(f"not a YYYY-MM month: {value!r}")
        year, month = (int(part) for part in value.split("-"))
        return cls(year, month)

    @classmethod
    def current(cls) -> "Month":
        """The calendar month in Europe/Rome right now."""
        return cls.parse(datetime.now(ROME).strftime("%Y-%m"))

    @property
    def iso(self) -> str:
        """The month as a zero-padded "YYYY-MM" string."""
        return f"{self.year:04d}-{self.month:02d}"

    def next(self) -> "Month":
        """The following calendar month."""
        if self.month == 12:
            return Month(self.year + 1, 1)
        return Month(self.year, self.month + 1)

    def __lt__(self, other: "Month") -> bool:
        return (self.year, self.month) < (other.year, other.month)

    def __le__(self, other: "Month") -> bool:
        return (self.year, self.month) <= (other.year, other.month)

    def __str__(self) -> str:
        return self.iso


def from_rome_day(day: str) -> datetime:
    """Midnight of the given Europe/Rome calendar day, as a UTC timestamp."""
    naive = datetime.strptime(day, "%Y-%m-%d")
    return naive.replace(tzinfo=ROME).astimezone(timezone.utc)


def to_rome_day(timestamp: datetime) -> str:
    """The Europe/Rome calendar day containing the given UTC timestamp."""
    return timestamp.astimezone(ROME).strftime("%Y-%m-%d")


def to_rome_month(timestamp: datetime) -> Month:
    """The Europe/Rome calendar month containing the given UTC timestamp."""
    return Month.parse(to_rome_day(timestamp)[:7])


def rome_month_bounds(month: Month) -> tuple[datetime, datetime]:
    """The UTC instants for the start of `month` and the start of the
    following month, so reporting can bucket a Europe/Rome month (CONTEXT.md).
    The upper bound is exclusive: a Transaction on the first day of the next
    month never lands in `month`."""
    start = from_rome_day(f"{month.iso}-01")
    next_month = month.next()
    next_start = from_rome_day(f"{next_month.iso}-01")
    return start, next_start
