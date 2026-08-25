import base64
import binascii
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.dates import ROME, from_rome_day, to_rome_day
from app.deps import get_session
from app.models import (
    Account,
    Category,
    RecurringCost,
    RecurringIncome,
    Transaction,
    TransactionType,
    Wallet,
    WalletType,
)
from app.schemas import (
    TransactionCreate,
    TransactionDeleteOut,
    TransactionOut,
    TransactionPage,
    TransactionUpdate,
    fmt_coord,
)
from app.services import scoping, transactions as transaction_service
from app.services import wallets as wallet_service
from app.services.exports import ExportRow, build_export_workbook

router = APIRouter(prefix="/transactions", tags=["transactions"])

# The .xlsx content type (US 7.3): the export is a file download, never JSON.
EXPORT_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _rome_day_or_422(value: str) -> datetime:
    """Parse a `YYYY-MM-DD` filter bound as a Europe/Rome day, or 422."""
    try:
        return from_rome_day(value)
    except ValueError:
        raise HTTPException(
            status_code=422, detail="Dates must be YYYY-MM-DD"
        ) from None


def _owned_transaction_or_403(
    session: Session, account: Account, transaction_id: int
) -> Transaction:
    """The Account's Transaction, or 403 — including for transactions that don't
    exist, so foreign data is never distinguishable from absent data (ADR-0003)."""
    try:
        return scoping.owned_or_raise(session, Transaction, account.id, transaction_id)
    except scoping.NotOwned:
        raise HTTPException(status_code=403, detail="Transaction not found") from None


def _transaction_out(
    session: Session, account: Account, transaction: Transaction, *, warning: bool
) -> TransactionOut:
    """The API view of any Transaction. Expense/Income/Opening Balance reference
    one Wallet; a Transfer references Source and Destination Wallets and never
    carries a Category. `warning` — the Cash negative-Balance indicator — is
    passed by the caller: writes (create, update, delete, import) compute it
    from the resulting Balance; reads always pass False, because the indicator
    belongs to the write, never to reads (US10/ID8)."""
    if transaction.type == TransactionType.TRANSFER.value:
        if transaction.source_wallet_id is None or transaction.destination_wallet_id is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        source = session.get(Wallet, transaction.source_wallet_id)
        destination = session.get(Wallet, transaction.destination_wallet_id)
        if source is None or destination is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        wallet_id = None
        source_wallet_id = source.id
        destination_wallet_id = destination.id
        category_id = None
    else:
        wallet_id = transaction.wallet_id
        if wallet_id is None:
            raise HTTPException(status_code=403, detail="Wallet not found")
        wallet = session.get(Wallet, wallet_id)
        if wallet is None:
            # A Transaction's Wallet always exists; it is validated on every write.
            raise HTTPException(status_code=403, detail="Wallet not found")
        source_wallet_id = None
        destination_wallet_id = None
        category_id = transaction.category_id
    return TransactionOut(
        id=transaction.id,
        type=TransactionType(transaction.type),
        amount=transaction.amount,
        date=to_rome_day(transaction.date),
        wallet_id=wallet_id,
        source_wallet_id=source_wallet_id,
        destination_wallet_id=destination_wallet_id,
        category_id=category_id,
        recurring_cost_id=transaction.recurring_cost_id,
        recurring_income_id=transaction.recurring_income_id,
        occurrence_date=(
            transaction.occurrence_date.isoformat()
            if transaction.occurrence_date is not None
            else None
        ),
        description=transaction.description,
        latitude=fmt_coord(transaction.latitude),
        longitude=fmt_coord(transaction.longitude),
        place_name=transaction.place_name,
        place_id=transaction.place_id,
        warning=warning,
        created_at=transaction.created_at,
    )


def _cash_wallet_negative(session: Session, account: Account, wallet_id: int) -> bool:
    """True when the Wallet is a Cash Wallet whose derived Balance is negative
    right now (US10/ID8: the indicator belongs to the write, never to reads)."""
    wallet = session.get(Wallet, wallet_id)
    assert wallet is not None  # validated on every write
    balance = wallet_service.wallet_balance(session, account.id, wallet.id)
    return wallet.type == WalletType.CASH.value and balance < 0


