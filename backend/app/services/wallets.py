"""Wallet business rules. Called by the HTTP layer; never from tests.

Every rule from CONTEXT.md that concerns Wallets and Opening Balances lives here:
name uniqueness (case-insensitive, per Account), the Opening Balance Transaction,
and the derived Balance (ADR-0001).
"""

from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Transaction, TransactionType, Wallet, WalletType


class WalletNameTaken(Exception):
    """A Wallet with this name (case-insensitive) already exists for the Account."""


def name_is_taken(
    session: Session, account_id: int, name: str, *, exclude_id: int | None = None
) -> bool:
    """True when another Wallet of the Account already has `name`, case-insensitively."""
    stmt = select(Wallet.id).where(
        Wallet.account_id == account_id,
        func.lower(Wallet.name) == func.lower(name),
    )
    if exclude_id is not None:
        stmt = stmt.where(Wallet.id != exclude_id)
    return session.scalar(stmt) is not None


def create_wallet(
    session: Session,
    account_id: int,
    *,
    name: str,
    type: WalletType,
    opening_balance: Decimal = Decimal("0.00"),
) -> Wallet:
    """Create a Wallet, seeding an Opening Balance Transaction when nonzero."""
    if name_is_taken(session, account_id, name):
        raise WalletNameTaken(name)
    wallet = Wallet(account_id=account_id, name=name, type=type.value)
    session.add(wallet)
    session.flush()
    if opening_balance > 0:
        session.add(
            Transaction(
                account_id=account_id,
                wallet_id=wallet.id,
                type=TransactionType.OPENING_BALANCE.value,
                amount=opening_balance,
            )
        )
    session.commit()
    session.refresh(wallet)
    return wallet


def rename_wallet(session: Session, wallet: Wallet, new_name: str) -> Wallet:
    """Rename a Wallet. The type can never change (no parameter for it)."""
    if name_is_taken(session, wallet.account_id, new_name, exclude_id=wallet.id):
        raise WalletNameTaken(new_name)
    wallet.name = new_name
    session.commit()
    session.refresh(wallet)
    return wallet


def _signed_amount():
    """SQL: the signed contribution of a Transaction to its Wallet's Balance.
    Income and Opening Balance add; Expense subtracts (ADR-0001). Transfers
    arrive with the ticket that introduces them."""
    return case(
        (Transaction.type == TransactionType.EXPENSE.value, -Transaction.amount),
        else_=Transaction.amount,
    )


def transaction_contribution(transaction: Transaction) -> Decimal:
    """The signed contribution of one Transaction to its Wallet's Balance."""
    if transaction.type == TransactionType.EXPENSE.value:
        return -transaction.amount
    return transaction.amount


def wallet_balances(session: Session, account_id: int) -> dict[int, Decimal]:
    """Map every Wallet id of the Account to its derived Balance (ADR-0001)."""
    rows = session.execute(
        select(
            Transaction.wallet_id,
            func.coalesce(func.sum(_signed_amount()), Decimal("0.00")),
        )
        .where(Transaction.account_id == account_id)
        .group_by(Transaction.wallet_id)
    ).all()
    return {wallet_id: Decimal(amount) for wallet_id, amount in rows}


def wallet_balance(session: Session, account_id: int, wallet_id: int) -> Decimal:
    """The derived Balance of one Wallet, read at call time."""
    amount = session.scalar(
        select(func.coalesce(func.sum(_signed_amount()), Decimal("0.00"))).where(
            Transaction.account_id == account_id,
            Transaction.wallet_id == wallet_id,
        )
    )
    return Decimal(amount)

