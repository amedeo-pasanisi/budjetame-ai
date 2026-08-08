"""Dashboard reporting rules (T10). Called by the HTTP layer; never from tests.

The Dashboard shows Net Worth — the algebraic sum of every Wallet balance —
and the current month's Income vs Expenses. All bucketing happens in
Europe/Rome, the app's single fixed timezone (CONTEXT.md). Opening Balance
Transactions never count toward the statistics; Transfers are neither Income
nor Expense, so they never appear either.
"""

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dates import rome_month_bounds
from app.models import Category, Transaction, TransactionType

from app.services.wallets import wallet_balances


def net_worth(session: Session, account_id: int) -> Decimal:
    """The algebraic sum of all Wallet balances (ADR-0001). Contact Wallets
    count — their balances are receivables/debts — and a frozen Wallet
    contributes its true Balance, €0 by ADR-0002."""
    return sum(wallet_balances(session, account_id).values(), Decimal("0.00"))


def month_income_expenses(
    session: Session, account_id: int, month: str
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


def expenses_by_category(
    session: Session, account_id: int, month: str
) -> list[dict]:
    """The expense pie (T11): one slice per Category for the given Europe/Rome
    month, largest first. Expenses whose Category was deleted group into an
    "Uncategorized" slice (category_id null — no stored color, the frontend
    renders a neutral one), so the slices always sum to the month's total
    expenses (US26). Income, Opening Balances and Transfers never appear —
    only Expense Transactions are grouped."""
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
            Transaction.type == TransactionType.EXPENSE.value,
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
