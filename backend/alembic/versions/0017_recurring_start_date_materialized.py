"""recurring definitions: one start date, no due-date override

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-03

"""

import calendar
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | None = None
depends_on: str | None = None

ROME = ZoneInfo("Europe/Rome")

# The two definition tables, each with its link column on transactions and
# on recurring_skips (exactly one FK is set there — the table's CHECK
# enforces it, mirroring the transaction link columns).
DEFINITIONS = [
    ("recurring_costs", "recurring_cost_id"),
    ("recurring_incomes", "recurring_income_id"),
]


def _clamp_day(year: int, month: int, day: int) -> date:
    """`year-month-day` clamped to the last day of the month (ADR-0010's
    last-day rule for days 29–31 landing on shorter months)."""
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def _add_months(start: date, months: int) -> date:
    """`start` moved forward calendar months, day preserved and clamped per
    resulting month (a January 31 + 1 month lands on February 28/29; the
    next step still starts from the 31st)."""
    total = start.month - 1 + months
    year = start.year + total // 12
    month = total % 12 + 1
    return _clamp_day(year, month, start.day)


def _add_years(start: date, years: int) -> date:
    return _clamp_day(start.year + years, start.month, start.day)


def _occurrence(start: date, n: int, unit: str, k: int) -> date:
    """The k-th Occurrence of the old derivation (ADR-0010), embedded here so
    the migration never depends on app code that changes over time."""
    step = k * n
    if unit in ("days", "weeks"):
        days = step if unit == "days" else step * 7
        return start + timedelta(days=days)
    if unit == "months":
        return _add_months(start, step)
    if unit == "years":
        return _add_years(start, step)
    raise ValueError(f"unknown interval unit: {unit!r}")


def _new_start(anchor: date, n: int, unit: str, due_day, due_month) -> date:
    """The start date the definition would carry under the one-date model
    (ADR-0024), preserving its old due schedule as far as the new model can
    express it. Without an override (or on day/week intervals, which never
    carried one) it is the anchor itself. A month interval's due day D
    becomes a start on day D of the anchor month; a year interval's due
    month+day becomes that month+day of the anchor year — an Occurrence's
    per-month/per-year clamp then reproduces the old clamped dues exactly
    (a 31st start keeps landing on the 31st, clamped to shorter months).

    Two anchors the old model could express but the new one cannot, both
    because the clamp was per-due-date rather than per-start-date: a
    month-interval due day the anchor month itself lacks (due 31 created in
    February — the old first due was February's clamped last day), and a
    Feb 29 due with a non-leap anchor year. The migration shifts the start
    to the first occurrence the new model can hold — the following month
    (always a 31-day month), or the next leap year aligned with the anchor
    year's grid — dropping the clamped occurrences in between. Pins and
    skips for those dropped occurrences simply fall off the sequence, which
    the paid-state contract already tolerates (a pin whose Occurrence left
    the sequence never counts back in, ADR-0010)."""
    if unit == "months" and due_day is not None:
        if due_day <= calendar.monthrange(anchor.year, anchor.month)[1]:
            return date(anchor.year, anchor.month, due_day)
        if anchor.month == 12:
            return date(anchor.year + 1, 1, due_day)
        return date(anchor.year, anchor.month + 1, due_day)
    if unit == "years" and due_day is not None and due_month is not None:
        if due_month == 2 and due_day == 29 and not calendar.isleap(anchor.year):
            k = 1
            while not calendar.isleap(anchor.year + k * n):
                k += 1
            return date(anchor.year + k * n, 2, 29)
        return date(anchor.year, due_month, due_day)
    return anchor


def _remapped(anchor: date, new_start: date, n: int, unit: str, pinned: date):
    """The pinned/skipped date translated by index onto the new sequence —
    the old sequence's k-th Occurrence becomes the new sequence's k-th — or
    None when the date is not on the old sequence (it dangles; it keeps
    dangling, exactly like a pin whose Occurrence left the sequence after a
    definition edit)."""
    if unit == "months":
        diff = (pinned.year - anchor.year) * 12 + (pinned.month - anchor.month)
    elif unit == "years":
        diff = pinned.year - anchor.year
    else:
        return None  # day/week sequences never changed (no override existed)
    if diff < 0 or diff % n != 0:
        return None
    k = diff // n
    if _occurrence(anchor, n, unit, k) != pinned:
        return None
    moved = _occurrence(new_start, n, unit, k)
    return moved if moved != pinned else None


def upgrade() -> None:
    # Data first, schema last: every definition's start date is rewritten
    # (override folded in, or the creation day materialized when the start
    # date was never set — ADR-0024), its paid pins and skip marks are
    # remapped by index where the sequence moved, and only then do the
    # due_day/due_month columns drop and start_date become NOT NULL.
    bind = op.get_bind()
    for table, fk in DEFINITIONS:
        rows = bind.execute(
            sa.text(
                f"SELECT id, start_date, due_day, due_month, interval_value,"
                f" interval_unit, created_at FROM {table}"
            )
        ).all()
        for row in rows:
            def_id, stored_start, due_day, due_month, n, unit, created = row
            anchor = (
                stored_start
                if stored_start is not None
                else created.astimezone(ROME).date()
            )
            new_start = _new_start(anchor, n, unit, due_day, due_month)
            if stored_start is not None and new_start == stored_start:
                continue
            bind.execute(
                sa.text(f"UPDATE {table} SET start_date = :s WHERE id = :id"),
                {"s": new_start, "id": def_id},
            )
            if new_start == anchor:
                continue  # backfill only: the sequence never moved
            for source, key in (
                ("transactions", "id"),
                ("recurring_skips", "id"),
            ):
                markers = bind.execute(
                    sa.text(
                        f"SELECT id, occurrence_date FROM {source}"
                        f" WHERE {fk} = :def_id AND occurrence_date IS NOT NULL"
                    ),
                    {"def_id": def_id},
                ).all()
                for marker_id, pinned in markers:
                    moved = _remapped(anchor, new_start, n, unit, pinned)
                    if moved is not None:
                        bind.execute(
                            sa.text(
                                f"UPDATE {source} SET occurrence_date = :s"
                                f" WHERE id = :id"
                            ),
                            {"s": moved, "id": marker_id},
                        )

    for table, _ in DEFINITIONS:
        op.alter_column(
            table, "start_date", existing_type=sa.Date(), nullable=False
        )
        op.drop_column(table, "due_day")
        op.drop_column(table, "due_month")


def downgrade() -> None:
    # Reverses the schema, not the data: the folded-in start dates stay (the
    # old override values are gone for good), and start_date can hold null
    # again — but nothing writes null anymore (ADR-0024).
    for table, _ in DEFINITIONS:
        op.add_column(
            table,
            sa.Column("due_day", sa.Integer(), nullable=True),
        )
        op.add_column(
            table,
            sa.Column("due_month", sa.Integer(), nullable=True),
        )
        op.alter_column(
            table, "start_date", existing_type=sa.Date(), nullable=True
        )