def _write_warning(session: Session, account: Account, transaction: Transaction) -> bool:
    """The indicator for a create/update response: whether the write left a Cash
    Wallet negative. For a Transfer only the Source can go negative — the
    Destination only gains."""
    if transaction.type == TransactionType.TRANSFER.value:
        wallet_id = transaction.source_wallet_id
    else:
        wallet_id = transaction.wallet_id
    assert wallet_id is not None  # validated on every write
    return _cash_wallet_negative(session, account, wallet_id)


def _delete_warning(session: Session, account: Account, transaction: Transaction) -> bool:
    """The indicator for a delete response: whether the delete left a Cash
    Wallet negative. Deleting undoes the row — an Income delete drops the
    Wallet's Balance and a Transfer delete drops the Destination (the Source
    gains back what it sent) — so those are the wallets a delete can push
    negative."""
    if transaction.type == TransactionType.TRANSFER.value:
        wallet_id = transaction.destination_wallet_id
    else:
        wallet_id = transaction.wallet_id
    assert wallet_id is not None  # validated on every write
    return _cash_wallet_negative(session, account, wallet_id)


_PAGE_LIMIT_DEFAULT = 50
_PAGE_LIMIT_MAX = 100


def _encode_cursor(date: datetime, transaction_id: int) -> str:
    """The opaque cursor naming the (date, id) a page ended at. Clients never
    parse it — they hand it back verbatim to fetch the next page."""
    payload = json.dumps(
        {"d": date.isoformat(), "i": transaction_id}, separators=(",", ":")
    )
    return base64.urlsafe_b64encode(payload.encode("ascii")).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    """The (date, id) an opaque cursor names, or 422 for any malformed token.

    A cursor is well-formed only when it decodes to a JSON object carrying a
    timezone-aware timestamp `d` and an integer `i`; anything else — garbage
    bytes, wrong types, a naive timestamp — is malformed and rejected
    outright (the token is opaque to clients, so there is nothing to guess).
    """
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode("ascii")))
        date = datetime.fromisoformat(payload["d"])
        transaction_id = payload["i"]
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error):
        raise HTTPException(status_code=422, detail="Invalid cursor") from None
    if (
        not isinstance(transaction_id, int)
        or isinstance(transaction_id, bool)
        or date.tzinfo is None
    ):
        raise HTTPException(status_code=422, detail="Invalid cursor")
    return date, transaction_id


def _apply_ledger_filters(
    stmt: Select[tuple[Transaction]],
    session: Session,
    account: Account,
    *,
    wallet_id: int | None,
    category_id: int | None,
    from_date: str | None,
    to_date: str | None,
    q: str | None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
) -> Select[tuple[Transaction]]:
    """The ledger's one filter set, shared by the listing and the export so
    the two can never drift: the Account's rows, narrowed by a Wallet
    (frozen ones included, matching a Transfer on either leg), a Category,
    an inclusive Europe/Rome date range (`YYYY-MM-DD` days), the
    Description needle (ADR-0009: case-insensitive, accent-exact, literal;
    a blank `q` is no filter), and the Recurring link — a specific
    definition id narrows to the Transactions linked to exactly that
    Recurring Cost or Recurring Income (issue #86; the two never combine,
    a Transaction is one type). Foreign or missing ids are 403 — the same
    answer the listing gives, so export and ledger filter identically."""
    stmt = stmt.where(Transaction.account_id == account.id)
    needle = (q or "").strip()
    if needle:
        # ADR-0009: both sides are lowered (so the match is case-insensitive,
        # accents untouched) and the needle's LIKE wildcards are escaped, so
        # % and _ inside it match themselves.
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(
            func.lower(Transaction.description).like(
                func.lower(f"%{escaped}%"), escape="\\"
            )
        )
    if wallet_id is not None:
        try:
            scoping.owned_or_raise(session, Wallet, account.id, wallet_id)
        except scoping.NotOwned:
            raise HTTPException(status_code=403, detail="Wallet not found") from None
        # A Wallet's history includes Transfers touching it on either leg.
        stmt = stmt.where(
            (Transaction.wallet_id == wallet_id)
            | (Transaction.source_wallet_id == wallet_id)
            | (Transaction.destination_wallet_id == wallet_id)
        )
    if category_id is not None:
        try:
            scoping.owned_or_raise(session, Category, account.id, category_id)
        except scoping.NotOwned:
            raise HTTPException(status_code=403, detail="Category not found") from None
        stmt = stmt.where(Transaction.category_id == category_id)
    if recurring_cost_id is not None:
        try:
            scoping.owned_or_raise(session, RecurringCost, account.id, recurring_cost_id)
        except scoping.NotOwned:
            raise HTTPException(
                status_code=403, detail="Recurring Cost not found"
            ) from None
        # The Recurring link filter (issue #86): rows pinned to exactly this
        # definition. The same shape as the Wallet/Category filters, so a
        # missing or foreign definition answers 403 like they do.
        stmt = stmt.where(Transaction.recurring_cost_id == recurring_cost_id)
    if recurring_income_id is not None:
        try:
            scoping.owned_or_raise(session, RecurringIncome, account.id, recurring_income_id)
        except scoping.NotOwned:
            raise HTTPException(
                status_code=403, detail="Recurring Income not found"
            ) from None
        stmt = stmt.where(Transaction.recurring_income_id == recurring_income_id)
    if from_date is not None:
        stmt = stmt.where(Transaction.date >= _rome_day_or_422(from_date))
    if to_date is not None:
        # Inclusive upper bound: strictly before the next Rome day.
        stmt = stmt.where(
            Transaction.date < _rome_day_or_422(to_date) + timedelta(days=1)
        )
    return stmt


