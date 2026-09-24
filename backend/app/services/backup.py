"""Backup pipeline (issue #112): build a multi-sheet backup workbook carrying
the Account's whole data state, and (issue #115): restore from a backup
workbook atomically.

The builder is pure (no database access) — it formats already-resolved data
whose names were resolved against the Account by the route, exactly like
`services.exports` and `services.imports`. The file is a multi-sheet workbook:

- Transactions (all types, including Opening Balances — unlike the ledger Export)
- Wallets
- Categories
- Recurring Costs
- Recurring Incomes
- Skips
- Metadata (origin marker)

Entities are keyed by name; original database ids are carried alongside for
reference (ADR-0030).
"""

from dataclasses import dataclass
from datetime import date as DateObj, datetime
from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException
from openpyxl import Workbook, load_workbook
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.dates import from_rome_day
from app.models import (
    Account,
    Category,
    RecurringCost,
    RecurringIncome,
    RecurringSkip,
    Transaction,
    Wallet,
)

TRANSACTIONS_HEADER = [
    "date",
    "type",
    "amount",
    "wallet",
    "source wallet",
    "destination wallet",
    "category",
    "description",
    "location",
    "recurring cost",
    "recurring income",
    "occurrence date",
    "id",
]

WALLETS_HEADER = [
    "name",
    "type",
    "frozen",
    "id",
]

CATEGORIES_HEADER = [
    "name",
    "type",
    "icon",
    "color",
    "id",
]

RECURRING_DEFINITION_HEADER = [
    "name",
    "amount",
    "interval value",
    "interval unit",
    "start date",
    "frozen",
    "freeze date",
    "id",
]

SKIPS_HEADER = [
    "definition name",
    "definition type",
    "occurrence date",
    "id",
]

METADATA_HEADER = [
    "key",
    "value",
]


@dataclass(frozen=True, slots=True)
class BackupTransaction:
    """One row of the Transactions sheet, with names (not ids) for Wallet,
    Category, and Recurring links. All Transaction types are included,
    including Opening Balances."""

    date: str
    type: str
    amount: Decimal
    wallet: str | None
    source_wallet: str | None
    destination_wallet: str | None
    category: str | None
    description: str | None
    latitude: Decimal | None
    longitude: Decimal | None
    recurring_cost: str | None
    recurring_income: str | None
    occurrence_date: str | None
    id: int


@dataclass(frozen=True, slots=True)
class BackupWallet:
    name: str
    type: str
    frozen: bool
    id: int


@dataclass(frozen=True, slots=True)
class BackupCategory:
    name: str
    type: str
    icon: str | None
    color: str
    id: int


@dataclass(frozen=True, slots=True)
class BackupRecurringDefinition:
    name: str
    amount: Decimal
    interval_value: int
    interval_unit: str
    start_date: str
    frozen: bool
    freeze_date: str | None
    id: int


@dataclass(frozen=True, slots=True)
class BackupSkip:
    definition_name: str
    definition_type: str  # "cost" or "income"
    occurrence_date: str
    id: int


def _coord(value: Decimal | None) -> str:
    """Shortest-decimal coordinate form — same as the Export format."""
    if value is None:
        return ""
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _str_or_blank(value: str | None) -> str:
    return "" if value is None else value


def _str_or_blank_date(value: str | None) -> str:
    return "" if value is None else value


