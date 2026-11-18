"""Draft Transaction rules (ADR-0036, issues #122/#123). Called by the HTTP
layer and, once the Assistant lands (#128), by its tools; never from tests.

A Draft is a stored, unapproved record of a money movement: the fields of
a Transaction, any of which may be missing. The only rule enforced here is
ownership — every Wallet, Category or Recurring definition a Draft points
at must belong to the Account (ADR-0003) — because the create rules the
form applies (Wallet and Category types, Recurring pins, frozen Wallets)
run at Approve time (#125), not at Draft time: a Wallet frozen in between
or a pin paid in between surfaces then, as the form's rule errors. A Draft
counts toward nothing: it lives in its own table and no derived read, Export,
Backup, Restore or Duplicate check ever selects from it.
"""

from datetime import date as DateObj
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Category,
    DraftTransaction,
    RecurringCost,
    RecurringIncome,
    Wallet,
)
from app.services.scoping import owned_or_raise

# The fields a Draft carries, in the wire's order; the Assistant tools and
# the endpoints write any subset of them.
DRAFT_FIELDS = (
    "type",
    "amount",
    "date",
    "wallet_id",
    "source_wallet_id",
    "destination_wallet_id",
    "category_id",
    "recurring_cost_id",
    "recurring_income_id",
    "description",
)

# Which referenced table each id field points at; the ownership check reads
# it so a Draft can never reference another Account's row (ADR-0003).
_REFERENCES: dict[str, Any] = {
    "wallet_id": Wallet,
    "source_wallet_id": Wallet,
    "destination_wallet_id": Wallet,
    "category_id": Category,
    "recurring_cost_id": RecurringCost,
    "recurring_income_id": RecurringIncome,
}


def _check_references(session: Session, account_id: int, fields: dict[str, Any]) -> None:
    """Every id the write carries must be the Account's own row, or
    `NotOwned` (ADR-0003: foreign and missing are indistinguishable)."""
    for field, model in _REFERENCES.items():
        value = fields.get(field)
        if value is not None:
            owned_or_raise(session, model, account_id, value)


def _as_day(value: str | None) -> DateObj | None:
    return DateObj.fromisoformat(value) if value is not None else None


def list_drafts(session: Session, account_id: int) -> list[DraftTransaction]:
    """The Account's Drafts, oldest first — the order they were dictated,
    which is the order the pinned block shows them in."""
    return list(
        session.scalars(
            select(DraftTransaction)
            .where(DraftTransaction.account_id == account_id)
            .order_by(DraftTransaction.id.asc())
        ).all()
    )


def create_draft(
    session: Session,
    account_id: int,
    *,
    type: str | None = None,
    amount: Decimal | None = None,
    date: str | None = None,
    wallet_id: int | None = None,
    source_wallet_id: int | None = None,
    destination_wallet_id: int | None = None,
    category_id: int | None = None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
    description: str | None = None,
) -> DraftTransaction:
    """Store a Draft with any subset of a Transaction's fields (ADR-0036).
    `date` is a Europe/Rome calendar day (`YYYY-MM-DD`) or none."""
    references: dict[str, Any] = {
        "wallet_id": wallet_id,
        "source_wallet_id": source_wallet_id,
        "destination_wallet_id": destination_wallet_id,
        "category_id": category_id,
        "recurring_cost_id": recurring_cost_id,
        "recurring_income_id": recurring_income_id,
    }
    _check_references(session, account_id, references)
    draft = DraftTransaction(
        account_id=account_id,
        type=type,
        amount=amount,
        date=_as_day(date),
        description=description,
        **references,
    )
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def update_draft(
    session: Session,
    account_id: int,
    draft: DraftTransaction,
    *,
    changes: dict[str, Any],
) -> DraftTransaction:
    """Apply `changes` — the fields present in the PATCH, each applied even
    when null (clearing it), absent ones untouched — after checking that
    every new reference is the Account's own (ADR-0003)."""
    _check_references(session, account_id, changes)
    for field, value in changes.items():
        if field not in DRAFT_FIELDS:
            continue
        setattr(draft, field, _as_day(value) if field == "date" else value)
    session.commit()
    session.refresh(draft)
    return draft


def delete_draft(session: Session, draft: DraftTransaction) -> None:
    """Discard (ADR-0036): remove the Draft without creating anything.
    Nothing it referred to changes, and there is no Undo — a Draft has no
    history and is cheaper to dictate again than to keep in the stack."""
    session.delete(draft)
    session.commit()
