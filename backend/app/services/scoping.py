"""Per-Account invariants shared by every resource (issue #18).

ADR-0003: all data is scoped to the single Account, and foreign data is
indistinguishable from absent data — one ownership check serves Wallets,
Categories and Transactions, at both the HTTP layer (403) and the service
layer (NotOwned). Names are unique case-insensitively within the Account
(Wallets) or within the Account and Type (Categories) — one name-availability
check serves both.
"""

from typing import Any, Protocol, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session


class NotOwned(Exception):
    """A row belongs to another Account, or does not exist: the two are
    indistinguishable (ADR-0003)."""


class Scoped(Protocol):
    """Any row owned by an Account (every resource model)."""

    id: Any
    account_id: Any


class Named(Scoped, Protocol):
    """A row with a per-Account unique name (Wallets, Categories)."""

    name: Any
    type: Any


T = TypeVar("T", bound=Scoped)
TNamed = TypeVar("TNamed", bound=Named)


def owned_or_raise(
    session: Session, model: type[T], account_id: int, resource_id: int
) -> T:
    """The Account's row of `model`, or `NotOwned` — including when the row
    does not exist, so foreign data is never distinguishable from absent data
    (ADR-0003)."""
    row = session.get(model, resource_id)
    if row is None or row.account_id != account_id:
        raise NotOwned()
    return row


def name_is_taken(
    session: Session,
    model: type[TNamed],
    account_id: int,
    name: str,
    *,
    type_value: str | None = None,
    exclude_id: int | None = None,
) -> bool:
    """True when another row of `model` of the Account already has `name`,
    case-insensitively. `type_value` scopes the check within a Type
    (Categories: names are unique per Account and Type); `exclude_id` ignores
    the row being renamed (its own name must not count against it)."""
    stmt = select(model.id).where(
        model.account_id == account_id,
        func.lower(model.name) == func.lower(name),
    )
    if type_value is not None:
        stmt = stmt.where(model.type == type_value)
    if exclude_id is not None:
        stmt = stmt.where(model.id != exclude_id)
    return session.scalar(stmt) is not None
