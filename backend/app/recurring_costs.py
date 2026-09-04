"""The Recurring Costs resource (issue #56): definitions of costs that repeat
at a fixed interval. The list exposes each cost's next due date, derived on
the fly (ADR-0010); the screen sorts by it."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, IntervalUnit, RecurringCost
from app.schemas import (
    RecurringCostCreate,
    RecurringCostOut,
    RecurringCostUpdate,
    RecurringOccurrenceOut,
    RecurringOccurrenceUpdate,
)
from app.services import recurring_costs as recurring_service
from app.services import scoping

router = APIRouter(prefix="/recurring-costs", tags=["recurring-costs"])


def _owned_cost_or_403(
    session: Session, account: Account, cost_id: int
) -> RecurringCost:
    """The Account's Recurring Cost, or 403 — including for costs that don't
    exist, so foreign data is never distinguishable from absent data
    (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, RecurringCost, account.id, cost_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Recurring Cost not found") from None


def _cost_out(session: Session, cost: RecurringCost) -> RecurringCostOut:
    """The API view of a Recurring Cost, with the derived state: the next
    due date (ADR-0024: an Occurrence's due date is its own date — the pure
    recurrence module owns the math), the next Unpaid Occurrence date
    (issue #57): the
    one a new linked Expense would pay, what the transaction form's picker
    shows — and the Backlog (issue #58): Unpaid Occurrences due today or
    earlier in Europe/Rome. Skip controls live per Occurrence on the
    Occurrences read (ADR-0026), not on the definition."""
    backlog = recurring_service.backlog_count_for(session, cost)
    return RecurringCostOut(
        id=cost.id,
        name=cost.name,
        amount=cost.amount,
        interval_value=cost.interval_value,
        interval_unit=IntervalUnit(cost.interval_unit),
        start_date=cost.start_date.isoformat(),
        next_due_date=recurring_service.next_due_date_for(session, cost).isoformat(),
        next_unpaid_occurrence_date=recurring_service.oldest_unpaid_occurrence(
            session, cost
        ).isoformat(),
        backlog_count=backlog,
        created_at=cost.created_at,
    )


def _name_conflict(session: Session, cause: Exception) -> None:
    """Map a duplicate-name failure to 409 — from the pre-check or the unique
    index under a race — after rolling back the aborted transaction."""
    session.rollback()
    raise HTTPException(
        status_code=409,
        detail="A Recurring Cost with this name already exists",
    ) from cause


@router.get("", response_model=list[RecurringCostOut])
def list_recurring_costs(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[RecurringCostOut]:
    """Every Recurring Cost of the Account, sorted by next due date ascending
    (ties by name) — the one order the Recurring screen needs."""
    costs = session.scalars(
        select(RecurringCost).where(RecurringCost.account_id == account.id)
    ).all()
    return sorted(
        (_cost_out(session, cost) for cost in costs),
        key=lambda out: (out.next_due_date, out.name.lower()),
    )


@router.post("", response_model=RecurringCostOut, status_code=201)
def create_recurring_cost(
    payload: RecurringCostCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> RecurringCostOut:
    try:
        cost = recurring_service.create_recurring_cost(
            session,
            account.id,
            name=payload.name,
            amount=payload.amount,
            interval_value=payload.interval_value,
            interval_unit=payload.interval_unit,
            start_date=payload.start_date,
        )
    except recurring_service.RecurringCostRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (recurring_service.RecurringCostNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    return _cost_out(session, cost)


def _occurrences_out(
    session: Session, cost: RecurringCost
) -> list[RecurringOccurrenceOut]:
    """The Occurrences section's rows as the API view: the read's (date,
    skipped) pairs newest first (ADR-0026). Both the read and the skip
    write answer with exactly this list."""
    return [
        RecurringOccurrenceOut(date=value.isoformat(), skipped=skipped)
        for value, skipped in recurring_service.occurrence_states(session, cost)
    ]


@router.get("/{cost_id}/occurrences", response_model=list[RecurringOccurrenceOut])
def list_recurring_cost_occurrences(
    cost_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[RecurringOccurrenceOut]:
    """The Occurrences section's read (ADR-0026): every non-Paid
    Occurrence of the cost — its own date and whether the user excused it —
    newest first, the one order the edit modal renders: the next incoming
    Unpaid row on top, then every excused future row, then the past rows
    (today first) down to the oldest. Paid history lives in the ledger and
    never appears here. The response is the section's whole state: each row
    carries exactly what its Skip/Un-skip button needs."""
    cost = _owned_cost_or_403(session, account, cost_id)
    return _occurrences_out(session, cost)


@router.put(
    "/{cost_id}/occurrences/{occurrence_date}",
    response_model=list[RecurringOccurrenceOut],
)
def set_recurring_cost_occurrence_skipped(
    cost_id: int,
    occurrence_date: str,
    payload: RecurringOccurrenceUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[RecurringOccurrenceOut]:
    """The per-Occurrence skip write (ADR-0026): PUT the Occurrence's date
    with {"skipped": true} to excuse it, {"skipped": false} to restore it.
    Every row toggles independently, in any order — the card button's
    queue discipline is gone. A paid Occurrence (or a date that is not one
    of the cost's Occurrences) rejects the skip with 422. The response is
    the refreshed read, so the modal swaps its rows in without a second
    fetch."""
    cost = _owned_cost_or_403(session, account, cost_id)
    try:
        recurring_service.set_occurrence_skipped(
            session,
            cost,
            occurrence_date,
            skipped=payload.skipped,
        )
    except recurring_service.RecurringCostRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return _occurrences_out(session, cost)


@router.patch("/{cost_id}", response_model=RecurringCostOut)
def update_recurring_cost(
    cost_id: int,
    payload: RecurringCostUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> RecurringCostOut:
    cost = _owned_cost_or_403(session, account, cost_id)
    try:
        cost = recurring_service.update_recurring_cost(
            session,
            cost,
            changes=payload.model_dump(exclude_unset=True),
        )
    except recurring_service.RecurringCostRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (recurring_service.RecurringCostNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    return _cost_out(session, cost)


@router.delete("/{cost_id}", status_code=204)
def delete_recurring_cost(
    cost_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> None:
    cost = _owned_cost_or_403(session, account, cost_id)
    recurring_service.delete_recurring_cost(session, cost)
