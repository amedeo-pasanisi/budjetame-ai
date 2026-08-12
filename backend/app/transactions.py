from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.dates import from_rome_day, to_rome_day
from app.deps import get_session
from app.models import Account, Category, Transaction, TransactionType, Wallet, WalletType
from app.schemas import (
    TransactionCreate,
    TransactionOut,
    TransactionUpdate,
    fmt_coord,
)
from app.services import scoping, transactions as transaction_service
from app.services import wallets as wallet_service

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _rome_day_or_422(value: str) -> datetime:
    """Parse a `YYYY-MM-DD` filter bound as a Europe/Rome day, or 422."""
    try:
        return from_rome_day(value)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="Dates must be YYYY-MM-DD"
        ) from None


def _owned_transaction_or_403(
    session: Session, account: Account, transaction_id: int
) -> Transaction:
    """The Account's Transaction, or 403 — including for transactions that don't
    exist, so foreign data is never distinguishable from absent data (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, Transaction, account.id, transaction_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Transaction not found") from None


def _transaction_out(
    session: Session, account: Account, transaction: Transaction
) -> TransactionOut:
    """The API view of any Transaction. Expense/Income/Opening Balance reference
    one Wallet; a Transfer references Source and Destination Wallets and never
    carries a Category. `warning` is the Cash negative-Balance indicator (true
    right after a write that left a Cash Wallet negative): for a Transfer only
    the Source can go negative, since the Destination only gains."""
    if transaction.type == TransactionType.TRANSFER.value:
        if transaction.source_wallet_id is None or transaction.destination_wallet_id is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        source = session.get(Wallet, transaction.source_wallet_id)
        destination = session.get(Wallet, transaction.destination_wallet_id)
        if source is None or destination is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        warning_wallet = source
        wallet_id = None
        source_wallet_id = source.id
        destination_wallet_id = destination.id
        category_id = None
    else:
        wallet_id = transaction.wallet_id
        if wallet_id is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        wallet = session.get(Wallet, wallet_id)
        if wallet is None:
            # A Transaction's Wallet always exists; it is validated on every write.
            raise HTTPException(status_code=403, detail="Wallet not found")
        warning_wallet = wallet
        source_wallet_id = None
        destination_wallet_id = None
        category_id = transaction.category_id
    balance = wallet_service.wallet_balance(session, account.id, warning_wallet.id)
    warning = warning_wallet.type == WalletType.CASH.value and balance < 0
    return TransactionOut(
        id=transaction.id,
        type=TransactionType(transaction.type),
        amount=transaction.amount,
        date=to_rome_day(transaction.date),
        wallet_id=wallet_id,
        source_wallet_id=source_wallet_id,
        destination_wallet_id=destination_wallet_id,
        category_id=category_id,
        description=transaction.description,
        latitude=fmt_coord(transaction.latitude),
        longitude=fmt_coord(transaction.longitude),
        warning=warning,
        created_at=transaction.created_at,
    )


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    wallet_id: int | None = None,
    category_id: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[TransactionOut]:
    """The history listing (T8): filters compose — a Wallet (including frozen
    Wallets, whose history stays viewable), a Category, and a Europe/Rome
    inclusive date range (`YYYY-MM-DD` days)."""
    stmt = select(Transaction).where(Transaction.account_id == account.id)
    if wallet_id is not None:
        try:
            scoping.owned_or_raise(session, Wallet, account.id, wallet_id)
        except scoping.NotOwned:
            raise HTTPException(status_code=403, detail="Wallet not found") from None
        # A Wallet's history includes Transfers touching it on either leg.
        stmt = stmt.where(
            (Transaction.wallet_id == wallet_id)
            | (Transaction.source_wallet_id == wallet_id)
            | (Transaction.destination_wallet_id == wallet_id)
        )
    if category_id is not None:
        try:
            scoping.owned_or_raise(session, Category, account.id, category_id)
        except scoping.NotOwned:
            raise HTTPException(status_code=403, detail="Category not found") from None
        stmt = stmt.where(Transaction.category_id == category_id)
    if from_date is not None:
        stmt = stmt.where(Transaction.date >= _rome_day_or_422(from_date))
    if to_date is not None:
        # Inclusive upper bound: strictly before the next Rome day.
        stmt = stmt.where(Transaction.date < _rome_day_or_422(to_date) + timedelta(days=1))
    transactions = session.scalars(
        stmt.order_by(Transaction.date.desc(), Transaction.id.desc())
    ).all()
    return [_transaction_out(session, account, t) for t in transactions]


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionOut:
    try:
        transaction = transaction_service.create_transaction(
            session,
            account.id,
            type=payload.type,
            amount=payload.amount,
            date=payload.date,
            wallet_id=payload.wallet_id,
            source_wallet_id=payload.source_wallet_id,
            destination_wallet_id=payload.destination_wallet_id,
            category_id=payload.category_id,
            description=payload.description,
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Wallet or Category not found")
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return _transaction_out(session, account, transaction)


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionOut:
    transaction = _owned_transaction_or_403(session, account, transaction_id)
    try:
        transaction = transaction_service.update_transaction(
            session,
            account.id,
            transaction,
            changes=payload.model_dump(exclude_unset=True),
        )
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Wallet or Category not found")
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return _transaction_out(session, account, transaction)


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(
    transaction_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> None:
    transaction = _owned_transaction_or_403(session, account, transaction_id)
    try:
        transaction_service.delete_transaction(session, transaction)
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
