"""The Occurrence Timeline: one definition's derived Occurrences, with their
Paid, Skipped and frozen state, loaded once and asked every question the
app has about them. Called by the HTTP layer and the other logic modules;
never from tests.

A Recurring Cost or Recurring Income stores only its definition (start
date, interval), the pins of the Occurrences its linked Transactions pay
(issue #57, ADR-0027), the skips the user excused (ADR-0016) and, once
frozen, its freeze date (ADR-0028). Everything else — which Occurrences are
due in a window, the Backlog, the next due date, the one a new link pays,
the Occurrences section's rows — is derived from those four facts and the
pure walkers in app.recurrence. This module loads the four facts into one
`Timeline` value, so every reader derives from the same inputs under the
same rules; the two definition kinds differ only in which foreign key
their pins and skips hang off — the `Kind` table in app.services.recurring.

Rules the Timeline owns:

- An Occurrence is *Paid* when a linked Transaction pins its date; the pin
  is stored at link time and never recomputed (issue #57).
- An Occurrence is *Skipped* when a stored skip's period (app.recurrence
  .period_of under the current unit) matches its own — that period mapping
  is what makes a skip travel with its Occurrence across definition edits,
  and a period holding no Occurrence lies dormant (ADR-0016).
- A frozen definition stops generating Occurrences at its freeze date
  (ADR-0028): an Occurrence due on or after that day does not exist —
  it never counts toward Monthly Spendable, there is no Backlog, no next
  due date, nothing a link could pay and nothing to skip — while the
  Occurrences due before it still count in their months exactly as they
  did at the time.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import RecurringSkip, Transaction
from app.recurrence import (
    Period,
    backlog_count,
    next_due_date,
    occurrence_date,
    occurrences_in_window,
    period_of,
    period_span_end,
)
from app.services.recurring import Definition, kind_of


class OccurrenceRuleError(Exception):
    """A CONTEXT.md rule rejects the Occurrence write; maps to 422 with the
    message."""


@dataclass(frozen=True)
class Timeline:
    """One definition's Occurrences as a value: the stored facts, loaded
    once, behind the questions the app asks of them."""

    start: date
    interval_value: int
    interval_unit: str
    paid: frozenset[date]
    # The periods (ADR-0016) of the skipped Occurrences under the current
    # unit — already mapped through `period_of`.
    skipped_periods: frozenset[Period]
    # The stored skip dates themselves; `states` bounds its forward walk by
    # the span end of the largest one (ADR-0026).
    skip_dates: frozenset[date]
    # The day the definition was frozen, or None while active (ADR-0028).
    freeze_date: date | None

    @property
    def frozen(self) -> bool:
        """Whether the definition is frozen: its sequence ended the day
        before `freeze_date` (ADR-0028)."""
        return self.freeze_date is not None

    def occurrence(self, k: int) -> date:
        """The k-th Occurrence of the sequence (k = 0 is the start date)."""
        return occurrence_date(self.start, self.interval_value, self.interval_unit, k)

    def exists(self, due: date) -> bool:
        """Whether the definition generates an Occurrence on `due` at all:
        a frozen definition's sequence ends the day before its freeze date
        (ADR-0028), an active one never ends."""
        return self.freeze_date is None or due < self.freeze_date

    def is_paid(self, due: date) -> bool:
        """Whether a linked Transaction pins the Occurrence on `due`."""
        return due in self.paid

    def is_skipped(self, due: date) -> bool:
        """Whether the user excused the Occurrence on `due` (ADR-0016)."""
        return period_of(due, self.interval_unit) in self.skipped_periods

    def is_occurrence(self, due: date) -> bool:
        """Whether the definition generates an Occurrence on `due`: one of
        the sequence's dates, and one the freeze did not cut off
        (ADR-0028). The walk from the start matches the date exactly;
        dates strictly increase in k."""
        if not self.exists(due):
            return False
        k = 0
        while True:
            candidate = self.occurrence(k)
            if candidate == due:
                return True
            if candidate > due:
                return False
            k += 1

    def due_in(self, window_start: date, window_end: date) -> list[date]:
        """The dates of the Occurrences due inside `[window_start,
        window_end]`, both edges included, strictly increasing — paid or
        not (a late-paid Occurrence counts in its due month). Skipped
        Occurrences never enter (ADR-0016), nor do the ones a freeze cut
        off (ADR-0028)."""
        return [
            due
            for due in occurrences_in_window(
                self.start,
                self.interval_value,
                self.interval_unit,
                window_start,
                window_end,
                set(self.skipped_periods),
            )
            if self.exists(due)
        ]

    def next_due(self, today: date) -> date | None:
        """The next due date (ADR-0010): the first Occurrence whose own date
        is `today` or later, stepping past Skipped ones (ADR-0016). None
        for a frozen definition — it generates nothing (ADR-0028)."""
        if self.frozen:
            return None
        return next_due_date(
            self.start,
            self.interval_value,
            self.interval_unit,
            today,
            set(self.skipped_periods),
        )

    def backlog_count(self, today: date) -> int:
        """The Backlog (issue #58): Unpaid, un-Skipped Occurrences due
        `today` or earlier — the "N unpaid" badge. The pins and skips are
        stored, so editing the interval or start date reshapes only the
        derived future: an Occurrence a link covers or the user excused is
        never counted back in. A frozen definition has no Backlog — the
        freeze cleaned it (ADR-0028)."""
        if self.frozen:
            return 0
        return backlog_count(
            self.start,
            self.interval_value,
            self.interval_unit,
            today,
            set(self.paid),
            set(self.skipped_periods),
        )

    def oldest_unpaid(self) -> date | None:
        """The Occurrence a new link pays (issue #57): the oldest one no
        linked Transaction covers and the user did not skip — a Skipped
        Occurrence is never paid (ADR-0016), un-skipping comes first.
        Future Occurrences are included when nothing earlier is Unpaid, so
        paying ahead is natural; the sequence is infinite and the paid and
        skipped sets finite, so the walk always terminates. None for a
        frozen definition: it accepts no link (ADR-0028)."""
        if self.frozen:
            return None
        k = 0
        while True:
            due = self.occurrence(k)
            if not self.is_paid(due) and not self.is_skipped(due):
                return due
            k += 1

    def states(self, today: date) -> list[tuple[date, bool]]:
        """The Occurrences section's read (ADR-0026): every non-Paid
        Occurrence — its own date (ADR-0024) and whether the user excused
        it — newest first, the one order the modal renders. Paid history
        lives in the ledger: a row a link covers never appears (there is
        nothing to skip or un-skip on it). A frozen definition lists
        nothing: the freeze removed its Unpaid and Skipped Occurrences and
        generates no new ones (ADR-0028).

        The walk covers the past rows (due today or earlier — today first,
        down to the oldest), then the future rows: every Skipped future
        Occurrence stays on the list (an excused one must stay reachable,
        in date order), and the next incoming Unpaid one — the live row —
        heads the list: future Occurrences reveal one at a time, so a whole
        month can be excused by tapping the top row repeatedly in one
        sitting. The walk runs past the live row until the due date passes
        the span end of the largest stored period (app.recurrence
        .period_span_end), so restoring an earlier future row (un-skip in
        any order) never hides excused rows beyond it: every excused future
        Occurrence lies within its stored period's span. Paid future rows
        are stepped over; a dormant skip (a period holding no Occurrence of
        the current sequence) never matches anything.
        """
        if self.frozen:
            return []
        # Every Skipped future Occurrence lies at or before the span end of
        # the largest stored period: the walk past the live row only needs
        # to run until the due date passes that bound.
        walk_bound = max(
            (
                period_span_end(period_of(value, self.interval_unit))
                for value in self.skip_dates
            ),
            default=None,
        )
        rows: list[tuple[date, bool]] = []
        k = 0
        while True:
            due = self.occurrence(k)
            if due <= today:
                if not self.is_paid(due):
                    rows.append((due, self.is_skipped(due)))
                k += 1
                continue
            break
        live_row_found = False
        while True:
            due = self.occurrence(k)
            k += 1
            if self.is_paid(due):
                # A paid future Occurrence is stepped over, like every other
                # derived read walks past it.
                pass
            elif self.is_skipped(due):
                rows.append((due, True))
            elif not live_row_found:
                rows.append((due, False))
                live_row_found = True
            if live_row_found and (walk_bound is None or due > walk_bound):
                break
        # The one order the modal renders: the live row — the next incoming
        # Unpaid Occurrence — always heads the list, even when an un-skip in
        # any order leaves excused future rows newer than it (a restored row
        # must not hide or outrank the rows after it); every other row
        # follows newest first — the greyed future rows in date order, then
        # the past group (today first) down to the oldest.
        rows.sort(reverse=True)
        live = next((row for row in rows if row[0] > today and not row[1]), None)
        if live is None:
            return rows
        return [live] + [row for row in rows if row != live]


def timeline_for(
    session: Session,
    definition: Definition,
    *,
    exclude_transaction_id: int | None = None,
) -> Timeline:
    """The definition's Timeline, its pins and skips loaded in two queries.
    `exclude_transaction_id` drops one link's own pin: the Transaction being
    relinked judges itself as not yet paid, so it can re-pin the very
    Occurrence it already covers."""
    kind = kind_of(definition)
    pins = select(Transaction.occurrence_date).where(
        kind.pin_column == definition.id, Transaction.occurrence_date.is_not(None)
    )
    if exclude_transaction_id is not None:
        pins = pins.where(Transaction.id != exclude_transaction_id)
    paid = frozenset(
        value for value in session.scalars(pins).all() if value is not None
    )
    skip_dates = frozenset(
        session.scalars(
            select(RecurringSkip.occurrence_date).where(
                kind.skip_column == definition.id
            )
        ).all()
    )
    return Timeline(
        start=definition.start_date,
        interval_value=definition.interval_value,
        interval_unit=definition.interval_unit,
        paid=paid,
        skipped_periods=frozenset(
            period_of(value, definition.interval_unit) for value in skip_dates
        ),
        skip_dates=skip_dates,
        freeze_date=definition.freeze_date if definition.frozen else None,
    )


def set_skipped(
    session: Session, definition: Definition, date_str: str, *, skipped: bool
) -> None:
    """The per-Occurrence skip write (ADR-0026): PUT the Occurrence's date
    with {"skipped": true} to excuse it, {"skipped": false} to restore it —
    every row of the read toggles independently, in any order. A skip
    stores the Occurrence's own date, so it keeps anchoring to its period
    and traveling with the Occurrence (ADR-0016); un-skipping deletes the
    stored row whose period covers the target. The write is idempotent:
    stating the current state changes nothing, so a double tap cannot
    double-flip. Only Unpaid Occurrences are ever skipped — a link's pin
    rejects the skip, exactly as a link can never pay a Skipped one. A
    frozen definition has nothing to skip (ADR-0028): the freeze removed
    its Unpaid and Skipped Occurrences and generates no new ones, so the
    write is rejected."""
    try:
        occurrence = date.fromisoformat(date_str)
    except ValueError:
        raise OccurrenceRuleError(
            f"{date_str!r} is not a calendar day (YYYY-MM-DD)."
        ) from None
    if definition.frozen:
        raise OccurrenceRuleError(
            "A frozen recurring definition has no Occurrences to skip. "
            "Unfreeze it first."
        )
    unit = definition.interval_unit
    kind = kind_of(definition)
    if not skipped:
        # Restore: delete every stored row whose effective period covers the
        # target — period equality is what makes the anchor travel with the
        # Occurrence when the definition is edited (ADR-0016). Nothing to
        # delete is the idempotent no-op.
        target_period = period_of(occurrence, unit)
        rows = session.scalars(
            select(RecurringSkip).where(kind.skip_column == definition.id)
        ).all()
        for row in rows:
            if period_of(row.occurrence_date, unit) == target_period:
                session.delete(row)
        session.commit()
        return
    # Excuse: the target must be one of the definition's Occurrences (the
    # read only ever lists those), and one no link covers.
    timeline = timeline_for(session, definition)
    if not timeline.is_occurrence(occurrence):
        raise OccurrenceRuleError(
            "This date is not one of the definition's Occurrences."
        )
    if timeline.is_paid(occurrence):
        raise OccurrenceRuleError("A paid occurrence can never be skipped.")
    if timeline.is_skipped(occurrence):
        # Already excused — the idempotent no-op (the existing anchor may
        # be a different date on the same period after an edit).
        return
    session.add(
        RecurringSkip(**{kind.skip_key: definition.id}, occurrence_date=occurrence)
    )
    session.commit()
