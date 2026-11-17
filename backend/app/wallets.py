from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, Wallet, WalletType
from app.schemas import WalletCreate, WalletOut, WalletUndoRequest, WalletUpdate
from app.services import scoping, wallets as wallet_service

router = APIRouter(prefix="/wallets", tags=["wallets"])


def _owned_wallet_or_403(session: Session, account: Account, wallet_id: int) -> Wallet:
    """The Account's Wallet, or 403 — including for wallets that don't exist, so
    foreign data is never distinguishable from absent data (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, Wallet, account.id, wallet_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Wallet not found") from None


def _wallet_out(wallet: Wallet, balance: Decimal) -> WalletOut:
    return WalletOut(
        id=wallet.id,
        name=wallet.name,
        type=WalletType(wallet.type),
        balance=balance,
        frozen=wallet.frozen,
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
    include_frozen: bool = False,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[WalletOut]:
    """Active Wallets by default; `include_frozen=true` also returns frozen
    Wallets (with `frozen: true`) so the history screen can reach their
    Transactions (ADR-0002, T8)."""
    stmt = select(Wallet).where(Wallet.account_id == account.id)
    if not include_frozen:
        stmt = stmt.where(Wallet.frozen.is_(False))
    wallets = session.scalars(stmt.order_by(Wallet.id)).all()
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
    except wallet_service.ContactWalletOpeningBalance:
        raise HTTPException(
            status_code=422,
            detail="Contact Wallets start at €0: money moves only via Transfers",
        )
    except (wallet_service.WalletNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    balances = wallet_service.wallet_balances(session, account.id)
    return _wallet_out(wallet, balances.get(wallet.id, Decimal("0.00")))


@router.post("/undo", response_model=WalletOut, status_code=201)
def undo_delete_wallet(
    payload: WalletUndoRequest,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    """Re-insert a deleted Wallet with its original id, still frozen
    (ADR-0034): the client sends back the row the delete returned. A name
    taken in the meantime is the name-conflict 409; an id held by another
    Account is 403 (ADR-0003)."""
    try:
        wallet = wallet_service.undo_delete_wallet(
            session,
            account.id,
            wallet_id=payload.id,
            name=payload.name,
            type=payload.type,
            created_at=payload.created_at,
        )
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Wallet not found") from None
    except wallet_service.WalletIdInUse:
        raise HTTPException(status_code=422, detail="This wallet already exists")
    except (wallet_service.WalletNameTaken, IntegrityError) as cause:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Undo failed: a Wallet with this name now exists",
        ) from cause
    return _wallet_out(wallet, Decimal("0.00"))


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
    except wallet_service.FrozenWallet:
        raise HTTPException(status_code=422, detail="Frozen Wallets are read-only")
    except (wallet_service.WalletNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    balances = wallet_service.wallet_balances(session, account.id)
    return _wallet_out(wallet, balances.get(wallet.id, Decimal("0.00")))


@router.post("/{wallet_id}/freeze", response_model=WalletOut)
def freeze_wallet(
    wallet_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    """Freeze a Wallet at Balance exactly €0 (ADR-0002). An explicit action
    like the Recurring one: HTTP DELETE on a Wallet is the real delete
    (ADR-0034)."""
    wallet = _owned_wallet_or_403(session, account, wallet_id)
    try:
        wallet = wallet_service.freeze_wallet(session, wallet)
    except wallet_service.WalletNotFreezable as error:
        raise HTTPException(status_code=422, detail=str(error))
    return _wallet_out(wallet, Decimal("0.00"))


@router.delete("/{wallet_id}", response_model=WalletOut)
def delete_wallet(
    wallet_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    """Delete a Frozen Wallet with no history for good (ADR-0034). The
    response is the full row — the client keeps it as the Undo replay
    payload. An active Wallet, or one any Transaction references, is
    refused with a rule error (422) that says why."""
    wallet = _owned_wallet_or_403(session, account, wallet_id)
    out = _wallet_out(wallet, Decimal("0.00"))
    try:
        wallet_service.delete_wallet(session, wallet)
    except wallet_service.WalletNotDeletable as error:
        raise HTTPException(status_code=422, detail=str(error))
    return out


@router.post("/{wallet_id}/unfreeze", response_model=WalletOut)
def unfreeze_wallet(
    wallet_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> WalletOut:
    """Unfreeze a Frozen Wallet, restoring it to active (issue #48)."""
    wallet = _owned_wallet_or_403(session, account, wallet_id)
    wallet = wallet_service.unfreeze_wallet(session, wallet)
    balances = wallet_service.wallet_balances(session, account.id)
    return _wallet_out(wallet, balances.get(wallet.id, Decimal("0.00")))
