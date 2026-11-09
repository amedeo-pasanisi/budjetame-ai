"""Recurring Cost business rules (issue #56). Called by the HTTP layer; never
from tests.

Rules from CONTEXT.md, ADR-0010 and ADR-0024: names unique per Account,
case-insensitively; a start date every definition always carries (left
empty at creation it is set to the creation day; it can be changed, never
unset) — an Occurrence's due date is its own date, the due-date override
is gone.
Occurrences and the next due date are derived, never stored — the pure
recurrence module (app.recurrence) owns that math, and the Occurrence
Timeline (app.services.occurrences) owns every derived read: the Paid and
Skipped state, the Backlog, the one a new link pays, the Occurrences
section's rows and its skip/un-skip write. Freezing a Recurring Cost
replaces the old hard delete: a frozen definition keeps its links, becomes
read-only, and stops generating Occurrences (ADR-0028). Unfreezing restores
it to active. This module keeps the definition's own lifecycle: create,
update, freeze, unfreeze.
"""

from datetime import date

from sqlalchemy import delete as sa_delete
from sqlalchemy.orm import Session

from app.models import IntervalUnit, RecurringCost, RecurringSkip
from app.recurrence import rome_today
from app.services import scoping


class RecurringCostNameTaken(Exception):
    """A Recurring Cost with this name (case-insensitive) already exists for
    the Account."""


class RecurringCostRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


class RecurringCostFrozen(Exception):
    """The Recurring Cost is frozen — no field can be edited (ADR-0028)."""


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
    always carries a start date (ADR-0024), it can be changed, never unset.
    A frozen definition is read-only — every edit is rejected (ADR-0028)."""
    if cost.frozen:
        raise RecurringCostFrozen(
            "A frozen recurring cost cannot be edited. Unfreeze it first."
        )
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


def freeze_recurring_cost(session: Session, cost: RecurringCost) -> RecurringCost:
    """Freeze a Recurring Cost (ADR-0028): clean up unpaid/skipped
    Occurrences, stop generating new ones, mark it frozen. All links to
    Transactions survive intact. Freezing an already-frozen definition is
    a no-op (idempotent)."""
    if cost.frozen:
        return cost
    # Delete all skip rows for this definition.
    session.execute(
        sa_delete(RecurringSkip).where(RecurringSkip.recurring_cost_id == cost.id)
    )
    cost.frozen = True
    cost.freeze_date = rome_today()
    session.commit()
    session.refresh(cost)
    return cost


def unfreeze_recurring_cost(session: Session, cost: RecurringCost) -> RecurringCost:
    """Unfreeze a frozen Recurring Cost (ADR-0028): restore editability,
    resume Occurrence generation on the natural cycle. If the name collides
    with an existing active definition, reject. Unfreezing an active
    definition is a no-op, mirroring freeze's idempotency."""
    if not cost.frozen:
        return cost
    if scoping.name_is_taken(
        session, RecurringCost, cost.account_id, cost.name, exclude_id=cost.id
    ):
        raise RecurringCostNameTaken(cost.name)
    cost.frozen = False
    cost.freeze_date = None
    session.commit()
    session.refresh(cost)
    return cost
