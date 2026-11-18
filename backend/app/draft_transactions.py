"""Draft Transactions endpoints (ADR-0036, issues #122/#123): the stored,
unapproved records the Assistant produces, scoped to the Account and
counting toward nothing. Create exists so clients and tests can write a
Draft before the Assistant lands; list feeds the pinned block above the
ledger; patch edits fields; delete is Discard, with no Undo. Approve is a
later ticket (#125). Foreign or missing answers 403 (ADR-0003)."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, DraftTransaction, TransactionType
from app.schemas import DraftTransactionOut, DraftTransactionWrite
from app.services import draft_transactions as draft_service
from app.services import scoping

router = APIRouter(prefix="/draft-transactions", tags=["draft-transactions"])

_REFERENCE_NOT_FOUND = "Wallet, Category, Recurring Cost, or Recurring Income not found"


def _owned_draft_or_403(
    session: Session, account: Account, draft_id: int
) -> DraftTransaction:
    """The Account's Draft, or 403 — including for Drafts that don't exist,
    so foreign data is never distinguishable from absent data (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, DraftTransaction, account.id, draft_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Draft transaction not found") from None


def _draft_out(draft: DraftTransaction) -> DraftTransactionOut:
    return DraftTransactionOut(
        id=draft.id,
        type=TransactionType(draft.type) if draft.type is not None else None,
        amount=draft.amount,
        date=draft.date.isoformat() if draft.date is not None else None,
        wallet_id=draft.wallet_id,
        source_wallet_id=draft.source_wallet_id,
        destination_wallet_id=draft.destination_wallet_id,
        category_id=draft.category_id,
        recurring_cost_id=draft.recurring_cost_id,
        recurring_income_id=draft.recurring_income_id,
        description=draft.description,
        created_at=draft.created_at,
    )


@router.get("", response_model=list[DraftTransactionOut])
def list_draft_transactions(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[DraftTransactionOut]:
    """The Account's Drafts, oldest first, for the pinned block above the
    ledger. Never paginated: Drafts are a handful awaiting a tap."""
    return [_draft_out(d) for d in draft_service.list_drafts(session, account.id)]


@router.post("", response_model=DraftTransactionOut, status_code=201)
def create_draft_transaction(
    payload: DraftTransactionWrite,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> DraftTransactionOut:
    try:
        draft = draft_service.create_draft(
            session, account.id, **payload.model_dump()
        )
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail=_REFERENCE_NOT_FOUND) from None
    return _draft_out(draft)


@router.patch("/{draft_id}", response_model=DraftTransactionOut)
def update_draft_transaction(
    draft_id: int,
    payload: DraftTransactionWrite,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> DraftTransactionOut:
    draft = _owned_draft_or_403(session, account, draft_id)
    try:
        draft = draft_service.update_draft(
            session, account.id, draft, changes=payload.model_dump(exclude_unset=True)
        )
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail=_REFERENCE_NOT_FOUND) from None
    return _draft_out(draft)


@router.delete("/{draft_id}", status_code=204)
def discard_draft_transaction(
    draft_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> Response:
    """Discard (ADR-0036): the Draft is removed, nothing is created, nothing
    it referred to changes, and there is no Undo."""
    draft = _owned_draft_or_403(session, account, draft_id)
    draft_service.delete_draft(session, draft)
    return Response(status_code=204)
