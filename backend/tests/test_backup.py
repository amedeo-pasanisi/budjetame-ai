"""Backup export (issue #112): the multi-sheet backup workbook over the HTTP
seam, asserting cell-by-cell via openpyxl round-trip.

The pure builder is tested implicitly through the endpoint: the integration
test seeds an Account with every entity type and asserts the produced
workbook's cells against expected values. The builder's own seam is kept
internal — the endpoint is the only consumer.
"""

import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO
from itertools import count

from httpx import AsyncClient
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dates import to_rome_day
from app.db import create_db_engine
from app.models import (
    Account,
    RecurringCost,
    RecurringIncome,
    RecurringSkip,
    Wallet,
    WalletType,
)
from conftest import (
    SEED_EMAIL,
    SEED_PASSWORD,
    insert_foreign_account,
)

_UNIQUE = count(1)

TRANSACTIONS_HEADER = [
    "date", "type", "amount", "wallet", "source wallet", "destination wallet",
    "category", "description", "location", "recurring cost", "recurring income",
    "occurrence date", "id",
]
WALLETS_HEADER = ["name", "type", "frozen", "id"]
CATEGORIES_HEADER = ["name", "type", "icon", "color", "id"]
RECURRING_COSTS_HEADER = [
    "name", "amount", "interval value", "interval unit", "start date",
    "frozen", "freeze date", "id",
]
RECURRING_INCOMES_HEADER = [
    "name", "amount", "interval value", "interval unit", "start date",
    "frozen", "freeze date", "id",
]
SKIPS_HEADER = ["definition name", "definition type", "occurrence date", "id"]


def _name(prefix: str) -> str:
    return f"{prefix} {next(_UNIQUE)}"


def _cells(content: bytes) -> dict[str, list[list[str]]]:
    """All sheets as a dict-of-lists-of-string-lists. None cells become empty
    strings, numbers are string-formatted as the workbook stores them."""
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        sheets = {}
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            rows = [
                ["" if cell is None else str(cell) for cell in row]
                for row in sheet.iter_rows(values_only=True)
            ]
            sheets[sheet_name] = rows
        return sheets
    finally:
        workbook.close()


