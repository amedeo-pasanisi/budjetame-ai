"""Recurring Income business rules (issue #60). Called by the HTTP layer;
never from tests.

The mirror of the Recurring Cost service (ADR-0011): the same rules, income
side. Names unique per Account, case-insensitively; creation only on active,
non-Contact Wallets (incomes behave like Income Transactions); an optional
income-only Category; an optional start date defaulting to the creation
date; an optional due-date override whose shape follows the interval unit
(day-of-month for months, month+day for years, none for days/weeks).
Occurrences and the next due date are derived, never stored — the pure
recurrence module (app.recurrence) owns that math, reused unchanged.
Deleting a Recurring Income is a hard delete (issue #60); linked Incomes
(issue #61) are severed by the FK's ON DELETE SET NULL. The paid state also
lives here: `paid_occurrence_dates` is the set of Occurrences the income's
links cover and `oldest_unpaid_occurrence` the one a new link pays (the
oldest Unpaid, future Occurrences included — receiving ahead) — what the
transaction form's picker shows as `next_unpaid_occurrence_date` in the API
view. The Backlog (issue #62) is derived on the fly from the definition and
the stored pins: `backlog_count_for` counts Unpaid Occurrences whose due
date is today or earlier in Europe/Rome, mirroring the cost side (issue
#58, ADR-0011).
"""

from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    Category,
    CategoryType,
    IntervalUnit,
    RecurringIncome,
    Transaction,
    Wallet,
    WalletType,
)
from app.recurrence import (
    backlog_count,
    next_due_date,
    occurrence_date,
    rome_day_of,
    rome_today,
)
from app.services import scoping


class RecurringIncomeNameTaken(Exception):
    """A Recurring Income with this name (case-insensitive) already exists
    for the Account."""


class RecurringIncomeRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _validate_override(
    unit: str, due_day: int | None, due_month: int | None
) -> None:
    """The due-date override follows the interval unit (ADR-0010, shared with
    Recurring Costs): none for day/week intervals, a day-of-month alone for
    months, a month+day pair for years."""
    if unit in (IntervalUnit.DAYS.value, IntervalUnit.WEEKS.value):
        if due_day is not None or due_month is not None:
            raise RecurringIncomeRuleError(
                "Day and week intervals never carry a due-date override"
            )
    elif unit == IntervalUnit.MONTHS.value:
        if due_month is not None:
            raise RecurringIncomeRuleError(
                "Month intervals carry a day-of-month override only"
            )
    else:  # years
        if (due_day is None) != (due_month is None):
            raise RecurringIncomeRuleError(
                "Year intervals carry a month+day override"
            )


def _ensure_wallet(session: Session, account_id: int, wallet_id: int) -> None:
    """The Wallet must belong to the Account (foreign data is
    indistinguishable from absent data — scoping raises NotOwned, mapped to
    403 by the HTTP layer) and be active and non-Contact: incomes behave like
    Income Transactions (CONTEXT.md)."""
    wallet = scoping.owned_or_raise(session, Wallet, account_id, wallet_id)
    if wallet.frozen:
        raise RecurringIncomeRuleError("A Recurring Income's Wallet must be active")
    if wallet.type == WalletType.CONTACT.value:
        raise RecurringIncomeRuleError("Recurring Incomes cannot use Contact Wallets")


def _ensure_category(
    session: Session, account_id: int, category_id: int | None
) -> None:
    """The optional Category must belong to the Account and be income-only:
    Recurring Incomes are income-side only (CONTEXT.md)."""
    if category_id is None:
        return
    category = scoping.owned_or_raise(session, Category, account_id, category_id)
    if category.type != CategoryType.INCOME.value:
        raise RecurringIncomeRuleError(
            "A Recurring Income's Category must be income-only"
        )


def _parse_start_date(value: str | None) -> date | None:
    """The start date as a Europe/Rome calendar day (the schema validated the
    "YYYY-MM-DD" shape), or None — meaning the creation date."""
    return date.fromisoformat(value) if value is not None else None


