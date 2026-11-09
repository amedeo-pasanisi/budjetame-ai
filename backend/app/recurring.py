"""The Recurring Costs and Recurring Incomes resources (issues #56, #60):
definitions of costs and incomes that repeat at a fixed interval. Two URL
prefixes, two tables, one implementation (ADR-0011, ADR-0033): `make_router`
builds the resource for one `Kind`, and the module exports the two routers
`main.py` mounts. The list exposes each definition's next due date, derived
on the fly (ADR-0010); the screen sorts by it. The Backlog rides on the list
too (issues #58, #62): the red "N unpaid" badge comes from here. Guards:
names unique per Account case-insensitively; all data scoped to the Account
(foreign data is a 403, ADR-0003)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.deps import get_session
from app.models import Account, IntervalUnit
from app.recurrence import rome_today
from app.schemas import (
    RecurringDefinitionCreate,
    RecurringDefinitionOut,
    RecurringDefinitionUpdate,
    RecurringOccurrenceOut,
    RecurringOccurrenceUpdate,
)
from app.services import occurrences, recurring, scoping
from app.services.recurring import COST, INCOME, Definition, Kind


def _definition_out(session: Session, definition: Definition) -> RecurringDefinitionOut:
    """The API view of a definition, with the derived state read off one
    Occurrence Timeline: the next due date (ADR-0024: an Occurrence's due
    date is its own date), the next Unpaid Occurrence date (issues #57,
    #61, ADR-0027): the one a new linked Transaction would pay, what the
    transaction form's picker shows — and the Backlog (issues #58, #62):
    Unpaid Occurrences due today or earlier in Europe/Rome. Skip controls
    live per Occurrence on the Occurrences read (ADR-0026), not on the
    definition. A frozen definition's Timeline generates nothing
    (ADR-0028), so its derived fields are None or 0."""
    timeline = occurrences.timeline_for(session, definition)
    today = rome_today()
    next_due = timeline.next_due(today)
    next_unpaid = timeline.oldest_unpaid()
    return RecurringDefinitionOut(
        id=definition.id,
        name=definition.name,
        amount=definition.amount,
        interval_value=definition.interval_value,
        interval_unit=IntervalUnit(definition.interval_unit),
        start_date=definition.start_date.isoformat(),
        next_due_date=next_due.isoformat() if next_due is not None else None,
        next_unpaid_occurrence_date=(
            next_unpaid.isoformat() if next_unpaid is not None else None
        ),
        frozen=definition.frozen,
        backlog_count=timeline.backlog_count(today),
        created_at=definition.created_at,
    )


def _occurrences_out(
    session: Session, definition: Definition
) -> list[RecurringOccurrenceOut]:
    """The Occurrences section's rows as the API view: the read's (date,
    skipped) pairs newest first (ADR-0026). Both the read and the skip
    write answer with exactly this list."""
    return [
        RecurringOccurrenceOut(date=value.isoformat(), skipped=skipped)
        for value, skipped in occurrences.timeline_for(session, definition).states(
            rome_today()
        )
    ]


def make_router(kind: Kind) -> APIRouter:
    """The resource for one kind of definition, mounted at
    `/recurring-{noun}s`. Every handler, status code and detail message is
    the same on both sides but for the kind's label and noun."""
    resource = f"recurring-{kind.noun}s"
    router = APIRouter(prefix=f"/{resource}", tags=[resource])

    def owned_or_403(session: Session, account: Account, definition_id: int) -> Definition:
        """The Account's definition, or 403 — including for ones that don't
        exist, so foreign data is never distinguishable from absent data
        (ADR-0003)."""
        try:
            return recurring.owned(session, kind, account.id, definition_id)
        except scoping.NotOwned:
            raise HTTPException(
                status_code=403, detail=f"{kind.label} not found"
            ) from None

    def name_conflict(session: Session, cause: Exception) -> None:
        """Map a duplicate-name failure to 409 — from the pre-check or the
        unique index under a race — after rolling back the aborted
        transaction."""
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A {kind.label} with this name already exists",
        ) from cause

    @router.get("", response_model=list[RecurringDefinitionOut])
    def list_definitions(
        include_frozen: bool = False,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> list[RecurringDefinitionOut]:
        """Every definition of the Account, sorted by next due date ascending
        (ties by name) — the one order the Recurring screen needs. Active
        definitions by default; `include_frozen=true` also returns frozen
        definitions (with `frozen: True`) so the history screen can reach
        their linked Transactions."""
        return sorted(
            (
                _definition_out(session, definition)
                for definition in recurring.list_for(
                    session, kind, account.id, include_frozen=include_frozen
                )
            ),
            key=lambda out: (out.next_due_date or "", out.name.lower()),
        )

    @router.post("", response_model=RecurringDefinitionOut, status_code=201)
    def create_definition(
        payload: RecurringDefinitionCreate,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> RecurringDefinitionOut:
        try:
            definition = recurring.create(
                session,
                kind,
                account.id,
                name=payload.name,
                amount=payload.amount,
                interval_value=payload.interval_value,
                interval_unit=payload.interval_unit,
                start_date=payload.start_date,
            )
        except recurring.RecurringRuleError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except (recurring.RecurringNameTaken, IntegrityError) as cause:
            name_conflict(session, cause)
        return _definition_out(session, definition)

    @router.get(
        "/{definition_id}/occurrences", response_model=list[RecurringOccurrenceOut]
    )
    def list_occurrences(
        definition_id: int,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> list[RecurringOccurrenceOut]:
        """The Occurrences section's read (ADR-0026): every non-Paid
        Occurrence of the definition — its own date and whether the user
        excused it — newest first, the one order the edit modal renders: the
        next incoming Unpaid row on top, then every excused future row, then
        the past rows (today first) down to the oldest. Paid history lives in
        the ledger and never appears here. The response is the section's
        whole state: each row carries exactly what its Skip/Un-skip button
        needs."""
        definition = owned_or_403(session, account, definition_id)
        return _occurrences_out(session, definition)

    @router.put(
        "/{definition_id}/occurrences/{occurrence_date}",
        response_model=list[RecurringOccurrenceOut],
    )
    def set_occurrence_skipped(
        definition_id: int,
        occurrence_date: str,
        payload: RecurringOccurrenceUpdate,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> list[RecurringOccurrenceOut]:
        """The per-Occurrence skip write (ADR-0026): PUT the Occurrence's
        date with {"skipped": true} to excuse it, {"skipped": false} to
        restore it. Every row toggles independently, in any order. A paid
        Occurrence (or a date that is not one of the definition's
        Occurrences) rejects the skip with 422. The response is the
        refreshed read, so the modal swaps its rows in without a second
        fetch."""
        definition = owned_or_403(session, account, definition_id)
        try:
            occurrences.set_skipped(
                session, definition, occurrence_date, skipped=payload.skipped
            )
        except occurrences.OccurrenceRuleError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return _occurrences_out(session, definition)

    @router.patch("/{definition_id}", response_model=RecurringDefinitionOut)
    def update_definition(
        definition_id: int,
        payload: RecurringDefinitionUpdate,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> RecurringDefinitionOut:
        definition = owned_or_403(session, account, definition_id)
        try:
            definition = recurring.update(
                session, definition, changes=payload.model_dump(exclude_unset=True)
            )
        except (recurring.RecurringFrozen, recurring.RecurringRuleError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except (recurring.RecurringNameTaken, IntegrityError) as cause:
            name_conflict(session, cause)
        return _definition_out(session, definition)

    @router.post("/{definition_id}/freeze", response_model=RecurringDefinitionOut)
    def freeze_definition(
        definition_id: int,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> RecurringDefinitionOut:
        """Freeze a definition (ADR-0028): clean up unpaid/skipped
        Occurrences, stop generating new ones. All links to Transactions
        survive intact. The frozen definition is read-only and shown in a
        collapsed Frozen Recurring section."""
        definition = owned_or_403(session, account, definition_id)
        return _definition_out(session, recurring.freeze(session, definition))

    @router.post("/{definition_id}/unfreeze", response_model=RecurringDefinitionOut)
    def unfreeze_definition(
        definition_id: int,
        account: Account = Depends(get_current_account),
        session: Session = Depends(get_session),
    ) -> RecurringDefinitionOut:
        """Unfreeze a frozen definition (ADR-0028): restore editability and
        resume Occurrence generation on the natural cycle. If the name
        collides with an active definition, returns 409."""
        definition = owned_or_403(session, account, definition_id)
        try:
            definition = recurring.unfreeze(session, definition)
        except recurring.RecurringNameTaken as cause:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail=(
                    f'A {kind.label} named "{definition.name}" already exists — '
                    "rename it first."
                ),
            ) from cause
        return _definition_out(session, definition)

    return router


costs_router = make_router(COST)
incomes_router = make_router(INCOME)