def _sheet_names(content: bytes) -> list[str]:
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        return workbook.sheetnames
    finally:
        workbook.close()


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_wallet(
    client: AsyncClient, token: str, name: str, opening_balance: str = "0.00",
    type: str = "checking",
) -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": opening_balance},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(
    client: AsyncClient, token: str, name: str, type: str,
) -> int:
    response = await client.post(
        "/categories",
        json={"name": name, "type": type, "color": "#ef4444"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_transaction(client: AsyncClient, token: str, **payload: object) -> None:
    response = await client.post(
        "/transactions", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201, response.text


async def _export_backup(client: AsyncClient, token: str) -> bytes:
    response = await client.get("/backup/export", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.content


# --- Integration tests --------------------------------------------------------


async def test_backup_export_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/backup/export")
    assert response.status_code == 401


async def test_backup_export_scopes(client: AsyncClient, database_url: str) -> None:
    """A foreign backup export always works — it returns the caller's own
    data. There is no scoping issue: we just check the endpoint exists and
    returns the seed Account's backup (which may be nearly empty)."""
    token = await _login(client)
    content = await _export_backup(client, token)
    sheets = _sheet_names(content)
    assert "Metadata" in sheets
    # The origin marker should contain the seed email
    metadata_rows = _cells(content)["Metadata"]
    assert any(SEED_EMAIL in str(row) for row in metadata_rows)


async def test_backup_export_has_all_sheets(client: AsyncClient) -> None:
    token = await _login(client)
    content = await _export_backup(client, token)
    names = _sheet_names(content)
    assert "Metadata" in names
    assert "Transactions" in names
    assert "Wallets" in names
    assert "Categories" in names
    assert "Recurring Costs" in names
    assert "Recurring Incomes" in names
    assert "Skips" in names


async def test_backup_export_headers(client: AsyncClient) -> None:
    token = await _login(client)
    content = await _export_backup(client, token)
    sheets = _cells(content)
    assert sheets["Transactions"][0] == TRANSACTIONS_HEADER
    assert sheets["Wallets"][0] == WALLETS_HEADER
    assert sheets["Categories"][0] == CATEGORIES_HEADER
    assert sheets["Recurring Costs"][0] == RECURRING_COSTS_HEADER
    assert sheets["Recurring Incomes"][0] == RECURRING_INCOMES_HEADER
    assert sheets["Skips"][0] == SKIPS_HEADER


async def test_backup_export_writes_opening_balance_transactions(
    client: AsyncClient,
) -> None:
    """The backup includes Opening Balance Transactions, unlike the ledger
    Export (ADR-0015)."""
    token = await _login(client)
    wallet_name = _name("Backup OB")
    wallet = await _create_wallet(client, token, wallet_name, "100.00")
    # An expense on the same wallet to also have a non-OB row
    await _create_transaction(
        client, token,
        type="expense", amount="10.00", date="2026-07-15",
        wallet_id=wallet,
    )

    content = await _export_backup(client, token)
    sheets = _cells(content)

    # The Opening Balance row should be present
    tx_rows = sheets["Transactions"][1:]
    types = [row[1] for row in tx_rows]  # type column
    assert "opening_balance" in types
    assert "expense" in types


async def test_backup_export_wallets_sheet(client: AsyncClient) -> None:
    token = await _login(client)
    name_a = _name("Backup Wallet A")
    name_b = _name("Backup Wallet B")
    wallet_a = await _create_wallet(client, token, name_a)
    wallet_b = await _create_wallet(client, token, name_b)
    # Create a Transfer to give B a balance, then freeze it
    await _create_transaction(
        client, token,
        type="transfer", amount="100.00", date="2026-08-01",
        source_wallet_id=wallet_a, destination_wallet_id=wallet_b,
    )
    await _create_transaction(
        client, token,
        type="transfer", amount="100.00", date="2026-08-02",
        source_wallet_id=wallet_b, destination_wallet_id=wallet_a,
    )
    response = await client.delete(f"/wallets/{wallet_b}", headers=_auth(token))
    assert response.status_code == 204

    content = await _export_backup(client, token)
    sheets = _cells(content)
    wallet_rows = sheets["Wallets"][1:]  # skip header

    # Find our wallet rows by name
    a_rows = [r for r in wallet_rows if r[0] == name_a]
    b_rows = [r for r in wallet_rows if r[0] == name_b]
    assert len(a_rows) == 1
    assert len(b_rows) == 1
    assert a_rows[0][1] == "checking"
    assert a_rows[0][2] == "False"  # frozen
    assert b_rows[0][1] == "checking"
    assert b_rows[0][2] == "True"  # frozen


async def test_backup_export_categories_sheet(client: AsyncClient) -> None:
    token = await _login(client)
    cat_name = _name("Backup Food")
    cat = await _create_category(client, token, cat_name, "expense")
    # Create an income category too
    income_cat_name = _name("Backup Salary")
    income_cat = await _create_category(client, token, income_cat_name, "income")

    content = await _export_backup(client, token)
    sheets = _cells(content)
    cat_rows = sheets["Categories"][1:]

    food_rows = [r for r in cat_rows if r[0] == cat_name]
    salary_rows = [r for r in cat_rows if r[0] == income_cat_name]
    assert len(food_rows) == 1
    assert len(salary_rows) == 1
    assert food_rows[0][1] == "expense"
    assert food_rows[0][2] == ""  # no icon
    assert food_rows[0][3] == "#ef4444"
    assert salary_rows[0][1] == "income"


async def test_backup_export_recurring_sheets(client: AsyncClient) -> None:
    token = await _login(client)
    cost_name = _name("Backup Rent")
    income_name = _name("Backup Paycheck")
    # Create cost
    response = await client.post(
        "/recurring-costs",
        json={
            "name": cost_name,
            "amount": "1200.00",
            "interval_value": 1,
            "interval_unit": "months",
            "start_date": "2026-01-01",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    cost_id = response.json()["id"]

    # Create income
    response = await client.post(
        "/recurring-incomes",
        json={
            "name": income_name,
            "amount": "3000.00",
            "interval_value": 2,
            "interval_unit": "weeks",
            "start_date": "2026-01-15",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    income_id = response.json()["id"]

    # Freeze the cost to test freeze handling
    response = await client.post(
        f"/recurring-costs/{cost_id}/freeze", headers=_auth(token)
    )
    assert response.status_code == 200, response.text

    content = await _export_backup(client, token)
    sheets = _cells(content)

    cost_rows = [r for r in sheets["Recurring Costs"][1:] if r[0] == cost_name]
    income_rows = [r for r in sheets["Recurring Incomes"][1:] if r[0] == income_name]
    assert len(cost_rows) == 1
    assert len(income_rows) == 1

    # Cost: name, amount, interval value, interval unit, start date, frozen, freeze date, id
    assert cost_rows[0][1] == "1200.00"
    assert cost_rows[0][2] == "1"
    assert cost_rows[0][3] == "months"
    assert cost_rows[0][4] == "2026-01-01"
    assert cost_rows[0][5] == "True"  # frozen
    assert cost_rows[0][6] != ""  # freeze date is set

    # Income: not frozen
    assert income_rows[0][1] == "3000.00"
    assert income_rows[0][2] == "2"
    assert income_rows[0][3] == "weeks"
    assert income_rows[0][4] == "2026-01-15"
    assert income_rows[0][5] == "False"  # not frozen
    assert income_rows[0][6] == ""  # no freeze date


async def test_backup_export_skips_sheet(client: AsyncClient) -> None:
    """A skip on a Recurring Cost appears in the Skips sheet with the
    definition name and type."""
    token = await _login(client)
    cost_name = _name("Backup Skip Cost")
    response = await client.post(
        "/recurring-costs",
        json={
            "name": cost_name,
            "amount": "50.00",
            "interval_value": 1,
            "interval_unit": "months",
            "start_date": "2026-03-01",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    cost_id = response.json()["id"]

    # Skip the first occurrence (2026-03-01)
    response = await client.put(
        f"/recurring-costs/{cost_id}/occurrences/2026-03-01",
        json={"skipped": True},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text

    content = await _export_backup(client, token)
    sheets = _cells(content)
    skip_rows = sheets["Skips"][1:]

    # Find our skip by definition name
    cost_skips = [r for r in skip_rows if r[0] == cost_name]
    assert len(cost_skips) == 1
    assert cost_skips[0][1] == "cost"  # definition type
    assert cost_skips[0][2] == "2026-03-01"  # occurrence date


async def test_backup_export_transactions_sheet(client: AsyncClient) -> None:
    """The Transactions sheet includes all Transaction types with resolved
    names (wallet, category names instead of ids) and includes the optional
    Recurring link names and the database id."""
    token = await _login(client)
    wallet_name = _name("Backup Tx W")
    wallet = await _create_wallet(client, token, wallet_name, "100.00")
    cat_name = _name("Backup Tx Cat")
    cat = await _create_category(client, token, cat_name, "expense")

    await _create_transaction(
        client, token,
        type="expense", amount="15.00", date="2026-09-15",
        wallet_id=wallet, category_id=cat, description="groceries",
    )

    content = await _export_backup(client, token)
    sheets = _cells(content)
    tx_rows = sheets["Transactions"][1:]

    expense_rows = [r for r in tx_rows if r[1] == "expense" and r[3] == wallet_name]
    assert len(expense_rows) >= 1
    expense = expense_rows[0]
    assert expense[0] == "2026-09-15"  # date
    assert expense[2] == "15.00"  # amount
    assert expense[3] == wallet_name  # wallet name
    assert expense[6] == cat_name  # category name
    assert expense[7] == "groceries"  # description


async def test_backup_export_includes_transfer_with_recurring_names(
    client: AsyncClient,
) -> None:
    """A Transfer linked to a Recurring Cost carries the cost name in the
    recurring columns."""
    token = await _login(client)
    wallet_name = _name("Backup Transfer W")
    contact_name = _name("Backup Contact")
    wallet = await _create_wallet(client, token, wallet_name)
    contact = await _create_wallet(
        client, token, contact_name, type="contact",
    )
    cost_name = _name("Backup Transfer Cost")
    response = await client.post(
        "/recurring-costs",
        json={
            "name": cost_name,
            "amount": "100.00",
            "interval_value": 1,
            "interval_unit": "months",
            "start_date": "2026-04-01",
        },
        headers=_auth(token),
    )
    assert response.status_code == 201

    await _create_transaction(
        client, token,
        type="transfer", amount="100.00", date="2026-04-01",
        source_wallet_id=wallet, destination_wallet_id=contact,
        recurring_cost_id=response.json()["id"],
        description="rent to contact",
    )

    content = await _export_backup(client, token)
    sheets = _cells(content)
    tx_rows = sheets["Transactions"][1:]

    transfer_rows = [r for r in tx_rows if r[1] == "transfer" and r[7] == "rent to contact"]
    assert len(transfer_rows) == 1
    transfer = transfer_rows[0]
    # source and destination wallets
    assert transfer[4] == wallet_name
    assert transfer[5] == contact_name
    # recurring cost name (column 9)
    assert transfer[9] == cost_name
    # no recurring income
    assert transfer[10] == ""


async def test_backup_export_has_attachment_headers(client: AsyncClient) -> None:
    token = await _login(client)
    response = await client.get("/backup/export", headers=_auth(token))
    assert response.status_code == 200
    assert (
        response.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    disposition = response.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="')
    assert re.search(r'budjetame-backup-\d{4}-\d{2}-\d{2}\.xlsx"$', disposition)


# --- Restore (issue #115) ----------------------------------------------------


async def test_restore_requires_auth(client: AsyncClient) -> None:
    """POST /backup/restore returns 401 without authentication."""
    response = await client.post("/backup/restore")
    assert response.status_code == 401


async def test_restore_malformed_file_422(client: AsyncClient) -> None:
    """A malformed or invalid file fails closed — nothing changes."""
    token = await _login(client)
    response = await client.post(
        "/backup/restore",
        files={"file": ("junk.xlsx", b"not an xlsx file", "application/octet-stream")},
        headers=_auth(token),
    )
    assert response.status_code == 422
    assert "detail" in response.json()


async def test_restore_round_trip(client: AsyncClient) -> None:
    """Export → restore → export lands on exactly the exported state."""
    token = await _login(client)

    # Create some data
    wallet_name = _name("RT Wallet")
    wallet = await _create_wallet(client, token, wallet_name, "250.00")
    cat_name = _name("RT Category")
    cat = await _create_category(client, token, cat_name, "expense")

    await _create_transaction(
        client, token,
        type="expense", amount="42.50", date="2026-06-15",
        wallet_id=wallet, category_id=cat, description="test restore",
    )

    # Export the current state
    content1 = await _export_backup(client, token)

    # Restore from it
    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", content1, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    # Export again
    content2 = await _export_backup(client, token)

    # The two workbooks should have the same data (same sheet structure,
    # same rows minus the exported_at timestamp in Metadata)
    cells1 = _cells(content1)
    cells2 = _cells(content2)

    # Compare every sheet except Metadata (exported_at differs)
    # Exclude the last column (database id) from comparison:
    # ids are auto-generated after restore and will differ.
    for sheet_name in ["Transactions", "Wallets", "Categories",
                        "Recurring Costs", "Recurring Incomes", "Skips"]:
        assert [row[:-1] for row in cells1[sheet_name]] == [row[:-1] for row in cells2[sheet_name]], (
            f"Sheet {sheet_name!r} differs after restore round-trip"
        )

    # Metadata: origin should match, exported_at differs
    assert cells1["Metadata"][1] == cells2["Metadata"][1]  # same origin
    assert cells1["Metadata"][2] != cells2["Metadata"][2]  # different timestamps
async def test_restore_origin_mismatch_warns(client: AsyncClient) -> None:
    """A backup whose origin doesn't match the signed-in Account warns but
    can still proceed."""
    token = await _login(client)
    content = await _export_backup(client, token)

    # Modify the origin in the Metadata sheet to simulate a mismatch
    from io import BytesIO
    from openpyxl import load_workbook
    workbook = load_workbook(BytesIO(content))
    meta = workbook["Metadata"]
    for row in meta.iter_rows():
        if row[0].value == "origin":
            row[1].value = "different@email.com"
            break
    fake_content = BytesIO()
    workbook.save(fake_content)
    fake_content = fake_content.getvalue()

    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", fake_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=_auth(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "warning" in body
    assert "different@email.com" in body["warning"]
    assert SEED_EMAIL in body["warning"]


async def test_restore_leaves_account_unchanged(client: AsyncClient) -> None:
    """Restore leaves Account email, credentials, and Locale untouched."""
    token = await _login(client)
    content = await _export_backup(client, token)

    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=_auth(token),
    )
    assert response.status_code == 200

    # Account still exists (we can login with the same password)
    response = await client.post(
        "/auth/login",
        json={"email": SEED_EMAIL, "password": SEED_PASSWORD},
    )
    assert response.status_code == 200
    new_token = response.json()["access_token"]

    # Check the account details
    response = await client.get(
        "/auth/me",
        headers=_auth(new_token),
    )
    assert response.status_code == 200
    me = response.json()
    assert me["email"] == SEED_EMAIL
    assert me["language"] == "en"  # default locale


async def test_restore_empty_backup_clears_data(client: AsyncClient) -> None:
    """Restoring an empty backup clears all data."""
    token = await _login(client)

    # Create some data first
    wallet = await _create_wallet(client, token, _name("Pre Wallet"), "100.00")
    cat = await _create_category(client, token, _name("Pre Cat"), "expense")
    await _create_transaction(
        client, token,
        type="expense", amount="10.00", date="2026-07-01",
        wallet_id=wallet, category_id=cat,
    )

    # Build an empty backup
    from app.services.backup import build_backup_workbook
    empty_content = build_backup_workbook(
        transactions=[],
        wallets=[],
        categories=[],
        recurring_costs=[],
        recurring_incomes=[],
        skips=[],
        origin=SEED_EMAIL,
    )

    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", empty_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=_auth(token),
    )
    assert response.status_code == 200

    # After restore, the account should have no data
    content_after = await _export_backup(client, token)
    cells_after = _cells(content_after)
    # Only headers, no data rows
    assert len(cells_after["Transactions"]) == 1  # just header
    assert len(cells_after["Wallets"]) == 1  # just header
    assert len(cells_after["Categories"]) == 1  # just header
    assert len(cells_after["Recurring Costs"]) == 1  # just header
    assert len(cells_after["Recurring Incomes"]) == 1  # just header
    assert len(cells_after["Skips"]) == 1  # just header
