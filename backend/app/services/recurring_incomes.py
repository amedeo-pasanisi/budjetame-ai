"""Recurring Income business rules (issue #60). Called by the HTTP layer;
never from tests.

The mirror of the Recurring Cost service (ADR-0011): the same rules, income
side. Names unique per Account, case-insensitively; creation only on active,
non-Contact Wallets (incomes behave like Income Transactions); an optional
income-only Category; a start date every definition always carries (left
empty at creation it is set to the creation day; it can be changed, never
unset) — an Occurrence's due date is its own date, the due-date override is
gone (ADR-0024).
Occurrences and the next due date are derived, never stored — the pure
recurrence module (app.recurrence) owns that math, reused unchanged.
Deleting a Recurring Income is a hard delete (issue #60); linked
Transactions (issue #61, ADR-0027: an Income, or a Transfer from a Contact
Wallet) are severed by the FK's ON DELETE SET NULL and the definition's
skips cascade away (ADR-0016). The paid state also
lives here: `paid_occurrence_dates` is the set of Occurrences the income's
links cover and `oldest_unpaid_occurrence` the one a new link pays (the
oldest Unpaid, future Occurrences included — receiving ahead) — what the
transaction form's picker shows as `next_unpaid_occurrence_date` in the API
view. The skipped state (ADR-0016) lives in recurring_skips: `skipped_periods`
maps the stored Occurrence dates through the current unit's period shape and
every derived read excludes Skipped Occurrences. The Skip/Un-skip button is
gone (ADR-0026): `occurrence_states` is the Occurrences section's read —
every non-Paid Occurrence with its skipped state, newest first — and
`set_occurrence_skipped` its per-Occurrence skip/un-skip write, mirroring
the cost side.
"""

from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    Category,
    CategoryType,
    IntervalUnit,
    RecurringIncome,
    RecurringSkip,
    Transaction,
    Wallet,
    WalletType,
)
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


class RecurringIncomeNameTaken(Exception):
    """A Recurring Income with this name (case-insensitive) already exists
    for the Account."""


class RecurringIncomeRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _parse_start_date(value: str | None) -> date | None:
    """The start date as a Europe/Rome calendar day (the schema validated
    the "YYYY-MM-DD" shape), or None — the empty-at-creation case, which the
    caller turns into the creation day (ADR-0024)."""
    return date.fromisoformat(value) if value is not None else None


def create_recurring_income(
    session: Session,
    account_id: int,
    *,
    name: str,
    amount,
    interval_value: int,
    interval_unit: IntervalUnit,
    start_date: str | None,
) -> RecurringIncome:
    if scoping.name_is_taken(session, RecurringIncome, account_id, name):
        raise RecurringIncomeNameTaken(name)
    income = RecurringIncome(
        account_id=account_id,
        name=name,
        amount=amount,
        interval_value=interval_value,
        interval_unit=interval_unit.value,
        # An empty start date becomes the creation day, stored like any
        # other (ADR-0024): every definition always carries one.
        start_date=_parse_start_date(start_date) or rome_today(),
    )
    session.add(income)
    session.commit()
    session.refresh(income)
    return income


