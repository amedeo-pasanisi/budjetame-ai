"""Month value type — issue #16.

The dashboard threads "YYYY-MM" month strings around as bare strings; this
test pins the small value type that replaces them: parse, validate, format,
compare and derive once, in the Europe/Rome boundary module (app.dates.py).
Pure unit tests — no database, no API seam: the value type has no I/O.
"""

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.dates import Month, rome_month_bounds, to_rome_month

ROME = ZoneInfo("Europe/Rome")


def test_parse_accepts_zero_padded_months() -> None:
    assert Month.parse("2026-01") == Month(2026, 1)
    assert Month.parse("2026-12") == Month(2026, 12)
    assert Month.parse("1900-01") == Month(1900, 1)
    assert Month.parse("9999-12") == Month(9999, 12)


@pytest.mark.parametrize(
    "value",
    [
        "banana",
        "2026-13",
        "2026-00",
        "2026-8",  # not zero-padded
        "2026-1",
        "2026-08-01",  # a day, not a month
        "2026/08",
        "2026_08",
        "",
        " 2026-08",
        "2026-08 ",
        None,
        202608,
    ],
)
def test_parse_rejects_invalid_shapes(value: object) -> None:
    """Invalid month shapes are rejected at parse, never silently formatted
    (issue #16 acceptance criterion)."""
    with pytest.raises(ValueError):
        Month.parse(value)  # type: ignore[arg-type]


def test_iso_formats_zero_padded() -> None:
    assert Month(2026, 8).iso == "2026-08"
    assert Month(2026, 1).iso == "2026-01"
    assert str(Month(2026, 8)) == "2026-08"


def test_equality_and_hash() -> None:
    assert Month(2026, 8) == Month(2026, 8)
    assert Month(2026, 8) != Month(2026, 7)
    assert Month(2026, 8) != Month(2025, 8)
    # Hashable, so it can key a totals dict or a set of months.
    assert len({Month(2026, 8), Month(2026, 8), Month(2026, 7)}) == 2


def test_ordering() -> None:
    assert Month(2026, 8) < Month(2026, 9)
    assert Month(2026, 12) < Month(2027, 1)
    assert Month(2026, 12) <= Month(2026, 12)
    assert Month(2026, 8) > Month(2026, 7)
    assert Month(2027, 1) >= Month(2026, 12)


def test_next_rolls_the_year() -> None:
    assert Month(2026, 12).next() == Month(2027, 1)
    assert Month(2026, 1).next() == Month(2026, 2)


def test_current_matches_the_europe_rome_calendar() -> None:
    """The current month is derived from the Europe/Rome clock, not the local
    machine timezone: on the first day of a month this must already be the new
    month, and late on the last day still the old one."""
    now = datetime.now(ROME)
    assert Month.current() == Month(now.year, now.month)


def test_rome_month_bounds_take_a_month() -> None:
    start, next_start = rome_month_bounds(Month(2026, 8))
    assert start == datetime(2026, 8, 1, tzinfo=ROME).astimezone(timezone.utc)
    assert next_start == datetime(2026, 9, 1, tzinfo=ROME).astimezone(timezone.utc)


def test_rome_month_bounds_december_rolls_the_year() -> None:
    start, next_start = rome_month_bounds(Month(2026, 12))
    assert next_start == datetime(2027, 1, 1, tzinfo=ROME).astimezone(timezone.utc)


def test_to_rome_month_buckets_in_europe_rome() -> None:
    # 2026-08-31 22:00 UTC is already 2026-09-01 00:00 in Europe/Rome.
    september = datetime(2026, 8, 31, 22, 0, tzinfo=timezone.utc)
    assert to_rome_month(september) == Month(2026, 9)
    # 2026-08-31 21:00 UTC is still 2026-08-31 23:00 in Europe/Rome.
    august = datetime(2026, 8, 31, 21, 0, tzinfo=timezone.utc)
    assert to_rome_month(august) == Month(2026, 8)
