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
from app.models import Transaction, TransactionType

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