def build_backup_workbook(
    transactions: list[BackupTransaction],
    wallets: list[BackupWallet],
    categories: list[BackupCategory],
    recurring_costs: list[BackupRecurringDefinition],
    recurring_incomes: list[BackupRecurringDefinition],
    skips: list[BackupSkip],
    origin: str,
) -> bytes:
    """Build the multi-sheet backup workbook.

    Each sheet has a header row followed by data rows. The Metadata sheet
    carries the origin marker (the Account's email). Entities are keyed by
    name; database ids are included for reference.
    """
    workbook = Workbook()

    # --- Metadata sheet (always first, for quick inspection) ---
    metadata_sheet = workbook.active
    assert metadata_sheet is not None  # a new Workbook always has one active sheet
    metadata_sheet.title = "Metadata"
    metadata_sheet.append(METADATA_HEADER)
    metadata_sheet.append(["origin", origin])
    metadata_sheet.append(["exported_at", __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).isoformat()])

    # --- Transactions sheet ---
    tx_sheet = workbook.create_sheet("Transactions")
    tx_sheet.append(TRANSACTIONS_HEADER)
    for tx in transactions:
        location = (
            f"{_coord(tx.latitude)},{_coord(tx.longitude)}"
            if tx.latitude is not None and tx.longitude is not None
            else ""
        )
        tx_sheet.append([
            tx.date,
            tx.type,
            f"{tx.amount:.2f}",
            _str_or_blank(tx.wallet),
            _str_or_blank(tx.source_wallet),
            _str_or_blank(tx.destination_wallet),
            _str_or_blank(tx.category),
            _str_or_blank(tx.description),
            location,
            _str_or_blank(tx.recurring_cost),
            _str_or_blank(tx.recurring_income),
            _str_or_blank_date(tx.occurrence_date),
            tx.id,
        ])

    # --- Wallets sheet ---
    wallet_sheet = workbook.create_sheet("Wallets")
    wallet_sheet.append(WALLETS_HEADER)
    for w in wallets:
        wallet_sheet.append([
            w.name,
            w.type,
            str(w.frozen),
            w.id,
        ])

    # --- Categories sheet ---
    cat_sheet = workbook.create_sheet("Categories")
    cat_sheet.append(CATEGORIES_HEADER)
    for c in categories:
        cat_sheet.append([
            c.name,
            c.type,
            _str_or_blank(c.icon),
            c.color,
            c.id,
        ])

    # --- Recurring Costs sheet ---
    rc_sheet = workbook.create_sheet("Recurring Costs")
    rc_sheet.append(RECURRING_DEFINITION_HEADER)
    for rc in recurring_costs:
        rc_sheet.append([
            rc.name,
            f"{rc.amount:.2f}",
            rc.interval_value,
            rc.interval_unit,
            rc.start_date,
            str(rc.frozen),
            _str_or_blank_date(rc.freeze_date),
            rc.id,
        ])

    # --- Recurring Incomes sheet ---
    ri_sheet = workbook.create_sheet("Recurring Incomes")
    ri_sheet.append(RECURRING_DEFINITION_HEADER)
    for ri in recurring_incomes:
        ri_sheet.append([
            ri.name,
            f"{ri.amount:.2f}",
            ri.interval_value,
            ri.interval_unit,
            ri.start_date,
            str(ri.frozen),
            _str_or_blank_date(ri.freeze_date),
            ri.id,
        ])

    # --- Skips sheet ---
    skips_sheet = workbook.create_sheet("Skips")
    skips_sheet.append(SKIPS_HEADER)
    for s in skips:
        skips_sheet.append([
            s.definition_name,
            s.definition_type,
            s.occurrence_date,
            s.id,
        ])

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


# --- Restore (issue #115) ----------------------------------------------------


def _parse_cell(value: object) -> str:
    """Normalise a workbook cell to a trimmed string. None becomes empty
    string; numbers become their string representation."""
    if value is None:
        return ""
    value = str(value).strip()
    return value


def _parse_decimal(value: str) -> Decimal:
    """Parse an amount cell."""
    try:
        return Decimal(value)
    except Exception:
        raise HTTPException(status_code=422, detail=f"Invalid decimal value: {value!r}")


def _parse_bool(value: str) -> bool:
    """Parse a frozen cell: 'True' or 'False'."""
    if value.lower() in ("true", "1", "yes"):
        return True
    if value.lower() in ("false", "0", "no") or value == "":
        return False
    raise HTTPException(status_code=422, detail=f"Invalid boolean value: {value!r}")


def _check_header(actual: list[str], expected: list[str], sheet_name: str) -> None:
    """Raise 422 when the sheet's header doesn't match the expected columns."""
    if len(actual) != len(expected):
        raise HTTPException(
            status_code=422,
            detail=f"Sheet {sheet_name!r} has {len(actual)} columns, expected {len(expected)}",
        )
    for i, (a, e) in enumerate(zip(actual, expected)):
        if a.lower().strip() != e.lower().strip():
            raise HTTPException(
                status_code=422,
                detail=f"Sheet {sheet_name!r} column {i}: expected {e!r}, got {a!r}",
            )


