"""Draft Transactions (ADR-0036, issues #122/#123): a stored, Account-scoped
resource that counts for nothing. The HTTP seam covers the resource itself
(create, list, patch, delete, 403 for foreign and missing — ADR-0003) and
the invariants: a Draft enters no Balance, Net Worth, Budget or dashboard
figure, no Export or Backup, Restore neither writes nor removes one, the
import Duplicate check ignores it, and a referenced Wallet, Category or
Recurring definition that disappears leaves the Draft with that field null.
"""

from decimal import Decimal
from io import BytesIO
from itertools import count

from httpx import AsyncClient
from openpyxl import load_workbook

from conftest import SEED_EMAIL, SEED_PASSWORD, delete_account, insert_foreign_account

# The database resets once per session, so entity names (unique per Account)
# must not repeat across tests; a per-process counter keeps them distinct.
_UNIQUE = count(1)


def _name(prefix: str) -> str:
    return f"Draft {prefix} {next(_UNIQUE)}"


async def _login_as(client: AsyncClient, email: str, password: str) -> str:
    response = await client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


async def _login(client: AsyncClient) -> str:
    return await _login_as(client, SEED_EMAIL, SEED_PASSWORD)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_wallet(
    client: AsyncClient, token: str, name: str, type: str = "checking", opening_balance: str = "0.00"
) -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": opening_balance},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(client: AsyncClient, token: str, name: str, type: str = "expense") -> int:
    response = await client.post(
        "/categories",
        json={"name": name, "type": type, "color": "#ef4444"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_recurring_cost(client: AsyncClient, token: str, name: str) -> int:
    response = await client.post(
        "/recurring-costs",
        json={"name": name, "amount": "9.99", "interval_value": 1, "interval_unit": "months"},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_draft(client: AsyncClient, token: str, **fields: object) -> dict:
    response = await client.post("/draft-transactions", json=fields, headers=_auth(token))
    assert response.status_code == 201, response.text
    return response.json()


async def _list_drafts(client: AsyncClient, token: str) -> list[dict]:
    response = await client.get("/draft-transactions", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _draft(client: AsyncClient, token: str, draft_id: int) -> dict:
    drafts = {d["id"]: d for d in await _list_drafts(client, token)}
    return drafts[draft_id]


async def _wallet_balance(client: AsyncClient, token: str, wallet_id: int) -> Decimal:
    response = await client.get("/wallets", headers=_auth(token))
    assert response.status_code == 200
    return Decimal(next(w["balance"] for w in response.json() if w["id"] == wallet_id))


async def _summary(client: AsyncClient, token: str) -> dict:
    response = await client.get("/dashboard/summary", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _budget(client: AsyncClient, token: str) -> dict:
    response = await client.get("/dashboard/budget", headers=_auth(token))
    assert response.status_code == 200, response.text
    return response.json()


def _sheet_cells(content: bytes) -> dict[str, list[list[str]]]:
    workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
    try:
        return {
            name: [
                ["" if cell is None else str(cell) for cell in row]
                for row in workbook[name].iter_rows(values_only=True)
            ]
            for name in workbook.sheetnames
        }
    finally:
        workbook.close()


# --- The resource ---------------------------------------------------------


async def test_draft_transactions_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/draft-transactions")).status_code == 401
    assert (await client.post("/draft-transactions", json={})).status_code == 401
    assert (await client.patch("/draft-transactions/1", json={})).status_code == 401
    assert (await client.delete("/draft-transactions/1")).status_code == 401


async def test_create_a_draft_with_any_subset_of_fields(client: AsyncClient) -> None:
    """A Draft carries the fields of a Transaction, any of which may be
    missing (ADR-0036): an empty body is a valid Draft, and a partial one
    keeps exactly what it was given, everything else null."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Subset Wallet"))

    empty = await _create_draft(client, token)
    assert empty["type"] is None
    assert empty["amount"] is None
    assert empty["date"] is None
    assert empty["wallet_id"] is None
    assert empty["description"] is None

    partial = await _create_draft(
        client,
        token,
        type="expense",
        amount="30",
        date="2026-11-18",
        wallet_id=wallet,
        description="Esselunga",
    )
    assert partial["type"] == "expense"
    assert partial["amount"] == "30.00"
    assert partial["date"] == "2026-11-18"
    assert partial["wallet_id"] == wallet
    assert partial["category_id"] is None
    assert partial["source_wallet_id"] is None
    assert partial["destination_wallet_id"] is None
    assert partial["recurring_cost_id"] is None
    assert partial["recurring_income_id"] is None
    assert partial["description"] == "Esselunga"
    assert "created_at" in partial

    ids = {d["id"] for d in await _list_drafts(client, token)}
    assert {empty["id"], partial["id"]} <= ids


async def test_create_rejects_malformed_fields(client: AsyncClient) -> None:
    """What is present must be well-formed: the wire shape is the
    Transaction's (a Rome day, a positive amount, a known type)."""
    token = await _login(client)
    headers = _auth(token)
    assert (
        await client.post("/draft-transactions", json={"type": "opening_balance"}, headers=headers)
    ).status_code == 422
    assert (
        await client.post("/draft-transactions", json={"amount": "-1"}, headers=headers)
    ).status_code == 422
    assert (
        await client.post("/draft-transactions", json={"date": "18/11/2026"}, headers=headers)
    ).status_code == 422
    assert (
        await client.post("/draft-transactions", json={"latitude": "1"}, headers=headers)
    ).status_code == 422


async def test_patch_changes_fields_and_clears_them(client: AsyncClient) -> None:
    """PATCH applies every field present — a value sets it, null clears it —
    and leaves absent fields untouched, like the Transaction edit."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Patch Wallet"))
    category = await _create_category(client, token, _name("Patch Cat"))
    draft = await _create_draft(
        client, token, type="expense", amount="30", wallet_id=wallet, description="first"
    )

    response = await client.patch(
        f"/draft-transactions/{draft['id']}",
        json={"amount": "35", "category_id": category, "description": None},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["amount"] == "35.00"
    assert body["category_id"] == category
    assert body["description"] is None
    assert body["type"] == "expense"
    assert body["wallet_id"] == wallet
    assert (await _draft(client, token, draft["id"]))["amount"] == "35.00"


async def test_delete_discards_the_draft(client: AsyncClient) -> None:
    """Discard removes the Draft and nothing else; it is gone from the list
    and a second delete answers 403 (missing is foreign, ADR-0003)."""
    token = await _login(client)
    draft = await _create_draft(client, token, amount="5")

    response = await client.delete(f"/draft-transactions/{draft['id']}", headers=_auth(token))

    assert response.status_code == 204
    assert draft["id"] not in {d["id"] for d in await _list_drafts(client, token)}
    assert (
        await client.delete(f"/draft-transactions/{draft['id']}", headers=_auth(token))
    ).status_code == 403


async def test_foreign_and_missing_drafts_answer_403(
    client: AsyncClient, database_url: str
) -> None:
    """ADR-0003: another Account's Draft and a Draft that does not exist are
    indistinguishable — both 403 — and the list shows only one's own."""
    token = await _login(client)
    stranger_id = insert_foreign_account(database_url, "draft-stranger@budjetame.dev")
    try:
        stranger = await _login_as(client, "draft-stranger@budjetame.dev", "whatever")
        foreign = await _create_draft(client, stranger, amount="7")

        assert foreign["id"] not in {d["id"] for d in await _list_drafts(client, token)}
        assert (
            await client.patch(
                f"/draft-transactions/{foreign['id']}", json={"amount": "8"}, headers=_auth(token)
            )
        ).status_code == 403
        assert (
            await client.delete(f"/draft-transactions/{foreign['id']}", headers=_auth(token))
        ).status_code == 403
        assert (
            await client.patch("/draft-transactions/999999", json={"amount": "8"}, headers=_auth(token))
        ).status_code == 403
        assert (
            await client.delete("/draft-transactions/999999", headers=_auth(token))
        ).status_code == 403
        # The foreign Draft survived the attempts.
        assert foreign["id"] in {d["id"] for d in await _list_drafts(client, stranger)}
    finally:
        delete_account(database_url, stranger_id)


async def test_draft_references_must_belong_to_the_account(
    client: AsyncClient, database_url: str
) -> None:
    """A Draft may only point at the Account's own Wallets, Categories and
    Recurring definitions: a foreign or missing reference is 403 on create
    and on patch (ADR-0003)."""
    token = await _login(client)
    stranger_id = insert_foreign_account(database_url, "draft-ref-stranger@budjetame.dev")
    try:
        stranger = await _login_as(client, "draft-ref-stranger@budjetame.dev", "whatever")
        foreign_wallet = await _create_wallet(client, stranger, _name("Foreign Wallet"))
        draft = await _create_draft(client, token, amount="1")

        for field in ("wallet_id", "source_wallet_id", "destination_wallet_id"):
            assert (
                await client.post(
                    "/draft-transactions", json={field: foreign_wallet}, headers=_auth(token)
                )
            ).status_code == 403
            assert (
                await client.patch(
                    f"/draft-transactions/{draft['id']}",
                    json={field: foreign_wallet},
                    headers=_auth(token),
                )
            ).status_code == 403
        assert (
            await client.post(
                "/draft-transactions", json={"category_id": 999999}, headers=_auth(token)
            )
        ).status_code == 403
        assert (
            await client.post(
                "/draft-transactions", json={"recurring_cost_id": 999999}, headers=_auth(token)
            )
        ).status_code == 403
        assert (
            await client.post(
                "/draft-transactions", json={"recurring_income_id": 999999}, headers=_auth(token)
            )
        ).status_code == 403
    finally:
        delete_account(database_url, stranger_id)


# --- A Draft counts for nothing (ADR-0036) ---------------------------------


def _csv_bytes(*rows: str) -> bytes:
    """A CSV against the import template: header row plus the given rows."""
    header = (
        "date,type,amount,wallet,source wallet,destination wallet,"
        "category,description,location"
    )
    return ("\n".join([header, *rows]) + "\n").encode("utf-8")


async def test_a_draft_changes_no_balance_net_worth_budget_or_dashboard_figure(
    client: AsyncClient,
) -> None:
    """A complete Draft — amount, Wallet, Category, today's date — leaves
    the Wallet's Balance, Net Worth, the month's income and expenses, and
    every Budget figure exactly as they were: it lives in its own table and
    no derived read sums it (ADR-0036)."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Nothing Wallet"), "cash", "100.00")
    category = await _create_category(client, token, _name("Nothing Cat"))
    summary_before = await _summary(client, token)
    budget_before = await _budget(client, token)

    from app.dates import ROME
    from datetime import datetime

    today = datetime.now(ROME).strftime("%Y-%m-%d")
    for type_ in ("expense", "income"):
        await _create_draft(
            client,
            token,
            type=type_,
            amount="40.00",
            date=today,
            wallet_id=wallet,
            category_id=category if type_ == "expense" else None,
            description="counts for nothing",
        )

    assert await _wallet_balance(client, token, wallet) == Decimal("100.00")
    assert await _summary(client, token) == summary_before
    assert await _budget(client, token) == budget_before


async def test_export_and_backup_carry_no_draft(client: AsyncClient) -> None:
    """The ledger Export and the Backup workbook contain no Draft row: every
    sheet reads the same before and after a Draft is written."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Export Wallet"))
    export_before = _sheet_cells(
        (await client.get("/transactions/export", headers=_auth(token))).content
    )
    backup_before = _sheet_cells(
        (await client.get("/backup/export", headers=_auth(token))).content
    )

    await _create_draft(
        client,
        token,
        type="expense",
        amount="12.50",
        date="2026-11-18",
        wallet_id=wallet,
        description="never exported",
    )

    export_after = _sheet_cells(
        (await client.get("/transactions/export", headers=_auth(token))).content
    )
    backup_after = _sheet_cells(
        (await client.get("/backup/export", headers=_auth(token))).content
    )
    assert export_after == export_before
    for sheet, rows in backup_before.items():
        if sheet == "Metadata":
            continue  # exported_at differs
        assert backup_after[sheet] == rows, f"sheet {sheet!r} changed"
    assert "never exported" not in str(backup_after)


async def test_restore_neither_writes_nor_removes_drafts(client: AsyncClient) -> None:
    """A Restore replaces the Account's data with a Backup's — and a Backup
    carries no Draft, so the Drafts are not part of what is replaced: the
    ones written before and after the Backup both survive, and none is
    written by the Restore (ADR-0036)."""
    token = await _login(client)
    before_backup = await _create_draft(client, token, amount="1.00", description="before")
    backup = (await client.get("/backup/export", headers=_auth(token))).content
    after_backup = await _create_draft(client, token, amount="2.00", description="after")
    count_before_restore = len(await _list_drafts(client, token))

    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", backup, "application/octet-stream")},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    drafts = await _list_drafts(client, token)
    assert len(drafts) == count_before_restore
    ids = {d["id"] for d in drafts}
    assert before_backup["id"] in ids
    assert after_backup["id"] in ids


async def test_import_duplicate_check_ignores_drafts(client: AsyncClient) -> None:
    """An import row matching a Draft on every key dimension is Ready, not
    a Duplicate: the Duplicate check reads Transactions only (ADR-0036)."""
    token = await _login(client)
    wallet_name = _name("Dup Wallet")
    wallet = await _create_wallet(client, token, wallet_name)
    category_name = _name("Dup Cat")
    category = await _create_category(client, token, category_name)
    await _create_draft(
        client,
        token,
        type="expense",
        amount="12.50",
        date="2026-08-01",
        wallet_id=wallet,
        category_id=category,
        description="Lunch",
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(f"2026-08-01,expense,12.50,{wallet_name},,,{category_name},Lunch,"),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok"]
    assert body["duplicate_count"] == 0


# --- A vanished reference leaves the field null -----------------------------


async def test_deleting_a_wallet_nulls_the_drafts_reference(client: AsyncClient) -> None:
    """A Draft never counts as a Wallet's history: the frozen Wallet it
    names can still be deleted (ADR-0034), and the Draft survives with the
    Wallet missing — every Wallet slot, not just `wallet_id`."""
    token = await _login(client)
    doomed = await _create_wallet(client, token, _name("Doomed Wallet"))
    other = await _create_wallet(client, token, _name("Other Wallet"))
    draft = await _create_draft(
        client, token, type="transfer", amount="5.00", source_wallet_id=doomed, destination_wallet_id=other
    )
    single = await _create_draft(client, token, type="expense", amount="5.00", wallet_id=doomed)

    assert (await client.post(f"/wallets/{doomed}/freeze", headers=_auth(token))).status_code == 200
    response = await client.delete(f"/wallets/{doomed}", headers=_auth(token))

    assert response.status_code == 200, response.text
    transfer = await _draft(client, token, draft["id"])
    assert transfer["source_wallet_id"] is None
    assert transfer["destination_wallet_id"] == other
    assert transfer["amount"] == "5.00"
    assert (await _draft(client, token, single["id"]))["wallet_id"] is None


async def test_merging_a_category_nulls_the_drafts_reference(client: AsyncClient) -> None:
    """A Category merged away (ADR-0007) leaves the Draft that named it in
    place with the Category missing; the surviving Category is untouched."""
    token = await _login(client)
    source = await _create_category(client, token, _name("Merge Source"))
    target = await _create_category(client, token, _name("Merge Target"))
    draft = await _create_draft(client, token, type="expense", amount="3.00", category_id=source)

    response = await client.post(
        f"/categories/{source}/merge", json={"target_id": target}, headers=_auth(token)
    )

    assert response.status_code == 200, response.text
    assert (await _draft(client, token, draft["id"]))["category_id"] is None


async def test_deleting_a_recurring_definition_nulls_the_drafts_link(
    client: AsyncClient,
) -> None:
    """A frozen Recurring Cost with no linked Transaction can be deleted
    (ADR-0034) — a Draft's link is not a Transaction's — and the Draft
    survives with the link missing."""
    token = await _login(client)
    cost = await _create_recurring_cost(client, token, _name("Doomed Cost"))
    draft = await _create_draft(client, token, type="expense", amount="9.99", recurring_cost_id=cost)

    assert (
        await client.post(f"/recurring-costs/{cost}/freeze", headers=_auth(token))
    ).status_code == 200
    response = await client.delete(f"/recurring-costs/{cost}", headers=_auth(token))

    assert response.status_code == 200, response.text
    assert (await _draft(client, token, draft["id"]))["recurring_cost_id"] is None


async def test_restore_nulls_the_drafts_references(client: AsyncClient) -> None:
    """A Restore rebuilds Wallets and Categories by name with new ids: the
    Draft stays, its references now missing, and the create rules judge it
    at Approve time (ADR-0036)."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Restore Wallet"))
    category = await _create_category(client, token, _name("Restore Cat"))
    draft = await _create_draft(
        client, token, type="expense", amount="8.00", wallet_id=wallet, category_id=category
    )
    backup = (await client.get("/backup/export", headers=_auth(token))).content

    response = await client.post(
        "/backup/restore",
        files={"file": ("backup.xlsx", backup, "application/octet-stream")},
        headers=_auth(token),
    )

    assert response.status_code == 200, response.text
    restored = await _draft(client, token, draft["id"])
    assert restored["wallet_id"] is None
    assert restored["category_id"] is None
    assert restored["amount"] == "8.00"
    assert restored["type"] == "expense"


# --- Approve (ADR-0036, issue #125) ---------------------------------------


async def _transactions_on(client: AsyncClient, token: str, wallet_id: int) -> list[dict]:
    """The Wallet's Transactions through the ledger filter — the ledger is
    paginated, so a filter is how a test reads a row back."""
    response = await client.get(
        "/transactions", params={"wallet_id": wallet_id}, headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()["items"]


async def _approve(client: AsyncClient, token: str, draft_id: int, body: dict | None = None):
    return await client.post(
        f"/draft-transactions/{draft_id}/approve", json=body, headers=_auth(token)
    )


async def test_approve_creates_the_transaction_and_removes_the_draft_in_one_request(
    client: AsyncClient,
) -> None:
    """One tap (ADR-0036): the Transaction exists, the Draft is gone, and
    the Wallet's Balance moves only now — the create rules the form runs
    judged the Draft, so the response is the Transaction the ledger shows,
    carrying the write warning like the create endpoint's."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Approve Wallet"), "checking", "100.00")
    category = await _create_category(client, token, _name("Approve Cat"))
    draft = await _create_draft(
        client,
        token,
        type="expense",
        amount="30.00",
        date="2026-11-18",
        wallet_id=wallet,
        category_id=category,
        description="Esselunga",
    )
    assert await _wallet_balance(client, token, wallet) == Decimal("100.00")

    response = await _approve(client, token, draft["id"])

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["type"] == "expense"
    assert body["amount"] == "30.00"
    assert body["date"] == "2026-11-18"
    assert body["wallet_id"] == wallet
    assert body["category_id"] == category
    assert body["description"] == "Esselunga"
    assert body["warning"] is False
    rows = await _transactions_on(client, token, wallet)
    assert [r["id"] for r in rows if r["type"] == "expense"] == [body["id"]]
    assert await _wallet_balance(client, token, wallet) == Decimal("70.00")
    assert draft["id"] not in {d["id"] for d in await _list_drafts(client, token)}


async def _assert_rejected(
    client: AsyncClient, token: str, draft: dict, detail_fragment: str
) -> None:
    """Approve answers 422 with the rule message as `detail`, writes nothing
    and leaves the Draft exactly as it was."""
    response = await _approve(client, token, draft["id"])
    assert response.status_code == 422, response.text
    assert detail_fragment.lower() in response.json()["detail"].lower()
    assert await _draft(client, token, draft["id"]) == draft


async def test_approve_rejects_a_draft_the_create_rules_reject_and_leaves_it(
    client: AsyncClient,
) -> None:
    """The rules run at Approve time, not at Draft time (ADR-0036): a
    missing Wallet, a Wallet frozen in between, a Category of the wrong
    type and a link on a frozen Recurring Cost each answer 422 with the
    create endpoint's own message — never a 500 — and the Draft stays,
    for the form to open pre-filled."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Reject Wallet"), "checking", "100.00")
    income_category = await _create_category(client, token, _name("Reject Income Cat"), "income")
    cost = await _create_recurring_cost(client, token, _name("Reject Cost"))
    today = "2026-11-18"

    no_wallet = await _create_draft(client, token, type="expense", amount="5.00", date=today)
    await _assert_rejected(client, token, no_wallet, "wallet_id is required")

    wrong_category = await _create_draft(
        client,
        token,
        type="expense",
        amount="5.00",
        date=today,
        wallet_id=wallet,
        category_id=income_category,
    )
    await _assert_rejected(client, token, wrong_category, "category")

    frozen_link = await _create_draft(
        client, token, type="expense", amount="9.99", date=today, wallet_id=wallet, recurring_cost_id=cost
    )
    assert (
        await client.post(f"/recurring-costs/{cost}/freeze", headers=_auth(token))
    ).status_code == 200
    await _assert_rejected(client, token, frozen_link, "frozen recurring cost")

    # Only a Wallet at zero Balance can freeze (ADR-0002).
    freezable = await _create_wallet(client, token, _name("Reject Frozen Wallet"))
    frozen_wallet = await _create_draft(
        client, token, type="expense", amount="5.00", date=today, wallet_id=freezable
    )
    assert (await client.post(f"/wallets/{freezable}/freeze", headers=_auth(token))).status_code == 200
    await _assert_rejected(client, token, frozen_wallet, "frozen")

    assert await _wallet_balance(client, token, wallet) == Decimal("100.00")


async def test_approve_without_a_required_field_is_a_rule_error_not_a_500(
    client: AsyncClient,
) -> None:
    """A Draft the Assistant only half caught — no type, no amount or no
    date — is a 422 naming the field, like the form's Field Error on it,
    so the client opens the form instead of showing a failure."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Half Wallet"))
    complete = {"type": "expense", "amount": "5.00", "date": "2026-11-18", "wallet_id": wallet}

    for field, fragment in (("type", "type"), ("amount", "amount"), ("date", "date")):
        draft = await _create_draft(client, token, **{k: v for k, v in complete.items() if k != field})
        await _assert_rejected(client, token, draft, fragment)


async def test_approve_with_an_override_creates_from_the_override(
    client: AsyncClient,
) -> None:
    """The form's Save after a rejected one-tap (ADR-0036): the edited
    payload — a full `TransactionCreate` — is what gets created, the
    Draft's own fields are ignored, and the Draft is removed."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Override Wallet"), "checking", "50.00")
    category = await _create_category(client, token, _name("Override Cat"))
    draft = await _create_draft(client, token, type="expense", amount="99.00", description="bar")

    response = await _approve(
        client,
        token,
        draft["id"],
        {
            "type": "expense",
            "amount": "12.50",
            "date": "2026-11-17",
            "wallet_id": wallet,
            "category_id": category,
            "description": "the bar, edited",
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["amount"] == "12.50"
    assert body["date"] == "2026-11-17"
    assert body["description"] == "the bar, edited"
    assert await _wallet_balance(client, token, wallet) == Decimal("37.50")
    assert draft["id"] not in {d["id"] for d in await _list_drafts(client, token)}
    # An override that breaks a rule is rejected like the Draft itself,
    # and the Draft stays.
    other = await _create_draft(client, token, type="expense", amount="1.00")
    response = await _approve(
        client,
        token,
        other["id"],
        {
            "type": "income",
            "amount": "1.00",
            "date": "2026-11-17",
            "wallet_id": wallet,
            "category_id": category,
        },
    )
    assert response.status_code == 422, response.text
    assert "category" in response.json()["detail"].lower()
    assert await _draft(client, token, other["id"]) == other
    assert await _wallet_balance(client, token, wallet) == Decimal("37.50")


async def test_a_draft_is_never_approved_twice(client: AsyncClient) -> None:
    """The insert and the delete share one commit (ADR-0036): the second
    Approve finds no Draft — 403, indistinguishable from foreign
    (ADR-0003) — and exactly one Transaction exists."""
    token = await _login(client)
    wallet = await _create_wallet(client, token, _name("Twice Wallet"), "checking", "100.00")
    draft = await _create_draft(
        client, token, type="expense", amount="10.00", date="2026-11-18", wallet_id=wallet
    )

    first = await _approve(client, token, draft["id"])
    second = await _approve(client, token, draft["id"])

    assert first.status_code == 201, first.text
    assert second.status_code == 403, second.text
    rows = await _transactions_on(client, token, wallet)
    assert [r["id"] for r in rows if r["type"] == "expense"] == [first.json()["id"]]
    assert await _wallet_balance(client, token, wallet) == Decimal("90.00")


async def test_approve_of_a_foreign_or_missing_draft_answers_403(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    stranger_id = insert_foreign_account(database_url, "draft-approve-stranger@budjetame.dev")
    try:
        stranger = await _login_as(client, "draft-approve-stranger@budjetame.dev", "whatever")
        foreign_wallet = await _create_wallet(client, stranger, _name("Foreign Approve Wallet"))
        foreign = await _create_draft(
            client, stranger, type="expense", amount="7.00", date="2026-11-18", wallet_id=foreign_wallet
        )

        assert (await _approve(client, token, foreign["id"])).status_code == 403
        assert (await _approve(client, token, 999999)).status_code == 403
        # The foreign Draft survived the attempt, and its Account can still
        # approve it.
        assert foreign["id"] in {d["id"] for d in await _list_drafts(client, stranger)}
        assert (await _approve(client, stranger, foreign["id"])).status_code == 201
    finally:
        delete_account(database_url, stranger_id)


async def test_approve_carries_the_create_endpoints_write_warning(client: AsyncClient) -> None:
    """The one tap answers like the create endpoint (ADR-0036): a Cash
    Wallet pushed negative by the approved Expense flags `warning`."""
    token = await _login(client)
    cash = await _create_wallet(client, token, _name("Warn Cash"), "cash", "5.00")
    draft = await _create_draft(
        client, token, type="expense", amount="8.00", date="2026-11-18", wallet_id=cash
    )

    response = await _approve(client, token, draft["id"])

    assert response.status_code == 201, response.text
    assert response.json()["warning"] is True
    assert await _wallet_balance(client, token, cash) == Decimal("-3.00")


async def test_approve_requires_authentication(client: AsyncClient) -> None:
    assert (await client.post("/draft-transactions/1/approve")).status_code == 401