def _export_row(session: Session, transaction: Transaction) -> ExportRow:
    """The template row for one Transaction: names resolved against the
    Account (the ids are the Account's own — reads always pass through
    scoping), the Europe/Rome day, and the coordinates the location column
    carries. Opening Balance never reaches here (ADR-0015); a blank or
    missing description writes the same cell."""
    if transaction.type == TransactionType.TRANSFER.value:
        source = session.get(Wallet, transaction.source_wallet_id)
        destination = session.get(Wallet, transaction.destination_wallet_id)
        return ExportRow(
            date=to_rome_day(transaction.date),
            type=transaction.type,
            amount=transaction.amount,
            wallet=None,
            source_wallet=source.name if source is not None else None,
            destination_wallet=destination.name if destination is not None else None,
            category=None,
            description=transaction.description,
            latitude=transaction.latitude,
            longitude=transaction.longitude,
        )
    wallet = session.get(Wallet, transaction.wallet_id)
    category = (
        session.get(Category, transaction.category_id)
        if transaction.category_id is not None
        else None
    )
    return ExportRow(
        date=to_rome_day(transaction.date),
        type=transaction.type,
        amount=transaction.amount,
        wallet=wallet.name if wallet is not None else None,
        source_wallet=None,
        destination_wallet=None,
        category=category.name if category is not None else None,
        description=transaction.description,
        latitude=transaction.latitude,
        longitude=transaction.longitude,
    )


