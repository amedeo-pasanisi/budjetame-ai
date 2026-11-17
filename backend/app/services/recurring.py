"""The Recurring definition module: one lifecycle for Recurring Costs and
Recurring Incomes (ADR-0033). Called by the HTTP layer and the other logic
modules; never from tests.

ADR-0011 made Recurring Incomes a parallel resource, not a generalisation:
a second table, a second URL prefix, a second screen side. The rules on
both sides stayed identical — names unique per Account, case-insensitively;
a start date every definition always carries, set to the creation day when
left empty and never unset afterwards (ADR-0024); freezing in place of
deletion, with the links kept and the skips removed (ADR-0028); unfreezing
back to active unless the name now collides — so the two copies of this
module differed by their noun alone. This module holds that lifecycle once
and takes the kind as a value: `Kind` is the whole difference between a
Recurring Cost and a Recurring Income as the code sees it (the model, the
noun in messages, the label in HTTP details, and the two foreign-key
columns the Occurrence Timeline reads pins and skips through), and
`kind_of` recovers it from any definition row.

Derived Occurrences are not this module's business: the Occurrence
Timeline (app.services.occurrences) owns every derived read and the skip
write. This module keeps create, update, freeze, unfreeze, and — for a
frozen definition with no linked Transaction — delete and its undo
(ADR-0034).
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import cast

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select, text
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models import (
    IntervalUnit,
    RecurringCost,
    RecurringIncome,
    RecurringSkip,
    Transaction,
)
from app.recurrence import rome_today
from app.services import scoping

Definition = RecurringCost | RecurringIncome
LinkColumn = InstrumentedAttribute[int | None]


@dataclass(frozen=True, eq=False)
class Kind:
    """One kind of Recurring definition — everything that differs between
    the Costs side and the Incomes side (ADR-0011): the mapped model, the
    noun the rule messages use ("recurring cost"), the label the HTTP
    details use ("Recurring Cost"), and how the kind hangs off the shared
    tables — the link column on Transactions that carries its pins and the
    column on RecurringSkip that carries its skips, plus the keyword that
    sets the latter on a new skip row. Identity-compared: the two kinds are
    the module's singletons."""

    model: type[RecurringCost] | type[RecurringIncome]
    noun: str
    label: str
    pin_column: LinkColumn
    skip_column: LinkColumn

    @property
    def skip_key(self) -> str:
        """The keyword that sets this kind's column on a new skip row."""
        return self.skip_column.key


COST = Kind(
    model=RecurringCost,
    noun="cost",
    label="Recurring Cost",
    pin_column=Transaction.recurring_cost_id,
    skip_column=RecurringSkip.recurring_cost_id,
)

INCOME = Kind(
    model=RecurringIncome,
    noun="income",
    label="Recurring Income",
    pin_column=Transaction.recurring_income_id,
    skip_column=RecurringSkip.recurring_income_id,
)


def kind_of(definition: Definition) -> Kind:
    """The kind of a definition row."""
    return COST if isinstance(definition, RecurringCost) else INCOME


def owned(session: Session, kind: Kind, account_id: int, definition_id: int) -> Definition:
    """The Account's definition of `kind`, or `scoping.NotOwned` — including
    when the row does not exist (ADR-0003). The one place the kind's model
    is narrowed back to a definition row: the generic ownership check sees
    the two models' common base."""
    return cast(Definition, scoping.owned_or_raise(session, kind.model, account_id, definition_id))


def list_for(
    session: Session, kind: Kind, account_id: int, *, include_frozen: bool
) -> list[Definition]:
    """The Account's definitions of `kind`: active ones by default, frozen
    ones too when asked (ADR-0028), in no particular order — the router
    sorts the API views."""
    stmt = select(kind.model).where(kind.model.account_id == account_id)
    if not include_frozen:
        stmt = stmt.where(kind.model.frozen.is_(False))
    return cast(list[Definition], list(session.scalars(stmt).all()))


class RecurringNameTaken(Exception):
    """A definition of this kind with this name (case-insensitive) already
    exists for the Account."""


class RecurringRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


class RecurringFrozen(Exception):
    """The definition is frozen — no field can be edited (ADR-0028)."""


def _parse_start_date(value: str | None) -> date | None:
    """The start date as a Europe/Rome calendar day (the schema validated
    the "YYYY-MM-DD" shape), or None — the empty-at-creation case, which the
    caller turns into the creation day (ADR-0024)."""
    return date.fromisoformat(value) if value is not None else None


def create(
    session: Session,
    kind: Kind,
    account_id: int,
    *,
    name: str,
    amount: Decimal,
    interval_value: int,
    interval_unit: IntervalUnit,
    start_date: str | None,
) -> Definition:
    """A new definition of `kind`. The name must be free within the Account
    (case-insensitively); an empty start date becomes the creation day,
    stored like any other (ADR-0024): every definition always carries one."""
    if scoping.name_is_taken(session, kind.model, account_id, name):
        raise RecurringNameTaken(name)
    definition = kind.model(
        account_id=account_id,
        name=name,
        amount=amount,
        interval_value=interval_value,
        interval_unit=interval_unit.value,
        start_date=_parse_start_date(start_date) or rome_today(),
    )
    session.add(definition)
    session.commit()
    session.refresh(definition)
    return definition


