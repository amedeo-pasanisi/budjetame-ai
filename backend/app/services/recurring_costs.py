"""Recurring Cost business rules (issue #56). Called by the HTTP layer; never
from tests.

Rules from CONTEXT.md and ADR-0010: names unique per Account,
case-insensitively; creation only on active, non-Contact Wallets (costs
behave like Expenses); an optional expense-only Category; an optional start
date defaulting to the creation date; an optional due-date override whose
shape follows the interval unit (day-of-month for months, month+day for
years, none for days/weeks). Occurrences and the next due date are derived,
never stored — the pure recurrence module (app.recurrence) owns that math.
Deleting a Recurring Cost is a hard delete; linked Expenses (issue #57) are
severed by the FK's ON DELETE SET NULL.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.models import Category, CategoryType, IntervalUnit, RecurringCost, Wallet, WalletType
from app.recurrence import next_due_date, rome_day_of, rome_today
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


def _ensure_wallet(session: Session, account_id: int, wallet_id: int) -> None:
    """The Wallet must belong to the Account (foreign data is
    indistinguishable from absent data — scoping raises NotOwned, mapped to
    403 by the HTTP layer) and be active and non-Contact: costs behave like
    Expenses (CONTEXT.md)."""
    wallet = scoping.owned_or_raise(session, Wallet, account_id, wallet_id)
    if wallet.frozen:
        raise RecurringCostRuleError("A Recurring Cost's Wallet must be active")
    if wallet.type == WalletType.CONTACT.value:
        raise RecurringCostRuleError("Recurring Costs cannot use Contact Wallets")


def _ensure_category(session: Session, account_id: int, category_id: int | None) -> None:
    """The optional Category must belong to the Account and be expense-only:
    Recurring Costs are expense-side only (CONTEXT.md)."""
    if category_id is None:
        return
    category = scoping.owned_or_raise(session, Category, account_id, category_id)
    if category.type != CategoryType.EXPENSE.value:
        raise RecurringCostRuleError(
            "A Recurring Cost's Category must be expense-only"
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
    wallet_id: int,
    category_id: int | None,
    interval_value: int,
    interval_unit: IntervalUnit,
    start_date: str | None,
    due_day: int | None,
    due_month: int | None,
) -> RecurringCost:
    if scoping.name_is_taken(session, RecurringCost, account_id, name):
        raise RecurringCostNameTaken(name)
    _ensure_wallet(session, account_id, wallet_id)
    _ensure_category(session, account_id, category_id)
    _validate_override(interval_unit.value, due_day, due_month)
    cost = RecurringCost(
        account_id=account_id,
        name=name,
        amount=amount,
        wallet_id=wallet_id,
        category_id=category_id,
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
    if "wallet_id" in changes:
        if changes["wallet_id"] is None:
            raise RecurringCostRuleError("wallet_id is required")
        _ensure_wallet(session, cost.account_id, changes["wallet_id"])
    if "category_id" in changes:
        _ensure_category(session, cost.account_id, changes["category_id"])

    for field in ("name", "amount", "wallet_id", "category_id", "interval_value", "due_day", "due_month"):
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
    ordinary Expenses: the link FK is ON DELETE SET NULL, per ADR-0010."""
    session.delete(cost)
    session.commit()


def next_due_date_for(cost: RecurringCost) -> date:
    """The cost's next due date, derived on the fly (ADR-0010): the first
    Occurrence — from the start date (or the creation date when unset) plus
    the interval, clamped — whose due date (override applied) is today or
    later in Europe/Rome."""
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
    )
