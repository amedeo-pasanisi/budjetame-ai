"""Recurring Cost business rules (issue #56). Called by the HTTP layer; never
from tests.

Rules from CONTEXT.md and ADR-0010: names unique per Account,
case-insensitively; an optional start date defaulting to the creation date;
an optional due-date override whose shape follows the interval unit
(day-of-month for months, month+day for years, none for days/weeks).
Occurrences and the next due date are derived, never stored — the pure
recurrence module (app.recurrence) owns that math. Deleting a Recurring Cost
is a hard delete; linked Expenses (issue #57) are severed by the FK's ON
DELETE SET NULL and the definition's skips cascade away (ADR-0016). The paid
state also lives here: `paid_occurrence_dates` is the set of Occurrences the
cost's links cover and `oldest_unpaid_occurrence` the one a new link pays
(the oldest Unpaid, future Occurrences included — paying ahead) — what the
transaction form's picker shows as `next_unpaid_occurrence_date` in the API
view. The skipped state (ADR-0016) lives in recurring_skips: `skipped_periods`
maps the stored Occurrence dates through the current unit's period shape,
`toggle_skip` flips the oldest Unpaid Occurrence (the Skip/Un-skip button),
and every derived read excludes Skipped Occurrences.
"""

from datetime import date
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import IntervalUnit, RecurringCost, RecurringSkip, Transaction
from app.recurrence import (
    Period,
    backlog_count,
    next_due_date,
    occurrence_date,
    period_of,
    rome_day_of,
    rome_today,
)
from app.services import scoping


class RecurringCostNameTaken(Exception):
    """A Recurring Cost with this name (case-insensitive) already exists for
    the Account."""


class RecurringCostRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _validate_override(
    unit: str, due_day: int | None, due_month: int | None
) -> None:
    """The due-date override follows the interval unit (ADR-0010): none for
    day/week intervals, a day-of-month alone for months, a month+day pair
    for years."""
    if unit in (IntervalUnit.DAYS.value, IntervalUnit.WEEKS.value):
        if due_day is not None or due_month is not None:
            raise RecurringCostRuleError(
                "Day and week intervals never carry a due-date override"
            )
    elif unit == IntervalUnit.MONTHS.value:
        if due_month is not None:
            raise RecurringCostRuleError(
                "Month intervals carry a day-of-month override only"
            )
    else:  # years
        if (due_day is None) != (due_month is None):
            raise RecurringCostRuleError(
                "Year intervals carry a month+day override"
            )


def _parse_start_date(value: str | None) -> date | None:
    """The start date as a Europe/Rome calendar day (the schema validated the
    "YYYY-MM-DD" shape), or None — meaning the creation date."""
    return date.fromisoformat(value) if value is not None else None


def create_recurring_cost(
    session: Session,
    account_id: int,
    *,
    name: str,
    amount,
    interval_value: int,
    interval_unit: IntervalUnit,
    start_date: str | None,
    due_day: int | None,
    due_month: int | None,
) -> RecurringCost:
    if scoping.name_is_taken(session, RecurringCost, account_id, name):
        raise RecurringCostNameTaken(name)
    _validate_override(interval_unit.value, due_day, due_month)
    cost = RecurringCost(
        account_id=account_id,
        name=name,
        amount=amount,
        interval_value=interval_value,
        interval_unit=interval_unit.value,
        start_date=_parse_start_date(start_date),
        due_day=due_day,
        due_month=due_month,
    )
    session.add(cost)
    session.commit()
    session.refresh(cost)
    return cost


