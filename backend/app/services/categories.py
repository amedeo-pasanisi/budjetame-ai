"""Category business rules. Called by the HTTP layer; never from tests.

Rules from CONTEXT.md: names unique case-insensitively within (Account, Type),
an icon/color for rendering, and delete-uncategorizes semantics (the Category
FK on Transactions is ON DELETE SET NULL, so deleting a Category leaves its
Transactions uncategorized; Transactions are never deleted).
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Category, CategoryType


class CategoryNameTaken(Exception):
    """A Category with this name (case-insensitive) already exists for the Account
    and Type."""


def name_is_taken(
    session: Session,
    account_id: int,
    name: str,
    type: CategoryType,
    *,
    exclude_id: int | None = None,
) -> bool:
    """True when another Category of the Account and Type has `name`, case-insensitively."""
    stmt = select(Category.id).where(
        Category.account_id == account_id,
        Category.type == type.value,
        func.lower(Category.name) == func.lower(name),
    )
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    return session.scalar(stmt) is not None


def create_category(
    session: Session,
    account_id: int,
    *,
    name: str,
    type: CategoryType,
    color: str,
    icon: str | None = None,
) -> Category:
    if name_is_taken(session, account_id, name, type):
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
    """Apply the provided changes. `icon=None` means unchanged; pass \"\" to clear it."""
    new_name = name if name is not None else category.name
    new_type = CategoryType(category.type)
    if name is not None and name_is_taken(
        session, category.account_id, name, new_type, exclude_id=category.id
    ):
        raise CategoryNameTaken(name)
    if name is not None:
        category.name = name
    if icon is not None:
        category.icon = icon or None
    if color is not None:
        category.color = color
    session.commit()
    session.refresh(category)
    return category


def delete_category(session: Session, category: Category) -> None:
    """Delete the Category; its Transactions become uncategorized via the FK's
    ON DELETE SET NULL. Transactions are never deleted."""
    session.delete(category)
    session.commit()
