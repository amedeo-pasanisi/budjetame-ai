from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, Category, CategoryType
from app.schemas import (
    CategoryCreate,
    CategoryMergeRequest,
    CategoryOut,
    CategoryUpdate,
)
from app.services import categories as category_service, scoping

router = APIRouter(prefix="/categories", tags=["categories"])


def _owned_category_or_403(
    session: Session, account: Account, category_id: int
) -> Category:
    """The Account's Category, or 403 — including for categories that don't exist,
    so foreign data is never distinguishable from absent data (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, Category, account.id, category_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Category not found") from None


def _category_out(category: Category) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        name=category.name,
        type=CategoryType(category.type),
        icon=category.icon,
        color=category.color,
        created_at=category.created_at,
    )


def _name_conflict(session: Session, cause: Exception) -> None:
    """Map a duplicate-name failure to 409 — from the pre-check or the unique
    index under a race — after rolling back the aborted transaction."""
    session.rollback()
    raise HTTPException(
        status_code=409, detail="A Category with this name already exists"
    ) from cause


@router.get("", response_model=list[CategoryOut])
def list_categories(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> list[CategoryOut]:
    categories = session.scalars(
        select(Category)
        .where(Category.account_id == account.id)
        .order_by(Category.type, func.lower(Category.name))
    ).all()
    return [_category_out(c) for c in categories]


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(
    payload: CategoryCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> CategoryOut:
    try:
        category = category_service.create_category(
            session,
            account.id,
            name=payload.name,
            type=payload.type,
            icon=payload.icon,
            color=payload.color,
        )
    except (category_service.CategoryNameTaken, IntegrityError) as cause:
        _name_conflict(session, cause)
    return _category_out(category)


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int,
    payload: CategoryUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> CategoryOut:
    category = _owned_category_or_403(session, account, category_id)
    try:
        category = category_service.update_category(
            session,
            category,
            name=payload.name,
            icon=payload.icon,
            color=payload.color,
        )
    except category_service.CategoryMergeConflict as conflict:
        # ADR-0007: the collision is a merge offer, not a bare error. The
        # payload lets the client confirm "move N Transactions into X" before
        # the destructive merge; this request has written nothing.
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A Category with this name already exists",
                "target_id": conflict.target_id,
                "transaction_count": conflict.transaction_count,
            },
        ) from conflict
    except IntegrityError as cause:
        _name_conflict(session, cause)
    return _category_out(category)


@router.post("/{category_id}/merge", response_model=CategoryOut)
def merge_category(
    category_id: int,
    payload: CategoryMergeRequest,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> CategoryOut:
    """The confirmed merge (ADR-0007): every Transaction of the renamed
    Category moves to the target, the renamed Category is deleted, and the
    target survives with its own name, icon, and color — one atomic write.
    `target_id` is the id the rename conflict carried."""
    source = _owned_category_or_403(session, account, category_id)
    target = _owned_category_or_403(session, account, payload.target_id)
    try:
        surviving = category_service.merge_categories(session, source, target)
    except category_service.CategoryMergeImpossible as cause:
        raise HTTPException(status_code=422, detail=str(cause)) from cause
    return _category_out(surviving)


@router.delete("/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> None:
    category = _owned_category_or_403(session, account, category_id)
    category_service.delete_category(session, category)