def update_recurring_cost(
    session: Session, cost: RecurringCost, *, changes: dict
) -> RecurringCost:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is
    applied even when null (clearing the optional field); a field absent is
    untouched. The guards judge the resulting definition — an override left
    stale by a unit change is rejected, not silently dropped."""
    unit = (
        changes["interval_unit"].value
        if "interval_unit" in changes
        else cost.interval_unit
    )
    due_day = changes["due_day"] if "due_day" in changes else cost.due_day
    due_month = changes["due_month"] if "due_month" in changes else cost.due_month
    _validate_override(unit, due_day, due_month)

    name = changes.get("name", cost.name)
    if name is not None and name != cost.name:
        if scoping.name_is_taken(
            session, RecurringCost, cost.account_id, name, exclude_id=cost.id
        ):
            raise RecurringCostNameTaken(name)

    for field in ("name", "amount", "interval_value", "due_day", "due_month"):
        if field in changes:
            setattr(cost, field, changes[field])
    if "interval_unit" in changes:
        cost.interval_unit = changes["interval_unit"].value
    if "start_date" in changes:
        cost.start_date = _parse_start_date(changes["start_date"])

    session.commit()
    session.refresh(cost)
    return cost


def delete_recurring_cost(session: Session, cost: RecurringCost) -> None:
    """Hard-delete the definition. Linked Expenses (issue #57) survive as
    ordinary Expenses: the link FK is ON DELETE SET NULL, and the pinned
    Occurrence date goes with it — a severed link never carries an
    Occurrence (ADR-0010)."""
    # The FK nulls recurring_cost_id on its own; occurrence_date is a plain
    # column, so the pin is cleared here, in the same transaction.
    session.execute(
        update(Transaction)
        .where(Transaction.recurring_cost_id == cost.id)
        .values(recurring_cost_id=None, occurrence_date=None)
    )
    session.delete(cost)
    session.commit()


def skipped_periods(
    session: Session, cost_id: int, unit: str
) -> set[Period]:
    """The periods (ADR-0016) of the cost's skipped Occurrences under the
    current unit: each stored Occurrence date mapped through `period_of` —
    the month for month intervals, the year for year intervals, the date
    itself for day/week. That mapping is what makes a skip travel with its
    Occurrence when the definition is edited: changing the interval unit
    re-shapes the periods of the stored dates, so a skipped month becomes
    its year and a skipped year becomes its month; a period that holds no
    Occurrence of the current sequence simply never matches (dormant).
    """
    stored = session.scalars(
        select(RecurringSkip.occurrence_date).where(
            RecurringSkip.recurring_cost_id == cost_id
        )
    ).all()
    return {period_of(value, unit) for value in stored}


def oldest_unpinned_occurrence(session: Session, cost: RecurringCost) -> date:
    """The oldest Occurrence no linked Expense covers — Skipped or not
    (ADR-0016): the Skip/Un-skip button's target, the front of the queue.
    The link walk (`oldest_unpaid_occurrence`) steps over Skipped ones; the
    button must not, or un-skipping would be unreachable. The sequence is
    infinite and the paid set finite, so the walk always terminates.
    """
    paid = paid_occurrence_dates(session, cost.id)
    start = (
        cost.start_date
        if cost.start_date is not None
        else rome_day_of(cost.created_at)
    )
    k = 0
    while True:
        occurrence = occurrence_date(
            start, cost.interval_value, cost.interval_unit, k
        )
        if occurrence not in paid:
            return occurrence
        k += 1


def toggle_skip(session: Session, cost: RecurringCost) -> RecurringCost:
    """The Skip/Un-skip button (ADR-0016). When the whole Backlog is
    excused, it un-skips the oldest Skipped Occurrence; otherwise it skips
    the oldest Unpaid, un-Skipped Occurrence — the same one a link would
    pay, so the badge ticks down oldest-first, one press per Occurrence.
    Only Unpaid Occurrences are ever skipped (the walk never targets a
    link's pin). A skip stores the Occurrence's own date; un-skipping
    deletes the row whose period covers the target. The response is the
    refreshed definition: every derived read re-derives from the stored
    skips."""
    if next_skip_action(session, cost) == "unskip":
        target = oldest_unpinned_occurrence(session, cost)
        target_period = period_of(target, cost.interval_unit)
        rows = session.scalars(
            select(RecurringSkip).where(RecurringSkip.recurring_cost_id == cost.id)
        ).all()
        for row in rows:
            if period_of(row.occurrence_date, cost.interval_unit) == target_period:
                session.delete(row)
                break
    else:
        target = oldest_unpaid_occurrence(session, cost)
        session.add(RecurringSkip(recurring_cost_id=cost.id, occurrence_date=target))
    session.commit()
    session.refresh(cost)
    return cost


def next_skip_action(session: Session, cost: RecurringCost) -> Literal["skip", "unskip"]:
    """What the Skip/Un-skip button reads (ADR-0016): "unskip" exactly
    when the whole Backlog is excused — no Unpaid, un-Skipped Occurrence is
    due — and the oldest Unpaid Occurrence (the front of the queue) is the
    Skipped one; then the press restores it. Otherwise "skip": there is
    still an Unpaid, un-Skipped Occurrence to excuse — the button clears
    the Backlog oldest-first, and only resolves the Skipped ones once the
    whole Backlog is excused (Q17's queue discipline)."""
    if backlog_count_for(session, cost) > 0:
        return "skip"
    target = oldest_unpinned_occurrence(session, cost)
    skipped = skipped_periods(session, cost.id, cost.interval_unit)
    return "unskip" if period_of(target, cost.interval_unit) in skipped else "skip"


def next_due_date_for(session: Session, cost: RecurringCost) -> date:
    """The cost's next due date, derived on the fly (ADR-0010): the first
    Occurrence — from the start date (or the creation date when unset) plus
    the interval, clamped — whose due date (override applied) is today or
    later in Europe/Rome. A Skipped Occurrence is not due: the walk steps
    past it (ADR-0016)."""
    start = (
        cost.start_date
        if cost.start_date is not None
        else rome_day_of(cost.created_at)
    )
    return next_due_date(
        start,
        cost.interval_value,
        cost.interval_unit,
        cost.due_day,
        cost.due_month,
        rome_today(),
        skipped_periods(session, cost.id, cost.interval_unit),
    )


def paid_occurrence_dates(
    session: Session, cost_id: int, *, exclude_transaction_id: int | None = None
) -> set[date]:
    """The Occurrence dates this cost's linked Expenses cover (issue #57) —
    the paid set. `exclude_transaction_id` drops one link's own pin (the
    Transaction being relinked judges itself as not yet paid, so it can
    re-pin the very Occurrence it already covers)."""
    stmt = select(Transaction.occurrence_date).where(
        Transaction.recurring_cost_id == cost_id,
        Transaction.occurrence_date.is_not(None),
    )
    if exclude_transaction_id is not None:
        stmt = stmt.where(Transaction.id != exclude_transaction_id)
    return {
        value for value in session.scalars(stmt).all() if value is not None
    }


def backlog_count_for(session: Session, cost: RecurringCost) -> int:
    """The cost's Backlog (issue #58): Unpaid Occurrences whose due date is
    today or earlier in Europe/Rome — the "N unpaid" badge, and the Overdue
    flag's source (a non-empty Backlog is Overdue). Unpaid means its own
    date is not covered by a linked Expense and its period is not skipped:
    the pins are stored (issue #57) and the skips are stored (ADR-0016), so
    editing the interval or start date reshapes only the derived future —
    an Occurrence a link covers or the user excused is never counted back
    in."""
    paid = paid_occurrence_dates(session, cost.id)
    start = (
        cost.start_date
        if cost.start_date is not None
        else rome_day_of(cost.created_at)
    )
    return backlog_count(
        start,
        cost.interval_value,
        cost.interval_unit,
        cost.due_day,
        cost.due_month,
        rome_today(),
        paid,
        skipped_periods(session, cost.id, cost.interval_unit),
    )


def oldest_unpaid_occurrence(
    session: Session,
    cost: RecurringCost,
    *,
    exclude_transaction_id: int | None = None,
) -> date:
    """The Occurrence a new link pays (issue #57): the oldest Unpaid one —
    the first of the derived sequence (from the start date, or the creation
    date when unset, plus the interval) no linked Expense covers and whose
    period is not skipped — a Skipped Occurrence is never paid (ADR-0016),
    un-skipping comes first. Future Occurrences are included when nothing
    earlier is Unpaid, so paying ahead is natural; the sequence is infinite
    and the paid and skipped sets finite, so the walk always terminates.
    The pin is stored on the link at this moment and never recomputed
    (ADR-0010)."""
    paid = paid_occurrence_dates(session, cost.id, exclude_transaction_id=exclude_transaction_id)
    start = (
        cost.start_date
        if cost.start_date is not None
        else rome_day_of(cost.created_at)
    )
    skipped = skipped_periods(session, cost.id, cost.interval_unit)
    k = 0
    while True:
        occurrence = occurrence_date(start, cost.interval_value, cost.interval_unit, k)
        if occurrence not in paid and period_of(occurrence, cost.interval_unit) not in skipped:
            return occurrence
        k += 1
