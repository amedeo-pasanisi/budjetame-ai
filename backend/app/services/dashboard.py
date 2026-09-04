"""Dashboard reporting rules (T10, T11, T12) and the Budget card (issue
#65). Called by the HTTP layer; never from tests.

The Dashboard shows Net Worth — the algebraic sum of every Wallet balance —
and the reference month's category pies and trends, toggled between Expenses
and Incomes on the frontend. All bucketing happens in Europe/Rome, the
app's single fixed timezone (CONTEXT.md). Opening Balance Transactions never
count toward the statistics; Transfers are neither Income nor Expense, so
they never appear either. The Budget card (issue #65) is
fully derived, never stored: the service sums the month's Recurring Income
and Recurring Cost Occurrences into a Monthly Spendable (the pure walker in
app.recurrence owns the math, the pure arithmetic in app.budget the
allowances) and the Discretionary Expenses into the spent figure.
"""

import calendar
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import budget
from app.dates import Month, from_rome_day, rome_month_bounds, to_rome_month
from app.models import (
    Category,
    RecurringCost,
    RecurringIncome,
    RecurringSkip,
    Transaction,
    TransactionType,
)
from app.recurrence import occurrences_in_window, period_of, rome_today

from app.services.wallets import wallet_balances


def net_worth(session: Session, account_id: int) -> Decimal:
    """The algebraic sum of all Wallet balances (ADR-0001). Contact Wallets
    count — their balances are receivables/debts — and a frozen Wallet
    contributes its true Balance, €0 by ADR-0002."""
    return sum(wallet_balances(session, account_id).values(), Decimal("0.00"))


def month_income_expenses(
    session: Session, account_id: int, month: Month
) -> tuple[Decimal, Decimal]:
    """The Account's Income and Expense totals in the given Europe/Rome month.
    Opening Balance Transactions are excluded from the statistics (CONTEXT.md);
    Transfers are neither Income nor Expense so never appear. Returns
    `(income, expenses)` — both €0.00 when the month has none."""
    start, next_start = rome_month_bounds(month)
    rows = session.execute(
        select(Transaction.type, func.sum(Transaction.amount))
        .where(
            Transaction.account_id == account_id,
            Transaction.date >= start,
            Transaction.date < next_start,
            Transaction.type.in_(
                [TransactionType.INCOME.value, TransactionType.EXPENSE.value]
            ),
        )
        .group_by(Transaction.type)
    ).all()
    income = expenses = Decimal("0.00")
    for type_, total in rows:
        if type_ == TransactionType.INCOME.value:
            income = Decimal(total)
        else:
            expenses = Decimal(total)
    return income, expenses


def amounts_by_category(
    session: Session,
    account_id: int,
    month: Month,
    transaction_type: TransactionType,
) -> list[dict]:
    """One category pie (T11): one slice per Category for the given
    Europe/Rome month, largest first, of the month's Expenses (Expense) or
    Incomes (Income). Transactions whose Category was deleted group into an
    "Uncategorized" slice (category_id null — no stored color, the frontend
    renders a neutral one), so the slices always sum to the month's total for
    the pie's side (US26). Opening Balances and Transfers never appear — only
    the given type's Transactions are grouped."""
    start, next_start = rome_month_bounds(month)
    rows = session.execute(
        select(
            Transaction.category_id,
            func.sum(Transaction.amount),
            Category.name,
            Category.icon,
            Category.color,
        )
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(
            Transaction.account_id == account_id,
            Transaction.type == transaction_type.value,
            Transaction.date >= start,
            Transaction.date < next_start,
        )
        .group_by(Transaction.category_id, Category.name, Category.icon, Category.color)
        .order_by(
            func.sum(Transaction.amount).desc(), Transaction.category_id.nulls_last()
        )
    ).all()
    return [
        {
            "category_id": category_id,
            "name": name or "Uncategorized",
            "icon": icon,
            "color": color,
            "amount": Decimal(amount),
        }
        for category_id, amount, name, icon, color in rows
    ]


def month_trend(
    session: Session,
    account_id: int,
    from_month: Month,
    to_month: Month,
    transaction_type: TransactionType,
) -> list[dict]:
    """Monthly totals of the given Transaction type over the inclusive month
    range, oldest first, with a €0.00 bucket for every month in between so the
    chart is a true trend (US28, T12). Bucketing happens in Europe/Rome via
    `to_rome_month` — the app's single conversion boundary (CONTEXT.md); the
    other type, Opening Balances and Transfers never count."""
    start, _ = rome_month_bounds(from_month)
    _, end_exclusive = rome_month_bounds(to_month)
    rows = session.execute(
        select(Transaction.date, Transaction.amount).where(
            Transaction.account_id == account_id,
            Transaction.type == transaction_type.value,
            Transaction.date >= start,
            Transaction.date < end_exclusive,
        )
    ).all()
    totals: dict[Month, Decimal] = {}
    for transaction_date, amount in rows:
        bucket = to_rome_month(transaction_date)
        totals[bucket] = totals.get(bucket, Decimal("0.00")) + Decimal(amount)
    return [
        {"month": month.iso, "amount": totals.get(month, Decimal("0.00"))}
        for month in _month_range(from_month, to_month)
    ]