def update_recurring_income(
    session: Session, income: RecurringIncome, *, changes: dict
) -> RecurringIncome:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is
    applied; a field absent is untouched. `start_date` is the one exception
    to the null-clears rule: an explicit null is rejected — a definition
    always carries a start date (ADR-0024), it can be changed, never unset."""
    name = changes.get("name", income.name)
    if name is not None and name != income.name:
        if scoping.name_is_taken(
            session, RecurringIncome, income.account_id, name, exclude_id=income.id
        ):
            raise RecurringIncomeNameTaken(name)

    for field in ("name", "amount", "interval_value"):
        if field in changes:
            setattr(income, field, changes[field])
    if "interval_unit" in changes:
        income.interval_unit = changes["interval_unit"].value
    if "start_date" in changes:
        start_date = _parse_start_date(changes["start_date"])
        if start_date is None:
            raise RecurringIncomeRuleError(
                "A recurring income always carries a start date — it can be "
                "changed, never unset."
            )
        income.start_date = start_date

    session.commit()
    session.refresh(income)
    return income


def delete_recurring_income(session: Session, income: RecurringIncome) -> None:
    """Hard-delete the definition (issue #60). Linked Incomes (issue #61)
    survive as ordinary Incomes: the link FK is ON DELETE SET NULL, and the
    pinned Occurrence date goes with it — a severed link never carries an
    Occurrence (ADR-0010/0011)."""
    # The FK nulls recurring_income_id on its own; occurrence_date is a plain
    # column, so the pin is cleared here, in the same transaction.
    session.execute(
        update(Transaction)
        .where(Transaction.recurring_income_id == income.id)
        .values(recurring_income_id=None, occurrence_date=None)
    )
    session.delete(income)
    session.commit()


def skipped_periods(
    session: Session, income_id: int, unit: str
) -> set[Period]:
    """The periods (ADR-0016) of the income's skipped Occurrences under the
    current unit, mirroring the cost side: each stored Occurrence date
    mapped through `period_of`, which is what makes a skip travel with its
    Occurrence when the definition is edited."""
    stored = session.scalars(
        select(RecurringSkip.occurrence_date).where(
            RecurringSkip.recurring_income_id == income_id
        )
    ).all()
    return {period_of(value, unit) for value in stored}


def occurrence_states(
    session: Session, income: RecurringIncome
) -> list[tuple[date, bool]]:
    """The Occurrences section's read (ADR-0026), mirroring the cost side:
    every non-Paid Occurrence of the definition — its own date and whether
    the user excused it — newest first, the one order the modal renders.
    Paid history lives in the ledger and never appears; the walk covers the
    past rows (due today or earlier, today first), then the future rows —
    every Skipped future Occurrence stays on the list (an excused one must
    stay reachable), and the next incoming Unpaid one, the live row, heads
    the list: future Occurrences reveal one at a time (ADR-0026). The walk
    runs past the live row until the due date passes the span end of the
    largest stored period (app.recurrence.period_span_end), so restoring an
    earlier future row never hides excused rows beyond it: every excused
    future Occurrence lies within its stored period's span."""
    today = rome_today()
    unit = income.interval_unit
    paid = paid_occurrence_dates(session, income.id)
    stored = session.scalars(
        select(RecurringSkip.occurrence_date).where(
            RecurringSkip.recurring_income_id == income.id
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
        due = occurrence_date(
            income.start_date, income.interval_value, unit, k
        )
        if due <= today:
            if due not in paid:
                rows.append((due, period_of(due, unit) in skipped))
            k += 1
            continue
        break
    live_row_found = False
    while True:
        due = occurrence_date(
            income.start_date, income.interval_value, unit, k
        )
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
    income: RecurringIncome,
    date_str: str,
    *,
    skipped: bool,
) -> None:
    """The per-Occurrence skip write (ADR-0026), mirroring the cost side:
    PUT the Occurrence's date with {"skipped": true} to excuse it,
    {"skipped": false} to restore it — every row of the read toggles
    independently, in any order. A skip stores the Occurrence's own date,
    so it keeps anchoring to its period and traveling with the Occurrence
    (ADR-0016); un-skipping deletes the stored row whose period covers the
    target. The write is idempotent: stating the current state changes
    nothing, so a double tap cannot double-flip. Only Unpaid Occurrences
    are ever skipped — a link's pin rejects the skip, exactly as a link
    can never pay a Skipped one."""
    try:
        occurrence = date.fromisoformat(date_str)
    except ValueError:
        raise RecurringIncomeRuleError(
            f"{date_str!r} is not a calendar day (YYYY-MM-DD)."
        ) from None
    unit = income.interval_unit
    if not skipped:
        # Restore: delete every stored row whose effective period covers the
        # target — period equality is what makes the anchor travel with the
        # Occurrence when the definition is edited (ADR-0016). Nothing to
        # delete is the idempotent no-op.
        target_period = period_of(occurrence, unit)
        rows = session.scalars(
            select(RecurringSkip).where(RecurringSkip.recurring_income_id == income.id)
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
        due = occurrence_date(
            income.start_date, income.interval_value, unit, k
        )
        if due == occurrence:
            break
        if due > occurrence:
            raise RecurringIncomeRuleError(
                "This date is not one of the definition's Occurrences."
            )
        k += 1
    if occurrence in paid_occurrence_dates(session, income.id):
        raise RecurringIncomeRuleError("A paid occurrence can never be skipped.")
    if period_of(occurrence, unit) in skipped_periods(session, income.id, unit):
        # Already excused — the idempotent no-op (the existing anchor may
        # be a different date on the same period after an edit).
        return
    session.add(
        RecurringSkip(recurring_income_id=income.id, occurrence_date=occurrence)
    )
    session.commit()


def next_due_date_for(session: Session, income: RecurringIncome) -> date:
    """The income's next due date, derived on the fly (ADR-0010): the first
    Occurrence — the start date plus the interval, clamped — whose own date
    (ADR-0024: its due date) is today or later in Europe/Rome. A Skipped
    Occurrence is not due: the walk steps past it (ADR-0016). The pure
    recurrence module owns the math, shared unchanged with Recurring Costs
    (ADR-0011)."""
    return next_due_date(
        income.start_date,
        income.interval_value,
        income.interval_unit,
        rome_today(),
        skipped_periods(session, income.id, income.interval_unit),
    )


def paid_occurrence_dates(
    session: Session, income_id: int, *, exclude_transaction_id: int | None = None
) -> set[date]:
    """The Occurrence dates this income's linked Transactions cover (issues
    #61, ADR-0027 — an Income or a Transfer from a Contact Wallet) — the
    paid set, mirroring the cost side. `exclude_transaction_id` drops one
    link's own pin (the Transaction being relinked judges itself as not yet
    paid, so it can re-pin the very Occurrence it already covers)."""
    stmt = select(Transaction.occurrence_date).where(
        Transaction.recurring_income_id == income_id,
        Transaction.occurrence_date.is_not(None),
    )
    if exclude_transaction_id is not None:
        stmt = stmt.where(Transaction.id != exclude_transaction_id)
    return {
        value for value in session.scalars(stmt).all() if value is not None
    }


def backlog_count_for(session: Session, income: RecurringIncome) -> int:
    """The income's Backlog (issue #62): Unpaid Occurrences whose due date
    is today or earlier in Europe/Rome — the "N unpaid" badge. Unpaid means
    its own date is not covered by a linked Transaction and its period is not
    skipped: the pins are stored (issue #61) and the skips are stored
    (ADR-0016), so editing the interval or start date reshapes only the
    derived future — an Occurrence a link covers or the user excused is
    never counted back in.
    The pure recurrence module owns the boundary math, shared unchanged
    with Recurring Costs (ADR-0011)."""
    paid = paid_occurrence_dates(session, income.id)
    return backlog_count(
        income.start_date,
        income.interval_value,
        income.interval_unit,
        rome_today(),
        paid,
        skipped_periods(session, income.id, income.interval_unit),
    )


def oldest_unpaid_occurrence(
    session: Session,
    income: RecurringIncome,
    *,
    exclude_transaction_id: int | None = None,
) -> date:
    """The Occurrence a new link pays (issue #61): the oldest Unpaid one —
    the first of the derived sequence (from the start date plus the
    interval) no linked Transaction covers and whose
    period is not skipped — a Skipped Occurrence is never paid (ADR-0016),
    un-skipping comes first. Future Occurrences are included when nothing
    earlier is Unpaid, so receiving early is natural; the sequence is
    infinite and the paid and skipped sets finite, so the walk always
    terminates. The pin is stored on the link at this moment and never
    recomputed (ADR-0010/0011)."""
    paid = paid_occurrence_dates(
        session, income.id, exclude_transaction_id=exclude_transaction_id
    )
    skipped = skipped_periods(session, income.id, income.interval_unit)
    k = 0
    while True:
        occurrence = occurrence_date(
            income.start_date, income.interval_value, income.interval_unit, k
        )
        if (
            occurrence not in paid
            and period_of(occurrence, income.interval_unit) not in skipped
        ):
            return occurrence
        k += 1
