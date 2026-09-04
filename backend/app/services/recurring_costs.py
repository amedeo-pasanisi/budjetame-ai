"""Recurring Cost business rules (issue #56). Called by the HTTP layer; never
from tests.

Rules from CONTEXT.md, ADR-0010 and ADR-0024: names unique per Account,
case-insensitively; a start date every definition always carries (left
empty at creation it is set to the creation day; it can be changed, never
unset) — an Occurrence's due date is its own date, the due-date override
is gone.
Occurrences and the next due date are derived, never stored — the pure
recurrence module (app.recurrence) owns that math. Deleting a Recurring Cost
is a hard delete; linked Expenses (issue #57) are severed by the FK's ON
DELETE SET NULL and the definition's skips cascade away (ADR-0016). The paid
state also lives here: `paid_occurrence_dates` is the set of Occurrences the
cost's links cover and `oldest_unpaid_occurrence` the one a new link pays
(the oldest Unpaid, future Occurrences included — paying ahead) — what the
transaction form's picker shows as `next_unpaid_occurrence_date` in the API
view. The skipped state (ADR-0016) lives in recurring_skips: `skipped_periods`
maps the stored Occurrence dates through the current unit's period shape and
every derived read excludes Skipped Occurrences. The Skip/Un-skip button is
gone (ADR-0026): `occurrence_states` is the Occurrences section's read — every
non-Paid Occurrence with its skipped state, newest first — and
`set_occurrence_skipped` its per-Occurrence skip/un-skip write.
"""

from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import IntervalUnit, RecurringCost, RecurringSkip, Transaction
from app.recurrence import (
    Period,
    backlog_count,
    next_due_date,
    occurrence_date,
    period_of,
    period_span_end,
    rome_today,
)
from app.services import scoping


class RecurringCostNameTaken(Exception):
    """A Recurring Cost with this name (case-insensitive) already exists for
    the Account."""


class RecurringCostRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _parse_start_date(value: str | None) -> date | None:
    """The start date as a Europe/Rome calendar day (the schema validated
    the "YYYY-MM-DD" shape), or None — the empty-at-creation case, which the
    caller turns into the creation day (ADR-0024)."""
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
) -> RecurringCost:
    if scoping.name_is_taken(session, RecurringCost, account_id, name):
        raise RecurringCostNameTaken(name)
    cost = RecurringCost(
        account_id=account_id,
        name=name,
        amount=amount,
        interval_value=interval_value,
        interval_unit=interval_unit.value,
        # An empty start date becomes the creation day, stored like any
        # other (ADR-0024): every definition always carries one.
        start_date=_parse_start_date(start_date) or rome_today(),
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
    applied; a field absent is untouched. `start_date` is the one exception
    to the null-clears rule: an explicit null is rejected — a definition
    always carries a start date (ADR-0024), it can be changed, never unset."""
    name = changes.get("name", cost.name)
    if name is not None and name != cost.name:
        if scoping.name_is_taken(
            session, RecurringCost, cost.account_id, name, exclude_id=cost.id
        ):
            raise RecurringCostNameTaken(name)

    for field in ("name", "amount", "interval_value"):
        if field in changes:
            setattr(cost, field, changes[field])
    if "interval_unit" in changes:
        cost.interval_unit = changes["interval_unit"].value
    if "start_date" in changes:
        start_date = _parse_start_date(changes["start_date"])
        if start_date is None:
            raise RecurringCostRuleError(
                "A recurring cost always carries a start date — it can be "
                "changed, never unset."
            )
        cost.start_date = start_date

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


def occurrence_states(
    session: Session, cost: RecurringCost
) -> list[tuple[date, bool]]:
    """The Occurrences section's read (ADR-0026): every non-Paid Occurrence
    of the definition — its own date (ADR-0024) and whether the user
    excused it — newest first, the one order the modal renders. Paid
    history lives in the ledger: a row a link covers never appears (there
    is nothing to skip or un-skip on it), exactly as the derived reads step
    over paid pins.

    The walk covers the past rows (due today or earlier — today first, down
    to the oldest), then the future rows: every Skipped future Occurrence
    stays on the list (an excused one must stay reachable, in date order),
    and the next incoming Unpaid one — the live row — heads the list:
    future Occurrences reveal one at a time, so a whole month can be
    excused by tapping the top row repeatedly in one sitting. The walk runs
    past the live row until the due date passes the span end of the largest
    stored period (app.recurrence.period_span_end), so restoring an earlier
    future row (un-skip in any order) never hides excused rows beyond it:
    every excused future Occurrence lies within its stored period's span.
    Paid future rows are stepped over; a dormant skip (a period holding no
    Occurrence of the current sequence) never matches anything.
    """
    today = rome_today()
    unit = cost.interval_unit
    paid = paid_occurrence_dates(session, cost.id)
    stored = session.scalars(
        select(RecurringSkip.occurrence_date).where(
            RecurringSkip.recurring_cost_id == cost.id
        )
    ).all()
    skipped = {period_of(value, unit) for value in stored}
    # Every Skipped future Occurrence lies at or before the span end of the
    # largest stored period (app.recurrence.period_span_end): the walk past
    # the live row only needs to run until the due date passes that bound.
    walk_bound = max(
        (period_span_end(period_of(value, unit)) for value in stored), default=None
    )
    rows: list[tuple[date, bool]] = []
    k = 0
    while True:
        due = occurrence_date(cost.start_date, cost.interval_value, unit, k)
        if due <= today:
            if due not in paid:
                rows.append((due, period_of(due, unit) in skipped))
            k += 1
            continue
        break
    live_row_found = False
    while True:
        due = occurrence_date(cost.start_date, cost.interval_value, unit, k)
        k += 1
        period = period_of(due, unit)
        if due in paid:
            # A paid future Occurrence is stepped over, like every other
            # derived read walks past it.
            pass
        elif period in skipped:
            rows.append((due, True))
        elif not live_row_found:
            rows.append((due, False))
            live_row_found = True
        if live_row_found and (walk_bound is None or due > walk_bound):
            break
    # The one order the modal renders: the live row — the next incoming
    # Unpaid Occurrence — always heads the list, even when an un-skip in
    # any order leaves excused future rows newer than it (a restored row
    # must not hide or outrank the rows after it); every other row follows
    # newest first — the greyed future rows in date order, then the past
    # group (today first) down to the oldest.
    rows.sort(reverse=True)
    live = next(
        (row for row in rows if row[0] > today and not row[1]), None
    )
    if live is None:
        return rows
    return [live] + [row for row in rows if row != live]


def set_occurrence_skipped(
    session: Session,
    cost: RecurringCost,
    date_str: str,
    *,
    skipped: bool,
) -> None:
    """The per-Occurrence skip write (ADR-0026): PUT the Occurrence's date
    with {"skipped": true} to excuse it, {"skipped": false} to restore it
    — every row of the read toggles independently, in any order (the
    button's queue discipline is gone). A skip stores the Occurrence's own
    date, so it keeps anchoring to its period and traveling with the
    Occurrence (ADR-0016); un-skipping deletes the stored row whose period
    covers the target. The write is idempotent: stating the current state
    changes nothing, so a double tap cannot double-flip. Only Unpaid
    Occurrences are ever skipped — a link's pin rejects the skip, exactly
    as a link can never pay a Skipped one."""
    try:
        occurrence = date.fromisoformat(date_str)
    except ValueError:
        raise RecurringCostRuleError(
            f"{date_str!r} is not a calendar day (YYYY-MM-DD)."
        ) from None
    unit = cost.interval_unit
    if not skipped:
        # Restore: delete every stored row whose effective period covers the
        # target — period equality is what makes the anchor travel with the
        # Occurrence when the definition is edited (ADR-0016). Nothing to
        # delete is the idempotent no-op.
        target_period = period_of(occurrence, unit)
        rows = session.scalars(
            select(RecurringSkip).where(RecurringSkip.recurring_cost_id == cost.id)
        ).all()
        for row in rows:
            if period_of(row.occurrence_date, unit) == target_period:
                session.delete(row)
        session.commit()
        return
    # Excuse: the target must be one of the definition's Occurrences (the
    # read only ever lists those), and one no link covers. The walk from
    # the start matches the date exactly; dates strictly increase in k.
    k = 0
    while True:
        due = occurrence_date(cost.start_date, cost.interval_value, unit, k)
        if due == occurrence:
            break
        if due > occurrence:
            raise RecurringCostRuleError(
                "This date is not one of the definition's Occurrences."
            )
        k += 1
    if occurrence in paid_occurrence_dates(session, cost.id):
        raise RecurringCostRuleError("A paid occurrence can never be skipped.")
    if period_of(occurrence, unit) in skipped_periods(session, cost.id, unit):
        # Already excused — the idempotent no-op (the existing anchor may
        # be a different date on the same period after an edit).
        return
    session.add(RecurringSkip(recurring_cost_id=cost.id, occurrence_date=occurrence))
    session.commit()


def next_due_date_for(session: Session, cost: RecurringCost) -> date:
    """The cost's next due date, derived on the fly (ADR-0010): the first
    Occurrence — the start date plus the interval, clamped — whose own date
    (ADR-0024: its due date) is today or later in Europe/Rome. A Skipped
    Occurrence is not due: the walk steps past it (ADR-0016)."""
    return next_due_date(
        cost.start_date,
        cost.interval_value,
        cost.interval_unit,
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
    today or earlier in Europe/Rome — the "N unpaid" badge. Unpaid means
    its own date is not covered by a linked Expense and its period is not
    skipped:
    the pins are stored (issue #57) and the skips are stored (ADR-0016), so
    editing the interval or start date reshapes only the derived future —
    an Occurrence a link covers or the user excused is never counted back
    in."""
    paid = paid_occurrence_dates(session, cost.id)
    return backlog_count(
        cost.start_date,
        cost.interval_value,
        cost.interval_unit,
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
    the first of the derived sequence (from the start date plus the
    interval) no linked Expense covers and whose
    period is not skipped — a Skipped Occurrence is never paid (ADR-0016),
    un-skipping comes first. Future Occurrences are included when nothing
    earlier is Unpaid, so paying ahead is natural; the sequence is infinite
    and the paid and skipped sets finite, so the walk always terminates.
    The pin is stored on the link at this moment and never recomputed
    (ADR-0010)."""
    paid = paid_occurrence_dates(session, cost.id, exclude_transaction_id=exclude_transaction_id)
    skipped = skipped_periods(session, cost.id, cost.interval_unit)
    k = 0
    while True:
        occurrence = occurrence_date(
            cost.start_date, cost.interval_value, cost.interval_unit, k
        )
        if occurrence not in paid and period_of(occurrence, cost.interval_unit) not in skipped:
            return occurrence
        k += 1
