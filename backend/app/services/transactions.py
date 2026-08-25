"""Transaction business rules. Called by the HTTP layer; never from tests.

Rules from CONTEXT.md: Expense/Income reference one Wallet of the Account;
Transfers reference Source and Destination Wallets that must differ, never
carry a Category, and never change Net Worth; Cash negativity is allowed but
warned (the indicator is computed at the HTTP layer from the derived Balance);
Contact Wallets move money via Transfers and may be the Wallet of an Expense
(consumption the contact paid for, ADR-0017); Incomes never touch them; a
Category attaches only to Transactions of its Type; Opening Balance
Transactions are created by the Wallet lifecycle and are read-only here. An
Expense may optionally link one Recurring Cost (issue #57) and an Income may Recurring
Income (issue #61), each paying exactly one Occurrence — the oldest Unpaid
one at link time, pinned then and never reassigned; because a Transaction is
one type, the two links can never coexist (at most one link per Transaction);
Transfer never carries a link (ADR-0010/0011).
"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dates import from_rome_day
from app.models import (
    Category,
    RecurringCost,
    RecurringIncome,
    Transaction,
    TransactionType,
    Wallet,
    WalletType,
)
from app.services import recurring_costs as recurring_service
from app.services import recurring_incomes as income_recurring_service
from app.services.scoping import owned_or_raise


class TransactionRuleError(Exception):
    """A CONTEXT.md rule rejects the write; maps to 422 with the message."""


def _ensure_wallet_writable(wallet: Wallet) -> None:
    """Raise when the Wallet is frozen (ADR-0002): no new Transactions can be
    created on it and its existing Transactions can neither be edited nor
    deleted."""
    if wallet.frozen:
        raise TransactionRuleError("Frozen Wallets are read-only")


def _locked_wallet(session: Session, wallet_id: int) -> Wallet:
    """The Wallet row locked FOR UPDATE, so that writes on it serialize with a
    concurrent freeze (whose Balance check must not see a stale sum)."""
    wallet = session.scalar(
        select(Wallet).where(Wallet.id == wallet_id).with_for_update()
    )
    # A Transaction's Wallet always exists: wallets are never hard-deleted
    # (ADR-0002), and every write validates ownership first.
    assert wallet is not None
    return wallet


def _locked_wallets(session: Session, *wallet_ids: int) -> dict[int, Wallet]:
    """The given Wallet rows, each locked FOR UPDATE. Locks are taken in
    ascending id order so two concurrent Transfers in opposite directions lock
    the same order and cannot deadlock."""
    return {wallet_id: _locked_wallet(session, wallet_id) for wallet_id in sorted(wallet_ids)}


def _transfer_legs(transaction: Transaction) -> tuple[int, int]:
    """The Source and Destination Wallet ids of a Transfer row (both are always
    set by `create_transaction`)."""
    if transaction.source_wallet_id is None or transaction.destination_wallet_id is None:
        raise TransactionRuleError("Transfers need source and destination Wallets")
    return transaction.source_wallet_id, transaction.destination_wallet_id


def _ensure_transaction_wallets_writable(
    session: Session, transaction: Transaction
) -> None:
    """Lock the Wallet(s) a write touches and raise when any is frozen
    (ADR-0002). A Transfer locks both legs in ascending id order; anything else
    locks its single Wallet. The lock also serializes the write against a
    concurrent freeze (whose Balance check must not see a stale sum)."""
    if transaction.type == TransactionType.TRANSFER.value:
        wallets = _locked_wallets(session, *_transfer_legs(transaction))
    else:
        assert transaction.wallet_id is not None  # Expense/Income always have one
        wallets = {transaction.wallet_id: _locked_wallet(session, transaction.wallet_id)}
    for wallet in wallets.values():
        _ensure_wallet_writable(wallet)

def _check_category_matches(session: Session, account_id: int, category_id: int, type: str) -> None:
    category = owned_or_raise(session, Category, account_id, category_id)
    if category.type != type:
        raise TransactionRuleError(
            "A Category attaches only to Transactions of its Type"
        )


def _check_create_rules(
    session: Session,
    account_id: int,
    *,
    type: str,
    wallet_id: int | None,
    source_wallet_id: int | None,
    destination_wallet_id: int | None,
    category_id: int | None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
) -> tuple[Wallet, ...]:
    """Every CONTEXT.md rule a create must satisfy, without locking or
    inserting. Returns the Wallets the create touches (the caller locks them
    before writing). `create_transaction` and the import pipeline's preview
    judge a create through this one set of rules, so a typed Transaction and
    an imported row cannot drift (T13 follow-up). The freeze rule is checked
    here (lock-free) and again under the lock in `create_transaction`, which
    is what serializes the write against a concurrent freeze."""
    if type not in (
        TransactionType.EXPENSE.value,
        TransactionType.INCOME.value,
        TransactionType.TRANSFER.value,
    ):
        raise TransactionRuleError("Type must be expense, income, or transfer")
    if type == TransactionType.TRANSFER.value:
        if wallet_id is not None or category_id is not None:
            raise TransactionRuleError(
                "Transfers use source and destination Wallets and never carry "
                "a Category"
            )
        if recurring_cost_id is not None:
            raise TransactionRuleError("Transfers never carry a Recurring Cost link")
        if recurring_income_id is not None:
            raise TransactionRuleError(
                "Transfers never carry a Recurring Income link"
            )
        if source_wallet_id is None or destination_wallet_id is None:
            raise TransactionRuleError("Transfers need source and destination Wallets")
        source = owned_or_raise(session, Wallet, account_id, source_wallet_id)
        destination = owned_or_raise(session, Wallet, account_id, destination_wallet_id)
        if source.id == destination.id:
            raise TransactionRuleError(
                "Source and Destination must be different Wallets"
            )
        for wallet in (source, destination):
            _ensure_wallet_writable(wallet)
        return source, destination
    if wallet_id is None:
        raise TransactionRuleError("wallet_id is required for Expense and Income")
    if source_wallet_id is not None or destination_wallet_id is not None:
        raise TransactionRuleError(
            "source and destination Wallets are only for Transfers"
        )
    wallet = owned_or_raise(session, Wallet, account_id, wallet_id)
    _ensure_wallet_writable(wallet)
    # ADR-0017: an Expense on a Contact Wallet records consumption the
    # contact paid for (the Balance moves toward zero or negative); Incomes
    # never touch Contact Wallets — money coming in from a contact is a
    # Transfer, and a gift is an Income on the user's own Wallet.
    if (
        wallet.type == WalletType.CONTACT.value
        and type != TransactionType.EXPENSE.value
    ):
        raise TransactionRuleError(
            "Incomes can't be recorded on Contact Wallets"
        )
    if category_id is not None:
        _check_category_matches(session, account_id, category_id, type)
    if recurring_cost_id is not None:
        if type != TransactionType.EXPENSE.value:
            raise TransactionRuleError(
                "Only Expenses can be linked to a Recurring Cost"
            )
        # Foreign or absent data is indistinguishable: owned_or_raise raises
        # NotOwned, mapped to 403 by the HTTP layer (ADR-0003).
        owned_or_raise(session, RecurringCost, account_id, recurring_cost_id)
    if recurring_income_id is not None:
        if type != TransactionType.INCOME.value:
            raise TransactionRuleError(
                "Only Incomes can be linked to a Recurring Income"
            )
        # Foreign or absent data is indistinguishable: owned_or_raise raises
        # NotOwned, mapped to 403 by the HTTP layer (ADR-0003).
        owned_or_raise(session, RecurringIncome, account_id, recurring_income_id)
    return (wallet,)


def validate_create(
    session: Session,
    account_id: int,
    *,
    type: str,
    wallet_id: int | None = None,
    source_wallet_id: int | None = None,
    destination_wallet_id: int | None = None,
    category_id: int | None = None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
) -> None:
    """Run every rule a create must satisfy, writing nothing. The import
    pipeline's preview validates rows through this so they are judged by the
    same rules as a typed Transaction; `create_transaction` runs the same
    checks and then locks and inserts. Imports never pass a recurring link
    (issues #57/#61: imported rows stay ordinary Transactions)."""
    _check_create_rules(
        session,
        account_id,
        type=type,
        wallet_id=wallet_id,
        source_wallet_id=source_wallet_id,
        destination_wallet_id=destination_wallet_id,
        category_id=category_id,
        recurring_cost_id=recurring_cost_id,
        recurring_income_id=recurring_income_id,
    )


def create_transaction(
    session: Session,
    account_id: int,
    *,
    type: str,
    amount: Decimal,
    date: str,
    wallet_id: int | None = None,
    source_wallet_id: int | None = None,
    destination_wallet_id: int | None = None,
    category_id: int | None = None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
    description: str | None = None,
    latitude: Decimal | None = None,
    longitude: Decimal | None = None,
    place_name: str | None = None,
    place_id: str | None = None,
    commit: bool = True,
) -> Transaction:
    # The rules are checked here (and by the import preview, through
    # validate_create) before any lock or insert: one set of rules for every
    # create path.
    wallets = _check_create_rules(
        session,
        account_id,
        type=type,
        wallet_id=wallet_id,
        source_wallet_id=source_wallet_id,
        destination_wallet_id=destination_wallet_id,
        category_id=category_id,
        recurring_cost_id=recurring_cost_id,
        recurring_income_id=recurring_income_id,
    )
    # The link pays the oldest Unpaid Occurrence at link time (issues #57 and
    # #61). The pin is stored on the row — never recomputed by later edits —
    # and the partial unique index on (recurring_income_id, occurrence_date)
    # (mirroring the cost index) guards the "one payer per Occurrence"
    # invariant against a concurrent double-link race.
    occurrence_date = None
    if recurring_cost_id is not None:
        cost = session.get(RecurringCost, recurring_cost_id)
        assert cost is not None  # _check_create_rules just validated ownership
        occurrence_date = recurring_service.oldest_unpaid_occurrence(session, cost)
    elif recurring_income_id is not None:
        income = session.get(RecurringIncome, recurring_income_id)
        assert income is not None  # _check_create_rules just validated ownership
        occurrence_date = income_recurring_service.oldest_unpaid_occurrence(
            session, income
        )
    # Lock the touched Wallets in ascending id order and enforce the freeze
    # rule under the lock, so the write serializes with a concurrent freeze
    # (whose Balance check must not see a stale sum).
    locked = _locked_wallets(session, *(wallet.id for wallet in wallets))
    for wallet in locked.values():
        _ensure_wallet_writable(wallet)
    if type == TransactionType.TRANSFER.value:
        transaction = Transaction(
            account_id=account_id,
            type=type,
            amount=amount,
            date=from_rome_day(date),
            source_wallet_id=source_wallet_id,
            destination_wallet_id=destination_wallet_id,
            description=description,
            latitude=latitude,
            longitude=longitude,
            place_name=place_name,
            place_id=place_id,
        )
    else:
        transaction = Transaction(
            account_id=account_id,
            wallet_id=wallet_id,
            type=type,
            amount=amount,
            date=from_rome_day(date),
            category_id=category_id,
            recurring_cost_id=recurring_cost_id,
            recurring_income_id=recurring_income_id,
            occurrence_date=occurrence_date,
            description=description,
            latitude=latitude,
            longitude=longitude,
            place_name=place_name,
            place_id=place_id,
        )
    session.add(transaction)
    if commit:
        # The import pipeline (T13) calls this with commit=False to insert many
        # rows in one transaction; the caller commits once (or rolls back).
        session.commit()
        session.refresh(transaction)
    return transaction


def update_transaction(
    session: Session, account_id: int, transaction: Transaction, *, changes: dict
) -> Transaction:
    """Apply the provided changes. `changes` comes from the schema's
    `model_dump(exclude_unset=True)`: a field present in the payload is applied
    even when its value is null (clearing the optional field); a field absent
    from the payload is untouched."""
    if transaction.type == TransactionType.OPENING_BALANCE.value:
        raise TransactionRuleError("Opening Balance Transactions are read-only")

    _ensure_transaction_wallets_writable(session, transaction)

    if transaction.type == TransactionType.TRANSFER.value:
        if "category_id" in changes:
            raise TransactionRuleError("Transfers never carry a Category")
    elif "category_id" in changes:
        category_id = changes["category_id"]
        if category_id is not None:
            _check_category_matches(
                session, account_id, category_id, transaction.type
            )
        transaction.category_id = category_id
    if "recurring_cost_id" in changes:
        recurring_cost_id = changes["recurring_cost_id"]
        if transaction.type != TransactionType.EXPENSE.value:
            raise TransactionRuleError(
                "Only Expenses can be linked to a Recurring Cost"
            )
        if recurring_cost_id is None:
            # Unlinking frees the Occurrence: the row's pin is cleared.
            transaction.recurring_cost_id = None
            transaction.occurrence_date = None
        else:
            # Linking (or relinking) pays the oldest Unpaid Occurrence right
            # now — the Transaction's own pin excluded, so it can re-pin the
            # very Occurrence it already covers. The assignment is pinned at
            # this moment: a later date edit never reassigns it (issue #57).
            owned_or_raise(session, RecurringCost, account_id, recurring_cost_id)
            cost = session.get(RecurringCost, recurring_cost_id)
            assert cost is not None  # owned_or_raise just fetched it
            transaction.recurring_cost_id = recurring_cost_id
            transaction.occurrence_date = recurring_service.oldest_unpaid_occurrence(
                session, cost, exclude_transaction_id=transaction.id
            )
    if "recurring_income_id" in changes:
        recurring_income_id = changes["recurring_income_id"]
        if transaction.type != TransactionType.INCOME.value:
            raise TransactionRuleError(
                "Only Incomes can be linked to a Recurring Income"
            )
        if recurring_income_id is None:
            # Unlinking frees the Occurrence: the row's pin is cleared.
            transaction.recurring_income_id = None
            transaction.occurrence_date = None
        else:
            # Linking (or relinking) pays the oldest Unpaid Occurrence right
            # now — the Transaction's own pin excluded, so it can re-pin the
            # very Occurrence it already covers. The assignment is pinned at
            # this moment: a later date edit never reassigns it (issue #61).
            owned_or_raise(session, RecurringIncome, account_id, recurring_income_id)
            income = session.get(RecurringIncome, recurring_income_id)
            assert income is not None  # owned_or_raise just fetched it
            transaction.recurring_income_id = recurring_income_id
            transaction.occurrence_date = (
                income_recurring_service.oldest_unpaid_occurrence(
                    session, income, exclude_transaction_id=transaction.id
                )
            )
    if "amount" in changes:
        transaction.amount = changes["amount"]
    if "date" in changes:
        transaction.date = from_rome_day(changes["date"])
    if "description" in changes:
        transaction.description = changes["description"]
    if "latitude" in changes or "longitude" in changes:
        latitude, longitude = changes.get("latitude"), changes.get("longitude")
        if (latitude is None) != (longitude is None):
            raise TransactionRuleError(
                "latitude and longitude must be set together"
            )
        transaction.latitude = latitude
        transaction.longitude = longitude
    # The Place reference follows the same contract: a field present in the
    # payload is applied even when null (clearing it); a field absent is
    # untouched, so a coordinates-only PATCH never disturbs a stored Place
    # (ADR-0005).
    if "place_name" in changes:
        transaction.place_name = changes["place_name"]
    if "place_id" in changes:
        transaction.place_id = changes["place_id"]

    session.commit()
    session.refresh(transaction)
    return transaction


def delete_transaction(session: Session, transaction: Transaction) -> None:
    if transaction.type == TransactionType.OPENING_BALANCE.value:
        raise TransactionRuleError("Opening Balance Transactions are read-only")
    _ensure_transaction_wallets_writable(session, transaction)
    session.delete(transaction)
    session.commit()