@router.get("/export")
def export_transactions(
    wallet_id: int | None = None,
    category_id: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    q: str | None = None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> Response:
    """The ledger as the import template's .xlsx (US 7.3): every Transaction
    matching the same filters as the listing, excluding Opening Balance
    (the template's type vocabulary has no value for them — ADR-0015), in
    date-ascending order. The file downloads with a dated name, so exports
    of the same ledger never overwrite each other."""
    stmt = select(Transaction)
    stmt = _apply_ledger_filters(
        stmt,
        session,
        account,
        wallet_id=wallet_id,
        category_id=category_id,
        from_date=from_date,
        to_date=to_date,
        q=q,
        recurring_cost_id=recurring_cost_id,
        recurring_income_id=recurring_income_id,
    )
    stmt = stmt.where(Transaction.type != TransactionType.OPENING_BALANCE.value)
    transactions = session.scalars(
        stmt.order_by(Transaction.date.asc(), Transaction.id.asc())
    ).all()
    rows = [_export_row(session, t) for t in transactions]
    filename = f"budjetame-{datetime.now(ROME).strftime('%Y-%m-%d')}.xlsx"
    return Response(
        content=build_export_workbook(rows),
        media_type=EXPORT_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("", response_model=TransactionPage)
def list_transactions(
    wallet_id: int | None = None,
    category_id: int | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    q: str | None = None,
    recurring_cost_id: int | None = None,
    recurring_income_id: int | None = None,
    limit: int = Query(default=_PAGE_LIMIT_DEFAULT, ge=1, le=_PAGE_LIMIT_MAX),
    cursor: str | None = None,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionPage:
    """The ledger listing, newest first, one page at a time (cursor paging).

    Filters compose — a Wallet (including frozen Wallets, whose history stays
    viewable), a Category, a Europe/Rome inclusive date range
    (`YYYY-MM-DD` days), and the Recurring link (a specific definition id
    narrows to the Transactions linked to exactly that Recurring Cost or
    Recurring Income, issue #86) — with the paging: a page is the first
    `limit` rows strictly after the cursor's (date, id), so rows inserted
    mid-scroll (e.g. by Import) can never duplicate or skip already-fetched
    rows. `next_cursor` is null exactly when no further rows remain. `q`
    narrows to rows whose Description contains the needle as a
    case-insensitive, accent-exact, literal substring (ADR-0009); a blank
    or whitespace-only `q` is no filter.
    """
    stmt = select(Transaction)
    stmt = _apply_ledger_filters(
        stmt,
        session,
        account,
        wallet_id=wallet_id,
        category_id=category_id,
        from_date=from_date,
        to_date=to_date,
        q=q,
        recurring_cost_id=recurring_cost_id,
        recurring_income_id=recurring_income_id,
    )
    if cursor is not None:
        cursor_date, cursor_id = _decode_cursor(cursor)
        # Keyset boundary (date desc, id desc): only rows strictly older than
        # the cursor's row — the boundary never moves, so a mid-scroll insert
        # can neither duplicate nor skip rows across pages.
        stmt = stmt.where(
            (Transaction.date < cursor_date)
            | ((Transaction.date == cursor_date) & (Transaction.id < cursor_id))
        )
    # One extra row tells whether a next page exists, so `next_cursor` is null
    # exactly when nothing remains — the client never fetches an empty page.
    rows = session.scalars(
        stmt.order_by(Transaction.date.desc(), Transaction.id.desc()).limit(limit + 1)
    ).all()
    page = rows[:limit]
    next_cursor = _encode_cursor(page[-1].date, page[-1].id) if len(rows) > limit else None
    # Reads never carry the Cash negative-Balance indicator (US10/ID8): it
    # belongs to the write that changed the Balance.
    return TransactionPage(
        items=[_transaction_out(session, account, t, warning=False) for t in page],
        next_cursor=next_cursor,
    )


@router.post("", response_model=TransactionOut, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionOut:
    try:
        transaction = transaction_service.create_transaction(
            session,
            account.id,
            type=payload.type,
            amount=payload.amount,
            date=payload.date,
            wallet_id=payload.wallet_id,
            source_wallet_id=payload.source_wallet_id,
            destination_wallet_id=payload.destination_wallet_id,
            category_id=payload.category_id,
            recurring_cost_id=payload.recurring_cost_id,
            recurring_income_id=payload.recurring_income_id,
            description=payload.description,
            latitude=payload.latitude,
            longitude=payload.longitude,
            place_name=payload.place_name,
            place_id=payload.place_id,
        )
    except scoping.NotOwned:
        raise HTTPException(
            status_code=403,
            detail="Wallet, Category, Recurring Cost, or Recurring Income not found",
        )
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return _transaction_out(
        session,
        account,
        transaction,
        warning=_write_warning(session, account, transaction),
    )


@router.patch("/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionOut:
    transaction = _owned_transaction_or_403(session, account, transaction_id)
    try:
        transaction = transaction_service.update_transaction(
            session,
            account.id,
            transaction,
            changes=payload.model_dump(exclude_unset=True),
        )
    except scoping.NotOwned:
        raise HTTPException(
            status_code=403,
            detail="Wallet, Category, Recurring Cost, or Recurring Income not found",
        )
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return _transaction_out(
        session,
        account,
        transaction,
        warning=_write_warning(session, account, transaction),
    )


@router.delete("/{transaction_id}", response_model=TransactionDeleteOut)
def delete_transaction(
    transaction_id: int,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> TransactionDeleteOut:
    """Delete a Transaction (US10/ID8): the response carries the Cash
    negative-Balance indicator — true exactly when the delete left a Cash
    Wallet negative; reads never carry it."""
    transaction = _owned_transaction_or_403(session, account, transaction_id)
    try:
        transaction_service.delete_transaction(session, transaction)
    except transaction_service.TransactionRuleError as error:
        raise HTTPException(status_code=422, detail=str(error))
    return TransactionDeleteOut(warning=_delete_warning(session, account, transaction))
