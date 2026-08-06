from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, Wallet, WalletType
from app.schemas import WalletCreate, WalletOut, WalletUpdate
from app.services import wallets as wallet_service

router = APIRouter(prefix="/wallets", tags=["wallets"])


def _owned_wallet_or_403(session: Session, account: Account, wallet_id: int) -> Wallet:
    """The Account's Wallet, or 403 — including for wallets that don't exist, so
    foreign data is never distinguishable from absent data (ADR-0003)."""
    wallet = session.get(Wallet, wallet_id)
    if wallet is None or wallet.account_id != account.id:
        raise HTTPException(status_code=403, detail="Wallet not found")
    return wallet


def _wallet_out(wallet: Wallet, balance: Decimal) -> WalletOut:
    return WalletOut(
        id=wallet.id,
        name=wallet.name,
        type=WalletType(wallet.type),
        balance=balance,
        created_at=wallet.created_at,
    )


def _name_conflict(session: Session, cause: Exception) -> None:
    """Map a duplicate-name failure to 409 — from the pre-check or the unique
    index under a race — after rolling back the aborted transaction."""
    session.rollback()
    raise HTTPException(
        status_code=409, detail="A Wallet with this name already exists"
    ) from cause


@router.get("", response_model=list[WalletOut])
def list_wallets(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[WalletOut]:
    wallets = session.scalars(
        select(Wallet).where(Wallet.account_id == account.id).order_by(Wallet.id)
    ).all()
    balances = wallet_service.wallet_balances(session, account.id)
    return [_wallet_out(w, balances.get(w.id, Decimal("0.00"))) for w in wallets]


@router.post("", response_model=WalletOut, status_code=201)
def create_wallet(
    payload: WalletCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    try:
        wallet = wallet_service.create_wallet(
            session,
            account.id,
            name=payload.name,
            type=payload.type,
            opening_balance=payload.opening_balance,
        )
    except (wallet_service.WalletNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    balances = wallet_service.wallet_balances(session, account.id)
    return _wallet_out(wallet, balances.get(wallet.id, Decimal("0.00")))


@router.patch("/{wallet_id}", response_model=WalletOut)
def rename_wallet(
    wallet_id: int,
    payload: WalletUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    wallet = _owned_wallet_or_403(session, account, wallet_id)
    try:
        wallet = wallet_service.rename_wallet(session, wallet, payload.name)
    except (wallet_service.WalletNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    balances = wallet_service.wallet_balances(session, account.id)
    return _wallet_out(wallet, balances.get(wallet.id, Decimal("0.00")))