def _month_range(from_month: Month, to_month: Month) -> list[Month]:
    """Every Month from `from_month` to `to_month`, inclusive."""
    months: list[Month] = []
    month = from_month
    while month <= to_month:
        months.append(month)
        month = month.next()
    return months


def monthly_budget(session: Session, account_id: int) -> dict:
    """The Budget card (issue #65): the current Europe/Rome month's Monthly
    Spendable, Daily Allowance, and Spendable Today — deliberately no month
    parameter, the Budget is current-month-only by product decision.

    Everything derived, nothing stored (ADR-0001). Monthly Spendable sums
    the Recurring Income Occurrences due in the month minus the Recurring
    Cost Occurrences due in it, counted by due date whether paid or not — a
    late-paid Occurrence counts in its due month, not the payment month —
    with the 29–31 clamping, per the pure
    walker. Spendable Today is the allowance accrued from the 1st through
    today minus the Discretionary Expenses dated in that span: only Expense
    Transactions with no Recurring Cost link drain, and only once their date
    has arrived; one-off Incomes never fill, Transfers and Opening Balances
    never touch it.
    """
    month = Month.current()
    today = rome_today()
    first_day = date(month.year, month.month, 1)
    last_day = date(month.year, month.month, calendar.monthrange(month.year, month.month)[1])
    income, costs = _occurrence_totals(session, account_id, first_day, last_day)
    monthly_spendable = income - costs
    spent = _discretionary_spent(session, account_id, first_day, today)
    return {
        "month": month.iso,
        "monthly_spendable": monthly_spendable,
        "daily_allowance": budget.daily_allowance(monthly_spendable, month),
        "spendable_today": budget.spendable_today(
            monthly_spendable, month, today, spent
        ),
    }


def _occurrence_totals(
    session: Session, account_id: int, first_day: date, last_day: date
) -> tuple[Decimal, Decimal]:
    """The `(income, costs)` totals of the Occurrences due inside the
    month's window, summed per definition over the pure walker: every due
    date in `[first_day, last_day]` (both edges included), the amount once
    per due date, paid or not (issue #65)."""
    income_total = Decimal("0.00")
    cost_total = Decimal("0.00")
    for income in session.scalars(
        select(RecurringIncome).where(RecurringIncome.account_id == account_id)
    ).all():
        income_total += _due_amount(session, income, first_day, last_day)
    for cost in session.scalars(
        select(RecurringCost).where(RecurringCost.account_id == account_id)
    ).all():
        cost_total += _due_amount(session, cost, first_day, last_day)
    return income_total, cost_total


def _due_amount(
    session: Session,
    definition: RecurringCost | RecurringIncome,
    first_day: date,
    last_day: date,
) -> Decimal:
    """One definition's contribution to the Monthly Spendable: its amount
    per Occurrence due inside the window (an unset start date defaults to
    the start date, ADR-0024). A Skipped Occurrence never counts
    (ADR-0016): the user does not have to pay it, so the Budget must not
    pretend the money leaves (or arrives).

    The stored skip dates map through the current unit's period shape
    (`period_of`), so a skip travels with its Occurrence across definition
    edits — the Budget re-derives on every read, exactly like every other
    input (ADR-0001)."""
    if isinstance(definition, RecurringCost):
        stored = session.scalars(
            select(RecurringSkip.occurrence_date).where(
                RecurringSkip.recurring_cost_id == definition.id
            )
        ).all()
    else:
        stored = session.scalars(
            select(RecurringSkip.occurrence_date).where(
                RecurringSkip.recurring_income_id == definition.id
            )
        ).all()
    skipped = {period_of(value, definition.interval_unit) for value in stored}
    due_dates = occurrences_in_window(
        definition.start_date,
        definition.interval_value,
        definition.interval_unit,
        first_day,
        last_day,
        skipped,
    )
    return definition.amount * Decimal(len(due_dates))


def _discretionary_spent(
    session: Session, account_id: int, first_day: date, today: date
) -> Decimal:
    """The Discretionary Expenses dated from the 1st through today: Expense
    Transactions with no Recurring Cost link (CONTEXT.md) — the only thing
    that drains Spendable Today, and only once its date has arrived (an
    Expense dated later in the month doesn't drain until then)."""
    end_exclusive = from_rome_day((today + timedelta(days=1)).isoformat())
    total = session.scalar(
        select(func.sum(Transaction.amount)).where(
            Transaction.account_id == account_id,
            Transaction.type == TransactionType.EXPENSE.value,
            Transaction.recurring_cost_id.is_(None),
            Transaction.date >= from_rome_day(first_day.isoformat()),
            Transaction.date < end_exclusive,
        )
    )
    return total if total is not None else Decimal("0.00")
