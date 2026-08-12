"""Category business rules. Called by the HTTP layer; never from tests.

Rules from CONTEXT.md: names unique case-insensitively within (Account, Type),
an icon/color for rendering, and delete-uncategorizes semantics (the Category
FK on Transactions is ON DELETE SET NULL, so deleting a Category leaves its
Transactions uncategorized; Transactions are never deleted).
"""

from sqlalchemy.orm import Session

from app.models import Category, CategoryType
from app.services import scoping


class CategoryNameTaken(Exception):
    """A Category with this name (case-insensitive) already exists for the Account
    and Type."""


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
    """Apply the provided changes. `icon=None` means unchanged; pass \"\" to clear it."""
    if name is not None and scoping.name_is_taken(
        session,
        Category,
        category.account_id,
        name,
        type_value=category.type,
        exclude_id=category.id,
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
