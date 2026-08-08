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


class WalletNotFreezable(Exception):
    """The Wallet's Balance is not exactly €0, so it cannot be frozen (ADR-0002)."""


class FrozenWallet(Exception):
    """A write was attempted on a frozen Wallet (ADR-0002)."""


class ContactWalletOpeningBalance(Exception):
    """Contact Wallets start at €0: money moves in and out only via Transfers."""


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
    """Create a Wallet, seeding an Opening Balance Transaction when nonzero.
    Contact Wallets start at €0: an Opening Balance would put money into them
    without a Transfer, breaking "money moves only via Transfers" (CONTEXT.md)."""
    if type == WalletType.CONTACT and opening_balance > 0:
        raise ContactWalletOpeningBalance()
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
    """Rename a Wallet. The type can never change (no parameter for it), and a
    frozen Wallet is read-only (ADR-0002)."""
    if wallet.frozen:
        raise FrozenWallet()
    if name_is_taken(session, wallet.account_id, new_name, exclude_id=wallet.id):
        raise WalletNameTaken(new_name)
    wallet.name = new_name
    session.commit()
    session.refresh(wallet)
    return wallet


def freeze_wallet(session: Session, wallet: Wallet) -> Wallet:
    """Freeze (delete) a Wallet at Balance exactly €0 (ADR-0002). The Wallet and
    its Transactions stay in the database; every write against it is rejected
    afterwards, so its Balance stays €0 and Net Worth is unaffected. Freezing an
    already-frozen Wallet is a no-op (idempotent).

    The Balance check and the flag are set under a row lock on the Wallet, so a
    concurrent Transaction write cannot commit between them and freeze a Wallet
    at a nonzero Balance."""
    locked = session.scalar(
        select(Wallet).where(Wallet.id == wallet.id).with_for_update()
    )
    assert locked is not None
    if wallet_balance(session, locked.account_id, locked.id) != 0:
        raise WalletNotFreezable(
            "Only a Wallet with balance exactly €0.00 can be frozen"
        )
    locked.frozen = True
    session.commit()
    session.refresh(locked)
    return locked


def _balance_ledger(account_id: int):
    """The derived-Balance ledger (ADR-0001): one row per (wallet, signed
    amount). Regular rows contribute through `wallet_id` (Expense subtracts,
    Income and Opening Balance add); a Transfer expands into two legs — its
    Source subtracts and its Destination adds — so Net Worth never changes."""
    regular = select(
        Transaction.wallet_id.label("wallet_id"),
        case(
            (Transaction.type == TransactionType.EXPENSE.value, -Transaction.amount),
            else_=Transaction.amount,
        ).label("amount"),
    ).where(
        Transaction.account_id == account_id,
        Transaction.type != TransactionType.TRANSFER.value,
    )
    source_leg = select(
        Transaction.source_wallet_id.label("wallet_id"),
        (-Transaction.amount).label("amount"),
    ).where(
        Transaction.account_id == account_id,
        Transaction.type == TransactionType.TRANSFER.value,
    )
    destination_leg = select(
        Transaction.destination_wallet_id.label("wallet_id"),
        Transaction.amount.label("amount"),
    ).where(
        Transaction.account_id == account_id,
        Transaction.type == TransactionType.TRANSFER.value,
    )
    return regular.union_all(source_leg, destination_leg).subquery()


def wallet_balances(session: Session, account_id: int) -> dict[int, Decimal]:
    """Map every Wallet id of the Account to its derived Balance (ADR-0001)."""
    ledger = _balance_ledger(account_id)
    rows = session.execute(
        select(
            ledger.c.wallet_id,
            func.coalesce(func.sum(ledger.c.amount), Decimal("0.00")),
        ).group_by(ledger.c.wallet_id)
    ).all()
    return {wallet_id: Decimal(amount) for wallet_id, amount in rows}


def wallet_balance(session: Session, account_id: int, wallet_id: int) -> Decimal:
    """The derived Balance of one Wallet, read at call time."""
    ledger = _balance_ledger(account_id)
    amount = session.scalar(
        select(func.coalesce(func.sum(ledger.c.amount), Decimal("0.00"))).where(
            ledger.c.wallet_id == wallet_id
        )
    )
    return Decimal(amount)