def _validate_and_parse_workbook(
    content: bytes,
) -> tuple[
    str | None,  # origin marker
    list[BackupWallet],
    list[BackupCategory],
    list[BackupRecurringDefinition],  # costs
    list[BackupRecurringDefinition],  # incomes
    list[BackupSkip],
    list[BackupTransaction],
]:
    """Parse and validate all sheets of a backup workbook. Raises 422 on any
    malformation. Returns the parsed data."""
    try:
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse workbook: {e}")

    required_sheets = {
        "Metadata", "Transactions", "Wallets", "Categories",
        "Recurring Costs", "Recurring Incomes", "Skips",
    }
    missing = required_sheets - set(workbook.sheetnames)
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing sheets: {', '.join(sorted(missing))}",
        )

    # --- Metadata ---
    meta_sheet = workbook["Metadata"]
    meta_rows = list(meta_sheet.iter_rows(values_only=True))
    workbook.close()

    if len(meta_rows) < 1:
        raise HTTPException(status_code=422, detail="Metadata sheet is empty")
    _check_header(
        [_parse_cell(c) for c in meta_rows[0]],
        METADATA_HEADER,
        "Metadata",
    )

    origin: str | None = None
    for row in meta_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        if cells[0].lower() == "origin":
            origin = cells[1]
            break
    # origin is None for truly empty metadata — we allow it and detect later

    # We need to re-open in writeable mode later for the round-trip test, but
    # for validation we've already closed. Let's re-open for the actual data.
    workbook = load_workbook(BytesIO(content), read_only=False, data_only=True)

    # --- Wallets ---
    wallet_sheet = workbook["Wallets"]
    wallet_rows = list(wallet_sheet.iter_rows(values_only=True))
    if len(wallet_rows) < 1:
        raise HTTPException(status_code=422, detail="Wallets sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in wallet_rows[0]],
        WALLETS_HEADER,
        "Wallets",
    )
    wallets: list[BackupWallet] = []
    seen_wallet_names: set[str] = set()
    for row in wallet_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        name = cells[0]
        if not name:
            raise HTTPException(status_code=422, detail="Wallets sheet has a row with empty name")
        if name.lower() in seen_wallet_names:
            raise HTTPException(
                status_code=422, detail=f"Duplicate wallet name in backup: {name!r}"
            )
        seen_wallet_names.add(name.lower())
        wallets.append(BackupWallet(
            name=name,
            type=cells[1],
            frozen=_parse_bool(cells[2]),
            id=int(cells[3]) if cells[3] else 0,
        ))

    # --- Categories ---
    cat_sheet = workbook["Categories"]
    cat_rows = list(cat_sheet.iter_rows(values_only=True))
    if len(cat_rows) < 1:
        raise HTTPException(status_code=422, detail="Categories sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in cat_rows[0]],
        CATEGORIES_HEADER,
        "Categories",
    )
    categories: list[BackupCategory] = []
    seen_cat_names: set[tuple[str, str]] = set()
    for row in cat_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        name = cells[0]
        cat_type = cells[1]
        if not name or not cat_type:
            raise HTTPException(status_code=422, detail="Categories sheet has row with empty name or type")
        key = (name.lower(), cat_type.lower())
        if key in seen_cat_names:
            raise HTTPException(
                status_code=422, detail=f"Duplicate category in backup: {name!r} ({cat_type})"
            )
        seen_cat_names.add(key)
        categories.append(BackupCategory(
            name=name,
            type=cat_type,
            icon=cells[2] if cells[2] else None,
            color=cells[3] if cells[3] else "#ef4444",
            id=int(cells[4]) if cells[4] else 0,
        ))

    # --- Recurring Costs ---
    rc_sheet = workbook["Recurring Costs"]
    rc_rows = list(rc_sheet.iter_rows(values_only=True))
    if len(rc_rows) < 1:
        raise HTTPException(status_code=422, detail="Recurring Costs sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in rc_rows[0]],
        RECURRING_DEFINITION_HEADER,
        "Recurring Costs",
    )
    costs: list[BackupRecurringDefinition] = []
    seen_cost_names: set[str] = set()
    for row in rc_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        name = cells[0]
        if not name:
            raise HTTPException(status_code=422, detail="Recurring Costs sheet has row with empty name")
        if name.lower() in seen_cost_names:
            raise HTTPException(
                status_code=422, detail=f"Duplicate recurring cost name in backup: {name!r}"
            )
        seen_cost_names.add(name.lower())
        costs.append(BackupRecurringDefinition(
            name=name,
            amount=_parse_decimal(cells[1]),
            interval_value=int(cells[2]) if cells[2] else 1,
            interval_unit=cells[3],
            start_date=cells[4],
            frozen=_parse_bool(cells[5]),
            freeze_date=cells[6] if cells[6] else None,
            id=int(cells[7]) if cells[7] else 0,
        ))

    # --- Recurring Incomes ---
    ri_sheet = workbook["Recurring Incomes"]
    ri_rows = list(ri_sheet.iter_rows(values_only=True))
    if len(ri_rows) < 1:
        raise HTTPException(status_code=422, detail="Recurring Incomes sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in ri_rows[0]],
        RECURRING_DEFINITION_HEADER,
        "Recurring Incomes",
    )
    incomes: list[BackupRecurringDefinition] = []
    seen_income_names: set[str] = set()
    for row in ri_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        name = cells[0]
        if not name:
            raise HTTPException(status_code=422, detail="Recurring Incomes sheet has row with empty name")
        if name.lower() in seen_income_names:
            raise HTTPException(
                status_code=422, detail=f"Duplicate recurring income name in backup: {name!r}"
            )
        seen_income_names.add(name.lower())
        incomes.append(BackupRecurringDefinition(
            name=name,
            amount=_parse_decimal(cells[1]),
            interval_value=int(cells[2]) if cells[2] else 1,
            interval_unit=cells[3],
            start_date=cells[4],
            frozen=_parse_bool(cells[5]),
            freeze_date=cells[6] if cells[6] else None,
            id=int(cells[7]) if cells[7] else 0,
        ))

    # --- Skips ---
    skips_sheet = workbook["Skips"]
    skips_rows = list(skips_sheet.iter_rows(values_only=True))
    if len(skips_rows) < 1:
        raise HTTPException(status_code=422, detail="Skips sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in skips_rows[0]],
        SKIPS_HEADER,
        "Skips",
    )
    skips_list: list[BackupSkip] = []
    for row in skips_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        skips_list.append(BackupSkip(
            definition_name=cells[0],
            definition_type=cells[1],
            occurrence_date=cells[2],
            id=int(cells[3]) if cells[3] else 0,
        ))

    # --- Transactions ---
    tx_sheet_src = workbook["Transactions"]
    tx_rows = list(tx_sheet_src.iter_rows(values_only=True))
    if len(tx_rows) < 1:
        raise HTTPException(status_code=422, detail="Transactions sheet is empty (no header)")
    _check_header(
        [_parse_cell(c) for c in tx_rows[0]],
        TRANSACTIONS_HEADER,
        "Transactions",
    )
    transactions: list[BackupTransaction] = []
    for row in tx_rows[1:]:
        cells = [_parse_cell(c) for c in row]
        # Parse location: "lat,lon" or blank
        lat: Decimal | None = None
        lon: Decimal | None = None
        loc = cells[8]
        if loc and "," in loc:
            try:
                lat = Decimal(loc.split(",")[0])
                lon = Decimal(loc.split(",")[1])
            except Exception:
                raise HTTPException(
                    status_code=422, detail=f"Invalid location in Transactions: {loc!r}"
                )
        transactions.append(BackupTransaction(
            date=cells[0],
            type=cells[1],
            amount=_parse_decimal(cells[2]),
            wallet=cells[3] if cells[3] else None,
            source_wallet=cells[4] if cells[4] else None,
            destination_wallet=cells[5] if cells[5] else None,
            category=cells[6] if cells[6] else None,
            description=cells[7] if cells[7] else None,
            latitude=lat,
            longitude=lon,
            recurring_cost=cells[9] if cells[9] else None,
            recurring_income=cells[10] if cells[10] else None,
            occurrence_date=cells[11] if cells[11] else None,
            id=int(cells[12]) if cells[12] else 0,
        ))

    workbook.close()
    return origin, wallets, categories, costs, incomes, skips_list, transactions


