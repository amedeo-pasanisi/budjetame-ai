"""Category business rules. Called by the HTTP layer; never from tests.

Rules from CONTEXT.md: names unique case-insensitively within (Account, Type),
an icon/color for rendering, delete-uncategorizes semantics (the Category
FK on Transactions is ON DELETE SET NULL, so deleting a Category leaves its
Transactions uncategorized; Transactions are never deleted), and Merging
(ADR-0007): a rename that collides with an existing same-Type name merges
instead of failing — the existing Category survives, the renamed one's
Transactions move to it, and the renamed Category is deleted.
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import Category, CategoryType, Transaction
from app.services import scoping


class CategoryNameTaken(Exception):
    """A Category with this name (case-insensitive) already exists for the Account
    and Type. The create path only: a rename collides into a merge offer instead
    (ADR-0007)."""


class CategoryMergeConflict(Exception):
    """A rename collides with an existing same-Type Category (ADR-0007): the
    existing Category would survive the merge. Carries its id and the number
    of Transactions on the renamed Category, so the client can confirm the
    destructive move before it happens."""

    def __init__(self, target_id: int, transaction_count: int) -> None:
        super().__init__(target_id)
        self.target_id = target_id
        self.transaction_count = transaction_count


class CategoryMergeImpossible(Exception):
    """The merge target is the source itself or a Category of the other Type
    (a merge never crosses Types — ADR-0007)."""


def _conflicting_category(
    session: Session, category: Category, name: str
) -> Category | None:
    """The existing Category of the same (Account, Type) already holding
    `name` (case-insensitively), excluding `category` itself — or None. The
    unique index backs this check under a race."""
    return scoping.named_row(
        session,
        Category,
        category.account_id,
        name,
        type_value=category.type,
        exclude_id=category.id,
    )


def _transaction_count(session: Session, category_id: int) -> int:
    """The number of Transactions carrying the Category — the rows a merge
    would move."""
    count = session.scalar(
        select(func.count(Transaction.id)).where(
            Transaction.category_id == category_id
        )
    )
    return int(count or 0)


def create_category(
    session: Session,
    account_id: int,
    *,
    name: str,
    type: CategoryType,
    color: str,
    icon: str | None = None,
) -> Category:
    if scoping.name_is_taken(session, Category, account_id, name, type_value=type.value):
        raise CategoryNameTaken(name)
    category = Category(
        account_id=account_id,
        name=name,
        type=type.value,
        icon=icon or None,
        color=color,
    )
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


def update_category(
    session: Session,
    category: Category,
    *,
    name: str | None = None,
    icon: str | None = None,
    color: str | None = None,
) -> Category:
    """Apply the provided changes. `icon=None` means unchanged; pass "" to clear
    it. A `name` colliding with an existing same-Type Category raises the merge
    offer (ADR-0007) instead of applying anything — the client confirms the
    merge before any move, and icon/color edits of the same submission are
    discarded with it."""
    if name is not None:
        target = _conflicting_category(session, category, name)
        if target is not None:
            raise CategoryMergeConflict(
                target_id=target.id,
                transaction_count=_transaction_count(session, category.id),
            )
    if name is not None:
        category.name = name
    if icon is not None:
        category.icon = icon or None
    if color is not None:
        category.color = color
    session.commit()
    session.refresh(category)
    return category


def merge_categories(
    session: Session, source: Category, target: Category
) -> Category:
    """Merge `source` into `target` (ADR-0007), one atomic write: every
    Transaction of `source` moves to `target`, `source` is deleted, and
    `target` keeps its name, icon, color, and its own Transactions. The move
    runs before the delete so the FK's ON DELETE SET NULL never fires for a
    merged row."""
    if source.id == target.id or source.type != target.type:
        raise CategoryMergeImpossible(
            "A merge target must be another Category of the same Type"
        )
    session.execute(
        update(Transaction)
        .where(Transaction.category_id == source.id)
        .values(category_id=target.id)
    )
    session.delete(source)
    session.commit()
    session.refresh(target)
    return target


def delete_category(session: Session, category: Category) -> None:
    """Delete the Category; its Transactions become uncategorized via the FK's
    ON DELETE SET NULL. Transactions are never deleted."""
    session.delete(category)
    session.commit()