def create_recurring_income(
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
) -> RecurringIncome:
    if scoping.name_is_taken(session, RecurringIncome, account_id, name):
        raise RecurringIncomeNameTaken(name)
    _ensure_wallet(session, account_id, wallet_id)
    _ensure_category(session, account_id, category_id)
    _validate_override(interval_unit.value, due_day, due_month)
    income = RecurringIncome(
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
    session.add(income)
    session.commit()
    session.refresh(income)
    return income


def update_recurring_income(
    session: Session, income: RecurringIncome, *, changes: dict
) -> RecurringIncome:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is
    applied even when null (clearing the optional field); a field absent is
    untouched. The guards judge the resulting definition — an override left
    stale by a unit change is rejected, not silently dropped."""
    unit = (
        changes["interval_unit"].value
        if "interval_unit" in changes
        else income.interval_unit
    )
    due_day = changes["due_day"] if "due_day" in changes else income.due_day
    due_month = changes["due_month"] if "due_month" in changes else income.due_month
    _validate_override(unit, due_day, due_month)

    name = changes.get("name", income.name)
    if name is not None and name != income.name:
        if scoping.name_is_taken(
            session, RecurringIncome, income.account_id, name, exclude_id=income.id
        ):
            raise RecurringIncomeNameTaken(name)
    if "wallet_id" in changes:
        if changes["wallet_id"] is None:
            raise RecurringIncomeRuleError("wallet_id is required")
        _ensure_wallet(session, income.account_id, changes["wallet_id"])
    if "category_id" in changes:
        _ensure_category(session, income.account_id, changes["category_id"])

    for field in ("name", "amount", "wallet_id", "category_id", "interval_value", "due_day", "due_month"):
        if field in changes:
            setattr(income, field, changes[field])
    if "interval_unit" in changes:
        income.interval_unit = changes["interval_unit"].value
    if "start_date" in changes:
        income.start_date = _parse_start_date(changes["start_date"])

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


def next_due_date_for(income: RecurringIncome) -> date:
    """The income's next due date, derived on the fly (ADR-0010): the first
    Occurrence — from the start date (or the creation date when unset) plus
    the interval, clamped — whose due date (override applied) is today or
    later in Europe/Rome. The pure recurrence module owns the math, shared
    unchanged with Recurring Costs (ADR-0011)."""
    start = (
        income.start_date
        if income.start_date is not None
        else rome_day_of(income.created_at)
    )
    return next_due_date(
        start,
        income.interval_value,
        income.interval_unit,
        income.due_day,
        income.due_month,
        rome_today(),
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
    its own date is not covered by a linked Income: the pins are stored
    (issue #61), so editing the interval or start date reshapes only the
    derived future — an Occurrence a link covers is never counted back in.
    The pure recurrence module owns the boundary math, shared unchanged
    with Recurring Costs (ADR-0011)."""
    paid = paid_occurrence_dates(session, income.id)
    start = (
        income.start_date
        if income.start_date is not None
        else rome_day_of(income.created_at)
    )
    return backlog_count(
        start,
        income.interval_value,
        income.interval_unit,
        income.due_day,
        income.due_month,
        rome_today(),
        paid,
    )


def oldest_unpaid_occurrence(
    session: Session,
    income: RecurringIncome,
    *,
    exclude_transaction_id: int | None = None,
) -> date:
    """The Occurrence a new link pays (issue #61): the oldest Unpaid one —
    the first of the derived sequence (from the start date, or the creation
    date when unset, plus the interval) no linked Income covers. Future
    Occurrences are included when nothing earlier is Unpaid, so receiving
    early is natural; the sequence is infinite and the paid set finite, so
    the walk always terminates. The pin is stored on the link at this moment
    and never recomputed (ADR-0010/0011)."""
    paid = paid_occurrence_dates(
        session, income.id, exclude_transaction_id=exclude_transaction_id
    )
    start = (
        income.start_date
        if income.start_date is not None
        else rome_day_of(income.created_at)
    )
    k = 0
    while True:
        occurrence = occurrence_date(
            start, income.interval_value, income.interval_unit, k
        )
        if occurrence not in paid:
            return occurrence
        k += 1
