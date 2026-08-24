"""The Recurring Incomes resource (issue #60): definitions of incomes that
repeat at a fixed interval, mirroring Recurring Costs (ADR-0011). The list
exposes each income's next due date, derived on the fly (ADR-0010); the
screen sorts by it. The Backlog and the Overdue flag (issue #62) ride on
the list too, mirroring #58: the "N unpaid" badge the Incomes side shows
comes from here. Guards: names unique per Account case-insensitively; all
data scoped to the Account (foreign data is a 403, ADR-0003)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, IntervalUnit, RecurringIncome
from app.schemas import (
    RecurringIncomeCreate,
    RecurringIncomeOut,
    RecurringIncomeUpdate,
)
from app.services import recurring_incomes as recurring_service
from app.services import scoping

router = APIRouter(prefix="/recurring-incomes", tags=["recurring-incomes"])


def _owned_income_or_403(
    session: Session, account: Account, income_id: int
) -> RecurringIncome:
    """The Account's Recurring Income, or 403 — including for incomes that
    don't exist, so foreign data is never distinguishable from absent data
    (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, RecurringIncome, account.id, income_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Recurring Income not found") from None


def _income_out(session: Session, income: RecurringIncome) -> RecurringIncomeOut:
    """The API view of a Recurring Income, with the derived state: the next
    due date (override applied, clamping included — the pure recurrence
    module owns that math), the next Unpaid Occurrence date (issue #61):
    the one a new linked Income would pay, what the transaction form's
    picker shows — the Backlog (issue #62): Unpaid Occurrences due today or
    earlier in Europe/Rome, with the Overdue flag — and `next_skip_action`,
    what the Skip/Un-skip button reads (ADR-0016)."""
    backlog = recurring_service.backlog_count_for(session, income)
    return RecurringIncomeOut(
        id=income.id,
        name=income.name,
        amount=income.amount,
        interval_value=income.interval_value,
        interval_unit=IntervalUnit(income.interval_unit),
        start_date=income.start_date.isoformat() if income.start_date is not None else None,
        due_day=income.due_day,
        due_month=income.due_month,
        next_due_date=recurring_service.next_due_date_for(session, income).isoformat(),
        next_unpaid_occurrence_date=recurring_service.oldest_unpaid_occurrence(
            session, income
        ).isoformat(),
        backlog_count=backlog,
        overdue=backlog > 0,
        next_skip_action=recurring_service.next_skip_action(session, income),
        created_at=income.created_at,
    )


def _name_conflict(session: Session, cause: Exception) -> None:
    """Map a duplicate-name failure to 409 — from the pre-check or the unique
    index under a race — after rolling back the aborted transaction."""
    session.rollback()
    raise HTTPException(
        status_code=409,
        detail="A Recurring Income with this name already exists",
    ) from cause


@router.get("", response_model=list[RecurringIncomeOut])
def list_recurring_incomes(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[RecurringIncomeOut]:
    """Every Recurring Income of the Account, sorted by next due date
    ascending (ties by name) — the one order the Recurring screen needs."""
    incomes = session.scalars(
        select(RecurringIncome).where(RecurringIncome.account_id == account.id)
    ).all()
    return sorted(
        (_income_out(session, income) for income in incomes),
        key=lambda out: (out.next_due_date, out.name.lower()),
    )


@router.post("", response_model=RecurringIncomeOut, status_code=201)
def create_recurring_income(
    payload: RecurringIncomeCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> RecurringIncomeOut:
    try:
        income = recurring_service.create_recurring_income(
            session,
            account.id,
            name=payload.name,
            amount=payload.amount,
            interval_value=payload.interval_value,
            interval_unit=payload.interval_unit,
            start_date=payload.start_date,
            due_day=payload.due_day,
            due_month=payload.due_month,
        )
    except recurring_service.RecurringIncomeRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (recurring_service.RecurringIncomeNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    return _income_out(session, income)


@router.post("/{income_id}/skip-toggle", response_model=RecurringIncomeOut)
def toggle_recurring_income_skip(
    income_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> RecurringIncomeOut:
    """The Skip/Un-skip button (ADR-0016), mirroring the cost side: skip
    the oldest Unpaid, un-Skipped Occurrence; once the whole Backlog is
    excused, un-skip the oldest Skipped one instead. The response is the
    refreshed definition with its derived state."""
    income = _owned_income_or_403(session, account, income_id)
    income = recurring_service.toggle_skip(session, income)
    return _income_out(session, income)


@router.patch("/{income_id}", response_model=RecurringIncomeOut)
def update_recurring_income(
    income_id: int,
    payload: RecurringIncomeUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> RecurringIncomeOut:
    income = _owned_income_or_403(session, account, income_id)
    try:
        income = recurring_service.update_recurring_income(
            session,
            income,
            changes=payload.model_dump(exclude_unset=True),
        )
    except recurring_service.RecurringIncomeRuleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (recurring_service.RecurringIncomeNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    return _income_out(session, income)


@router.delete("/{income_id}", status_code=204)
def delete_recurring_income(
    income_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> None:
    income = _owned_income_or_403(session, account, income_id)
    recurring_service.delete_recurring_income(session, income)
