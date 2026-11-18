"""Draft Transaction rules (ADR-0036, issues #122/#123/#125). Called by the
HTTP layer and, once the Assistant lands (#128), by its tools; never from
tests.

A Draft is a stored, unapproved record of a money movement: the fields of
a Transaction, any of which may be missing. The only rule enforced on a
Draft's own writes is ownership — every Wallet, Category or Recurring
definition a Draft points at must belong to the Account (ADR-0003) —
because the create rules the form applies (Wallet and Category types,
Recurring pins, frozen Wallets) run at Approve time, not at Draft time: a
Wallet frozen in between or a pin paid in between surfaces then, as the
form's rule errors. Approve (#125) is one step in one database
transaction: the same `create_transaction` the ledger uses judges the
Draft (or the edited fields the form sends back), inserts the Transaction
and the Draft is deleted before the commit — so a Draft is never approved
twice and never left behind. A Draft counts toward nothing: it lives in
its own table and no derived read, Export, Backup, Restore or Duplicate
check ever selects from it.
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
    Transaction,
    Wallet,
)
from app.services.scoping import owned_or_raise
from app.services.transactions import TransactionRuleError, create_transaction

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


# What a Draft must carry before the create rules can even start: the
# fields `TransactionCreate` requires. Missing, each is a rule error — the
# form's Field Error on the same field — never a server error (#125).
_REQUIRED_MESSAGES = {
    "type": "A type is required: expense, income, or transfer",
    "amount": "An amount is required",
    "date": "A date is required",
}


def _draft_as_create(draft: DraftTransaction) -> dict[str, Any]:
    """The Draft's fields — `DRAFT_FIELDS`, the date back on the wire as a
    Rome day — as `create_transaction` keyword arguments, or
    `TransactionRuleError` naming the first required field it lacks."""
    for field, message in _REQUIRED_MESSAGES.items():
        if getattr(draft, field) is None:
            raise TransactionRuleError(message)
    assert draft.date is not None  # checked just above
    return {
        field: draft.date.isoformat() if field == "date" else getattr(draft, field)
        for field in DRAFT_FIELDS
    }


def approve_draft(
    session: Session,
    account_id: int,
    draft: DraftTransaction,
    *,
    override: dict[str, Any] | None = None,
) -> Transaction:
    """Approve (ADR-0036, #125): create the Transaction and remove the Draft
    in one database transaction. `override`, when given, is the full
    create payload the form sent back after a rejected one-tap Approve
    (the edited fields, `TransactionCreate`'s keyword arguments); without
    it the Draft is judged as it stands. Either way the rules are the
    ledger's own `create_transaction` — Wallet and Category types, frozen
    Wallets, Recurring pins — so a typed Transaction and an approved Draft
    cannot drift; a rule it breaks raises `TransactionRuleError` (422) and
    a foreign reference raises `NotOwned` (403), and in both cases nothing
    is written and the Draft stays. The insert and the delete share one
    commit: a second Approve finds no Draft (403), and no Draft outlives
    its Transaction."""
    fields = override if override is not None else _draft_as_create(draft)
    try:
        transaction = create_transaction(session, account_id, commit=False, **fields)
        session.delete(draft)
        session.commit()
    except Exception:
        session.rollback()
        raise
    session.refresh(transaction)
    return transaction
