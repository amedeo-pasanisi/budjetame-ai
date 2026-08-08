"""Transaction business rules. Called by the HTTP layer; never from tests.

Rules from CONTEXT.md: Expense/Income reference one Wallet of the Account;
Transfers reference Source and Destination Wallets that must differ, never
carry a Category, and never change Net Worth; Cash negativity is allowed but
warned (the indicator is computed at the HTTP layer from the derived Balance);
Contact Wallets only participate in Transfers; a Category attaches only to
Transactions of its Type; Opening Balance Transactions are created by the
Wallet lifecycle and are read-only here.
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dates import from_rome_day
from app.models import Category, Transaction, TransactionType, Wallet, WalletType


class NotOwned(Exception):
    """A referenced Wallet, Category, or Transaction belongs to another Account."""


class TransactionRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _owned_wallet_or_raise(session: Session, account_id: int, wallet_id: int) -> Wallet:
    wallet = session.get(Wallet, wallet_id)
    if wallet is None or wallet.account_id != account_id:
        raise NotOwned()
    return wallet


def _owned_category_or_raise(
    session: Session, account_id: int, category_id: int
) -> Category:
    category = session.get(Category, category_id)
    if category is None or category.account_id != account_id:
        raise NotOwned()
    return category


def _ensure_wallet_writable(wallet: Wallet) -> None:
    """Raise when the Wallet is frozen (ADR-0002): no new Transactions can be
    created on it and its existing Transactions can neither be edited nor
    deleted."""
    if wallet.frozen:
        raise TransactionRuleError("Frozen Wallets are read-only")


def _locked_wallet(session: Session, wallet_id: int) -> Wallet:
    """The Wallet row locked FOR UPDATE, so that writes on it serialize with a
    concurrent freeze (whose Balance check must not see a stale sum)."""
    wallet = session.scalar(
        select(Wallet).where(Wallet.id == wallet_id).with_for_update()
    )
    # A Transaction's Wallet always exists: wallets are never hard-deleted
    # (ADR-0002), and every write validates ownership first.
    assert wallet is not None
    return wallet


def _locked_wallets(session: Session, *wallet_ids: int) -> dict[int, Wallet]:
    """The given Wallet rows, each locked FOR UPDATE. Locks are taken in
    ascending id order so two concurrent Transfers in opposite directions lock
    the same order and cannot deadlock."""
    return {wallet_id: _locked_wallet(session, wallet_id) for wallet_id in sorted(wallet_ids)}


def _transfer_legs(transaction: Transaction) -> tuple[int, int]:
    """The Source and Destination Wallet ids of a Transfer row (both are always
    set by `create_transaction`)."""
    if transaction.source_wallet_id is None or transaction.destination_wallet_id is None:
        raise TransactionRuleError("Transfers need source and destination Wallets")
    return transaction.source_wallet_id, transaction.destination_wallet_id


def _ensure_transaction_wallets_writable(
    session: Session, transaction: Transaction
) -> None:
    """Lock the Wallet(s) a write touches and raise when any is frozen
    (ADR-0002). A Transfer locks both legs in ascending id order; anything else
    locks its single Wallet. The lock also serializes the write against a
    concurrent freeze (whose Balance check must not see a stale sum)."""
    if transaction.type == TransactionType.TRANSFER.value:
        wallets = _locked_wallets(session, *_transfer_legs(transaction))
    else:
        assert transaction.wallet_id is not None  # Expense/Income always have one
        wallets = {transaction.wallet_id: _locked_wallet(session, transaction.wallet_id)}
    for wallet in wallets.values():
        _ensure_wallet_writable(wallet)

def _check_category_matches(session: Session, account_id: int, category_id: int, type: str) -> None:
    category = _owned_category_or_raise(session, account_id, category_id)
    if category.type != type:
        raise TransactionRuleError(
            "A Category attaches only to Transactions of its Type"
        )


def create_transaction(
    session: Session,
    account_id: int,
    *,
    type: str,
    amount: Decimal,
    date: str,
    wallet_id: int | None = None,
    source_wallet_id: int | None = None,
    destination_wallet_id: int | None = None,
    category_id: int | None = None,
    description: str | None = None,
    latitude: Decimal | None = None,
    longitude: Decimal | None = None,
) -> Transaction:
    if type == TransactionType.TRANSFER.value:
        if source_wallet_id is None or destination_wallet_id is None:
            raise TransactionRuleError("Transfers need source and destination Wallets")
        source = _owned_wallet_or_raise(session, account_id, source_wallet_id)
        destination = _owned_wallet_or_raise(session, account_id, destination_wallet_id)
        if source.id == destination.id:
            raise TransactionRuleError(
                "Source and Destination must be different Wallets"
            )
        wallets = _locked_wallets(session, source.id, destination.id)
        for wallet in wallets.values():
            _ensure_wallet_writable(wallet)
        transaction = Transaction(
            account_id=account_id,
            type=type,
            amount=amount,
            date=from_rome_day(date),
            source_wallet_id=source_wallet_id,
            destination_wallet_id=destination_wallet_id,
            description=description,
            latitude=latitude,
            longitude=longitude,
        )
    else:
        if wallet_id is None:
            raise TransactionRuleError("wallet_id is required for Expense and Income")
        wallet = _owned_wallet_or_raise(session, account_id, wallet_id)
        wallet = _locked_wallet(session, wallet.id)
        _ensure_wallet_writable(wallet)
        if wallet.type == WalletType.CONTACT.value:
            raise TransactionRuleError(
                "Contact Wallets only participate in Transfers"
            )
        if category_id is not None:
            _check_category_matches(session, account_id, category_id, type)
        transaction = Transaction(
            account_id=account_id,
            wallet_id=wallet_id,
            type=type,
            amount=amount,
            date=from_rome_day(date),
            category_id=category_id,
            description=description,
            latitude=latitude,
            longitude=longitude,
        )
    session.add(transaction)
    session.commit()
    session.refresh(transaction)
    return transaction


def update_transaction(
    session: Session, account_id: int, transaction: Transaction, *, changes: dict
) -> Transaction:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is applied
    even when its value is null (clearing the optional field); a field absent
    from the payload is untouched."""
    if transaction.type == TransactionType.OPENING_BALANCE.value:
        raise TransactionRuleError("Opening Balance Transactions are read-only")

    _ensure_transaction_wallets_writable(session, transaction)

    if transaction.type == TransactionType.TRANSFER.value:
        if "category_id" in changes:
            raise TransactionRuleError("Transfers never carry a Category")
    elif "category_id" in changes:
        category_id = changes["category_id"]
        if category_id is not None:
            _check_category_matches(
                session, account_id, category_id, transaction.type
            )
        transaction.category_id = category_id
    if "amount" in changes:
        transaction.amount = changes["amount"]
    if "date" in changes:
        transaction.date = from_rome_day(changes["date"])
    if "description" in changes:
        transaction.description = changes["description"]
    if "latitude" in changes or "longitude" in changes:
        latitude, longitude = changes.get("latitude"), changes.get("longitude")
        if (latitude is None) != (longitude is None):
            raise TransactionRuleError(
                "latitude and longitude must be set together"
            )
        transaction.latitude = latitude
        transaction.longitude = longitude

    session.commit()
    session.refresh(transaction)
    return transaction


def delete_transaction(session: Session, transaction: Transaction) -> None:
    if transaction.type == TransactionType.OPENING_BALANCE.value:
        raise TransactionRuleError("Opening Balance Transactions are read-only")
    _ensure_transaction_wallets_writable(session, transaction)
    session.delete(transaction)
    session.commit()
