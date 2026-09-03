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
Deleting a Recurring Income is a hard delete (issue #60); linked Incomes
(issue #61) are severed by the FK's ON DELETE SET NULL and the definition's
skips cascade away (ADR-0016). The paid state also
lives here: `paid_occurrence_dates` is the set of Occurrences the income's
links cover and `oldest_unpaid_occurrence` the one a new link pays (the
oldest Unpaid, future Occurrences included — receiving ahead) — what the
transaction form's picker shows as `next_unpaid_occurrence_date` in the API
view. The skipped state (ADR-0016) lives in recurring_skips: `skipped_periods`
maps the stored Occurrence dates through the current unit's period shape,
`toggle_skip` flips the oldest Unpaid Occurrence (the Skip/Un-skip button),
and every derived read excludes Skipped Occurrences — the mirror of the
cost side (issue #58, ADR-0011).
"""

from datetime import date
from typing import Literal

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


def oldest_unpinned_occurrence(session: Session, income: RecurringIncome) -> date:
    """The oldest Occurrence no linked Income covers — Skipped or not
    (ADR-0016): the Skip/Un-skip button's target, the front of the queue.
    The link walk (`oldest_unpaid_occurrence`) steps over Skipped ones; the
    button must not, or un-skipping would be unreachable."""
    paid = paid_occurrence_dates(session, income.id)
    k = 0
    while True:
        occurrence = occurrence_date(
            income.start_date, income.interval_value, income.interval_unit, k
        )
        if occurrence not in paid:
            return occurrence
        k += 1


def toggle_skip(session: Session, income: RecurringIncome) -> RecurringIncome:
    """The Skip/Un-skip button (ADR-0016), mirroring the cost side: when
    the whole Backlog is excused, it un-skips the oldest Skipped Occurrence;
    otherwise it skips the oldest Unpaid, un-Skipped Occurrence — the same
    one a link would pay. A skip stores the Occurrence's own date;
    un-skipping deletes the row whose period covers the target."""
    if next_skip_action(session, income) == "unskip":
        target = oldest_unpinned_occurrence(session, income)
        target_period = period_of(target, income.interval_unit)
        rows = session.scalars(
            select(RecurringSkip).where(RecurringSkip.recurring_income_id == income.id)
        ).all()
        for row in rows:
            if period_of(row.occurrence_date, income.interval_unit) == target_period:
                session.delete(row)
                break
    else:
        target = oldest_unpaid_occurrence(session, income)
        session.add(RecurringSkip(recurring_income_id=income.id, occurrence_date=target))
    session.commit()
    session.refresh(income)
    return income


def next_skip_action(
    session: Session, income: RecurringIncome
) -> Literal["skip", "unskip"]:
    """What the Skip/Un-skip button reads (ADR-0016): "unskip" exactly
    when the whole Backlog is excused — no Unpaid, un-Skipped Occurrence is
    due — and the oldest Unpaid Occurrence (the front of the queue) is the
    Skipped one. Otherwise "skip": there is still an Unpaid, un-Skipped
    Occurrence to excuse."""
    if backlog_count_for(session, income) > 0:
        return "skip"
    target = oldest_unpinned_occurrence(session, income)
    skipped = skipped_periods(session, income.id, income.interval_unit)
    return "unskip" if period_of(target, income.interval_unit) in skipped else "skip"


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
    """The Occurrence dates this income's linked Incomes cover (issue #61) —
    the paid set, mirroring the cost side. `exclude_transaction_id` drops one
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
    is today or earlier in Europe/Rome — the "N unpaid" badge, and the
    Overdue flag's source (a non-empty Backlog is Overdue). Unpaid means
    its own date is not covered by a linked Income and its period is not
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
    interval) no linked Income covers and whose
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
