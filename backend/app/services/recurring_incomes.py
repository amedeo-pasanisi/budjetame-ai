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
recurrence module (app.recurrence) owns that math, and the Occurrence
Timeline (app.services.occurrences) owns every derived read for both kinds:
the Paid and Skipped state, the Backlog, the one a new link pays, the
Occurrences section's rows and its skip/un-skip write. Freezing a Recurring
Income replaces the old hard delete (ADR-0028): a frozen definition keeps
its links (issue #61, ADR-0027: an Income, or a Transfer from a Contact
Wallet), becomes read-only, and stops generating Occurrences; its skips are
removed at freeze time. Unfreezing restores it to active. This module keeps
the definition's own lifecycle: create, update, freeze, unfreeze.
"""

from datetime import date

from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import Session

from app.models import IntervalUnit, RecurringIncome, RecurringSkip
from app.recurrence import rome_today
from app.services import scoping


class RecurringIncomeNameTaken(Exception):
    """A Recurring Income with this name (case-insensitive) already exists
    for the Account."""


class RecurringIncomeRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


class RecurringIncomeFrozen(Exception):
    """The Recurring Income is frozen — no field can be edited (ADR-0028)."""


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
    always carries a start date (ADR-0024), it can be changed, never unset.
    A frozen definition is read-only — every edit is rejected (ADR-0028)."""
    if income.frozen:
        raise RecurringIncomeFrozen(
            "A frozen recurring income cannot be edited. Unfreeze it first."
        )
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


def freeze_recurring_income(session: Session, income: RecurringIncome) -> RecurringIncome:
    """Freeze a Recurring Income (ADR-0028): clean up unpaid/skipped
    Occurrences, stop generating new ones, mark it frozen. All links to
    Transactions survive intact. Freezing an already-frozen definition is
    a no-op (idempotent)."""
    if income.frozen:
        return income
    # Delete all skip rows for this definition.
    session.execute(
        sa_delete(RecurringSkip).where(RecurringSkip.recurring_income_id == income.id)
    )
    income.frozen = True
    income.freeze_date = rome_today()
    session.commit()
    session.refresh(income)
    return income


def unfreeze_recurring_income(session: Session, income: RecurringIncome) -> RecurringIncome:
    """Unfreeze a frozen Recurring Income (ADR-0028): restore editability,
    resume Occurrence generation on the natural cycle. If the name collides
    with an existing active definition, reject. Unfreezing an active
    definition is a no-op, mirroring freeze's idempotency."""
    if not income.frozen:
        return income
    if scoping.name_is_taken(
        session, RecurringIncome, income.account_id, income.name, exclude_id=income.id
    ):
        raise RecurringIncomeNameTaken(income.name)
    income.frozen = False
    income.freeze_date = None
    session.commit()
    session.refresh(income)
    return income
