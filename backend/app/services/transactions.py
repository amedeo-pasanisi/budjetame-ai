"""Expense/Income Transaction business rules. Called by the HTTP layer; never
from tests.

Rules from CONTEXT.md: Expense/Income reference one Wallet of the Account; Cash
negativity is allowed but warned (the indicator is computed at the HTTP layer
from the derived Balance); Contact Wallets only participate in Transfers; a
Category attaches only to Transactions of its Type; Opening Balance
Transactions are created by the Wallet lifecycle and are read-only here.
"""

from datetime import datetime
from decimal import Decimal

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
    wallet_id: int,
    category_id: int | None = None,
    description: str | None = None,
    latitude: Decimal | None = None,
    longitude: Decimal | None = None,
) -> Transaction:
    wallet = _owned_wallet_or_raise(session, account_id, wallet_id)
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
    if transaction.type not in (TransactionType.EXPENSE.value, TransactionType.INCOME.value):
        raise TransactionRuleError("Opening Balance Transactions are read-only")

    if "category_id" in changes:
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
    if transaction.type not in (TransactionType.EXPENSE.value, TransactionType.INCOME.value):
        raise TransactionRuleError("Opening Balance Transactions are read-only")
    session.delete(transaction)
    session.commit()