def restore_from_backup(
    session: Session,
    *,
    account: Account,
    content: bytes,
) -> dict[str, object]:
    """Validate and restore an Account's data from a backup workbook.

    Parses and validates every sheet, then atomically replaces all of the
    Account's current Transactions, Wallets, Categories, Recurring
    definitions, and skips with the file's contents — a rollback to the
    point in time the backup was exported.

    Returns {'status': 'ok'} with an optional 'warning' key when the origin
    marker doesn't match. Raises HTTPException 422 on validation failure
    (fail-closed: nothing changes).

    Account email, credentials, and Locale are left untouched (ADR-0030).
    """
    origin, wallets, categories, costs, incomes, skips_list, transactions = (
        _validate_and_parse_workbook(content)
    )

    # Check origin marker
    warning: str | None = None
    if origin is not None and origin.lower() != account.email.lower():
        warning = (
            f"Backup was exported from {origin}, not from {account.email}. "
            "Proceeding will replace all data with the backup's contents."
        )

    # Build name-to-new-id maps for entity references
    wallet_name_map: dict[str, int] = {}
    category_name_type_map: dict[tuple[str, str], int] = {}  # (name.lower(), type) -> id
    cost_name_map: dict[str, int] = {}
    income_name_map: dict[str, int] = {}

    try:
        # Delete existing data for this Account (order respects FKs)
        # 1. Transactions (owned by account)
        session.execute(
            delete(Transaction).where(Transaction.account_id == account.id)
        )
        # 2. Skips (owned via recurring definitions)
        cost_ids = select(RecurringCost.id).where(RecurringCost.account_id == account.id)
        income_ids = select(RecurringIncome.id).where(RecurringIncome.account_id == account.id)
        session.execute(
            delete(RecurringSkip).where(
                RecurringSkip.recurring_cost_id.in_(cost_ids)
                | RecurringSkip.recurring_income_id.in_(income_ids)
            )
        )
        # 3. Recurring definitions
        session.execute(
            delete(RecurringCost).where(RecurringCost.account_id == account.id)
        )
        session.execute(
            delete(RecurringIncome).where(RecurringIncome.account_id == account.id)
        )
        # 4. Categories
        session.execute(
            delete(Category).where(Category.account_id == account.id)
        )
        # 5. Wallets
        session.execute(
            delete(Wallet).where(Wallet.account_id == account.id)
        )

        # --- Insert Wallets (build name→id map) ---
        for w in wallets:
            wallet = Wallet(
                account_id=account.id,
                name=w.name,
                type=w.type,
                frozen=w.frozen,
            )
            session.add(wallet)
            session.flush()
            wallet_name_map[w.name.lower()] = wallet.id

        # --- Insert Categories (build (name,type)→id map) ---
        for c in categories:
            cat = Category(
                account_id=account.id,
                name=c.name,
                type=c.type,
                icon=c.icon,
                color=c.color,
            )
            session.add(cat)
            session.flush()
            category_name_type_map[(c.name.lower(), c.type.lower())] = cat.id

        # --- Insert Recurring Costs (build name→id map) ---
        for rc in costs:
            start_date = DateObj.fromisoformat(rc.start_date) if rc.start_date else datetime.utcnow().date()
            freeze_date = DateObj.fromisoformat(rc.freeze_date) if rc.freeze_date else None
            cost = RecurringCost(
                account_id=account.id,
                name=rc.name,
                amount=rc.amount,
                interval_value=rc.interval_value,
                interval_unit=rc.interval_unit,
                start_date=start_date,
                frozen=rc.frozen,
                freeze_date=freeze_date,
            )
            session.add(cost)
            session.flush()
            cost_name_map[rc.name.lower()] = cost.id

        # --- Insert Recurring Incomes (build name→id map) ---
        for ri in incomes:
            start_date = DateObj.fromisoformat(ri.start_date) if ri.start_date else datetime.utcnow().date()
            freeze_date = DateObj.fromisoformat(ri.freeze_date) if ri.freeze_date else None
            income = RecurringIncome(
                account_id=account.id,
                name=ri.name,
                amount=ri.amount,
                interval_value=ri.interval_value,
                interval_unit=ri.interval_unit,
                start_date=start_date,
                frozen=ri.frozen,
                freeze_date=freeze_date,
            )
            session.add(income)
            session.flush()
            income_name_map[ri.name.lower()] = income.id

        # --- Insert Skips ---
        for s in skips_list:
            def_id: int | None = None
            if s.definition_type == "cost":
                def_id = cost_name_map.get(s.definition_name.lower())
            elif s.definition_type == "income":
                def_id = income_name_map.get(s.definition_name.lower())
            if def_id is None:
                # Skip references a definition not in the backup — skip it
                continue
            occurrence_date = DateObj.fromisoformat(s.occurrence_date) if s.occurrence_date else None
            if occurrence_date is None:
                continue
            skip_model = RecurringSkip(
                recurring_cost_id=def_id if s.definition_type == "cost" else None,
                recurring_income_id=def_id if s.definition_type == "income" else None,
                occurrence_date=occurrence_date,
            )
            session.add(skip_model)

        # --- Insert Transactions ---
        for tx in transactions:
            # Resolve wallet id by name
            wallet_id: int | None = None
            source_wallet_id: int | None = None
            destination_wallet_id: int | None = None
            if tx.wallet:
                wallet_id = wallet_name_map.get(tx.wallet.lower())
            if tx.source_wallet:
                source_wallet_id = wallet_name_map.get(tx.source_wallet.lower())
            if tx.destination_wallet:
                destination_wallet_id = wallet_name_map.get(tx.destination_wallet.lower())

            # Resolve category id by (name, type)
            category_id: int | None = None
            if tx.category:
                # Try expense type first, then income
                cat_key = (tx.category.lower(), "expense")
                category_id = category_name_type_map.get(cat_key)
                if category_id is None:
                    cat_key = (tx.category.lower(), "income")
                    category_id = category_name_type_map.get(cat_key)

            # Resolve recurring link by name
            recurring_cost_id: int | None = None
            if tx.recurring_cost:
                recurring_cost_id = cost_name_map.get(tx.recurring_cost.lower())

            recurring_income_id: int | None = None
            if tx.recurring_income:
                recurring_income_id = income_name_map.get(tx.recurring_income.lower())

            occurrence_date_obj: DateObj | None = None
            if tx.occurrence_date:
                occurrence_date_obj = DateObj.fromisoformat(tx.occurrence_date)

            if tx.type == "transfer":
                t = Transaction(
                    account_id=account.id,
                    type=tx.type,
                    amount=tx.amount,
                    date=from_rome_day(tx.date),
                    source_wallet_id=source_wallet_id,
                    destination_wallet_id=destination_wallet_id,
                    category_id=None,
                    recurring_cost_id=recurring_cost_id,
                    recurring_income_id=recurring_income_id,
                    occurrence_date=occurrence_date_obj,
                    description=tx.description,
                    latitude=tx.latitude,
                    longitude=tx.longitude,
                )
            else:
                t = Transaction(
                    account_id=account.id,
                    type=tx.type,
                    amount=tx.amount,
                    date=from_rome_day(tx.date),
                    wallet_id=wallet_id,
                    category_id=category_id,
                    recurring_cost_id=recurring_cost_id,
                    recurring_income_id=recurring_income_id,
                    occurrence_date=occurrence_date_obj,
                    description=tx.description,
                    latitude=tx.latitude,
                    longitude=tx.longitude,
                )
            session.add(t)

        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(
            status_code=422,
            detail="Restore failed: the backup data could not be applied",
        )

    result: dict[str, object] = {"status": "ok"}
    if warning is not None:
        result["warning"] = warning
    return result