def update(session: Session, definition: Definition, *, changes: dict) -> Definition:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is
    applied; a field absent is untouched. `start_date` is the one exception
    to the null-clears rule: an explicit null is rejected — a definition
    always carries a start date (ADR-0024), it can be changed, never unset.
    A frozen definition is read-only — every edit is rejected (ADR-0028)."""
    kind = kind_of(definition)
    if definition.frozen:
        raise RecurringFrozen(
            f"A frozen recurring {kind.noun} cannot be edited. Unfreeze it first."
        )
    name = changes.get("name", definition.name)
    if name is not None and name != definition.name:
        if scoping.name_is_taken(
            session, kind.model, definition.account_id, name, exclude_id=definition.id
        ):
            raise RecurringNameTaken(name)

    for field in ("name", "amount", "interval_value"):
        if field in changes:
            setattr(definition, field, changes[field])
    if "interval_unit" in changes:
        definition.interval_unit = changes["interval_unit"].value
    if "start_date" in changes:
        start_date = _parse_start_date(changes["start_date"])
        if start_date is None:
            raise RecurringRuleError(
                f"A recurring {kind.noun} always carries a start date — it can be "
                "changed, never unset."
            )
        definition.start_date = start_date

    session.commit()
    session.refresh(definition)
    return definition


def freeze(session: Session, definition: Definition) -> Definition:
    """Freeze a definition (ADR-0028): remove its skips — the Timeline
    generates nothing from the freeze date on, so there is nothing left to
    excuse — stop generating Occurrences, mark it frozen. All links to
    Transactions survive intact. Freezing an already-frozen definition is a
    no-op (idempotent)."""
    if definition.frozen:
        return definition
    kind = kind_of(definition)
    session.execute(
        sa_delete(RecurringSkip).where(kind.skip_column == definition.id)
    )
    definition.frozen = True
    definition.freeze_date = rome_today()
    session.commit()
    session.refresh(definition)
    return definition


def unfreeze(session: Session, definition: Definition) -> Definition:
    """Unfreeze a frozen definition (ADR-0028): restore editability, resume
    Occurrence generation on the natural cycle. If the name now collides
    with an active definition of the same kind, reject. Unfreezing an
    active definition is a no-op, mirroring freeze's idempotency."""
    if not definition.frozen:
        return definition
    kind = kind_of(definition)
    if scoping.name_is_taken(
        session,
        kind.model,
        definition.account_id,
        definition.name,
        exclude_id=definition.id,
    ):
        raise RecurringNameTaken(definition.name)
    definition.frozen = False
    definition.freeze_date = None
    session.commit()
    session.refresh(definition)
    return definition


def linked_transaction_count(session: Session, definition: Definition) -> int:
    """How many Transactions carry a link to the definition. Zero means it
    has no history (ADR-0034): skips are not history — freezing already
    removed them."""
    count = session.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(kind_of(definition).pin_column == definition.id)
    )
    return int(count or 0)


def delete(session: Session, definition: Definition) -> None:
    """Delete a frozen definition with no history for good (ADR-0034). Only
    a frozen definition qualifies — Freeze stays the one action on an active
    row — and only one no Transaction is linked to: a delete never severs a
    link, so a paid Occurrence never silently becomes Discretionary. The
    foreign keys' set-null and the skip cascade never fire on real data;
    they are not relied upon."""
    kind = kind_of(definition)
    if not definition.frozen:
        raise RecurringRuleError(
            f"Only a frozen recurring {kind.noun} can be deleted — freeze it first"
        )
    count = linked_transaction_count(session, definition)
    if count > 0:
        linked = "1 transaction is" if count == 1 else f"{count} transactions are"
        pronoun = "it" if count == 1 else "them"
        raise RecurringRuleError(
            f"{linked} linked to this recurring {kind.noun} — unlink {pronoun} first"
        )
    session.delete(definition)
    session.commit()


class RecurringIdInUse(Exception):
    """An undo's id is already a definition of the Account (ADR-0034): the
    row was never deleted, or was already brought back."""


def undo_delete(
    session: Session,
    kind: Kind,
    account_id: int,
    *,
    definition_id: int,
    name: str,
    amount: Decimal,
    interval_value: int,
    interval_unit: IntervalUnit,
    start_date: str,
    freeze_date: str | None,
    created_at: datetime,
) -> Definition:
    """Re-insert a deleted definition of `kind` with its original id, still
    frozen with its freeze date (ADR-0034, mirroring the Transaction undo of
    ADR-0031). The replay is safe because the delete's preconditions
    guarantee nothing referenced the row. The one domain failure is a name
    taken in the meantime; an id now held by another Account is foreign
    (`scoping.NotOwned`), one held by the caller means there is nothing to
    undo. The Postgres sequence is re-synced afterwards so later
    auto-generated ids never collide."""
    existing = cast(Definition | None, session.get(kind.model, definition_id))
    if existing is not None:
        if existing.account_id != account_id:
            raise scoping.NotOwned()
        raise RecurringIdInUse()
    if scoping.name_is_taken(session, kind.model, account_id, name):
        raise RecurringNameTaken(name)
    definition = kind.model(
        id=definition_id,
        account_id=account_id,
        name=name,
        amount=amount,
        interval_value=interval_value,
        interval_unit=interval_unit.value,
        start_date=date.fromisoformat(start_date),
        frozen=True,
        freeze_date=_parse_start_date(freeze_date),
        created_at=created_at,
    )
    session.add(definition)
    session.flush()
    table = kind.model.__tablename__
    session.execute(
        text(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {table}), 1))"
        )
    )
    session.commit()
    session.refresh(definition)
    return cast(Definition, definition)
