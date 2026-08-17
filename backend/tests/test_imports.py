from decimal import Decimal

from httpx import AsyncClient

from conftest import SEED_EMAIL, SEED_PASSWORD


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_wallet(
    client: AsyncClient, token: str, name: str, type: str, opening_balance: str = "0.00"
) -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": opening_balance},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_category(
    client: AsyncClient, token: str, name: str, type: str
) -> int:
    response = await client.post(
        "/categories",
        json={"name": name, "type": type, "color": "#ef4444"},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


def _csv_bytes(*rows: str) -> bytes:
    """A CSV against the fixed template: header row plus the given data rows."""
    header = (
        "date,type,amount,wallet,source wallet,destination wallet,"
        "category,description,location"
    )
    return ("\n".join([header, *rows]) + "\n").encode("utf-8")


async def test_preview_parses_a_csv_into_ok_rows(client: AsyncClient) -> None:
    token = await _login(client)
    await _create_wallet(client, token, "Import Checking", "checking", "0.00")
    await _create_wallet(client, token, "Import Savings", "checking", "0.00")
    await _create_category(client, token, "Import Food", "expense")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Import Checking,,,Import Food,Lunch,",
                    "2026-08-02,transfer,50.00,,Import Checking,Import Savings,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok_count"] == 2
    assert body["error_count"] == 0
    assert body["duplicate_count"] == 0
    rows = body["rows"]
    assert rows[0]["row"] == 2
    assert rows[0]["status"] == "ok"
    assert rows[0]["type"] == "expense"
    assert rows[0]["date"] == "2026-08-01"
    assert rows[0]["amount"] == "12.50"
    assert rows[0]["wallet"] == "Import Checking"
    assert rows[0]["category"] == "Import Food"
    assert rows[0]["description"] == "Lunch"
    assert rows[0]["latitude"] is None
    assert rows[1]["row"] == 3
    assert rows[1]["status"] == "ok"
    assert rows[1]["type"] == "transfer"
    assert rows[1]["source_wallet"] == "Import Checking"
    assert rows[1]["destination_wallet"] == "Import Savings"
    assert rows[1]["wallet"] is None
    assert rows[1]["category"] is None


async def test_preview_flags_duplicates_against_the_database(client: AsyncClient) -> None:
    """A row already in the database is marked "duplicate", keyed per
    ADR-0006: expense/income by date + amount + type + wallet + category +
    description; transfer by date + amount + source + destination +
    description."""
    token = await _login(client)
    checking = await _create_wallet(client, token, "Dup Checking", "checking", "0.00")
    savings = await _create_wallet(client, token, "Dup Savings", "checking", "0.00")
    food = await _create_category(client, token, "Dup Food", "expense")
    # The database already holds: a categorized expense, an uncategorized
    # income, and a transfer between the two Wallets.
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "income", "amount": "7.00", "date": "2026-08-02",
            "wallet_id": checking,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "transfer", "amount": "50.00", "date": "2026-08-03",
            "source_wallet_id": checking, "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Dup Checking,,,Dup Food,,",
                    "2026-08-02,income,7.00,Dup Checking,,,,,",
                    "2026-08-03,transfer,50.00,,Dup Checking,Dup Savings,,,",
                    "2026-08-04,expense,3.00,Dup Checking,,,Dup Food,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    statuses = [row["status"] for row in body["rows"]]
    assert statuses == ["duplicate", "duplicate", "duplicate", "ok"]
    assert body["duplicate_count"] == 3
    assert body["ok_count"] == 1
    assert body["error_count"] == 0


async def test_preview_distinguishes_expense_and_income_in_the_dedup_key(
    client: AsyncClient,
) -> None:
    """The duplicate key includes the Type (documented deviation from
    US31/ID13): a €5 Expense and a €5 Income on the same date and Wallet are
    two different rows, not duplicates."""
    token = await _login(client)
    await _create_wallet(client, token, "Type Key Checking", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,5.00,Type Key Checking,,,,,",
                    "2026-08-01,income,5.00,Type Key Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "ok"]
    assert body["duplicate_count"] == 0


async def test_preview_distinguishes_expense_and_income_against_the_database(
    client: AsyncClient,
) -> None:
    """The Type dimension also applies against the database: a €5 Expense in
    the DB does not flag a €5 Income row (same date and Wallet) as a
    duplicate, while a matching Expense row still does."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Type Db Checking", "checking", "0.00"
    )
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "5.00", "date": "2026-08-01",
            "wallet_id": checking,
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,income,5.00,Type Db Checking,,,,,",
                    "2026-08-01,expense,5.00,Type Db Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate"]
    assert body["ok_count"] == 1
    assert body["duplicate_count"] == 1


async def test_preview_flags_same_type_duplicates_with_a_category(
    client: AsyncClient,
) -> None:
    """Two rows of the SAME type with the same date, amount, Wallet, and
    Category ARE duplicates — the Type dimension separates Expense from Income
    without weakening the existing key."""
    token = await _login(client)
    await _create_wallet(client, token, "Same Type Checking", "checking", "0.00")
    await _create_category(client, token, "Same Type Food", "expense")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,5.00,Same Type Checking,,,Same Type Food,,",
                    "2026-08-01,expense,5.00,Same Type Checking,,,Same Type Food,,",
                    "2026-08-01,income,5.00,Same Type Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    # The first same-type row is the one the user keeps; its repeat is a
    # duplicate, while the cross-type Income row with the same date, amount,
    # and Wallet stays ok.
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate", "ok"]
    assert body["duplicate_count"] == 1
    assert body["ok_count"] == 2


async def test_confirm_inserts_cross_type_rows_with_the_same_key(
    client: AsyncClient,
) -> None:
    """Confirming a €5 Expense and a €5 Income with the same date and Wallet
    writes both — they are distinct rows, not duplicates (the key includes the
    Type). Confirming the same rows again then duplicates in the database and
    the batch is rejected."""
    token = await _login(client)
    await _create_wallet(client, token, "Type Confirm Checking", "checking", "0.00")
    preview = await _preview(
        client,
        token,
        "2026-08-01,expense,5.00,Type Confirm Checking,,,,,",
        "2026-08-01,income,5.00,Type Confirm Checking,,,,,",
    )
    assert preview["ok_count"] == 2

    response = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row) for row in preview["rows"]]},
        headers=_auth(token),
    )

    assert response.status_code == 201
    created = response.json()
    assert len(created) == 2
    assert {t["type"] for t in created} == {"expense", "income"}

    repeated = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row) for row in preview["rows"]]},
        headers=_auth(token),
    )
    assert repeated.status_code == 422


async def test_preview_rows_differing_only_by_description_are_ok(
    client: AsyncClient,
) -> None:
    """Two rows identical on date, amount, type, Wallet, and Category but with
    different descriptions are both ready (ADR-0006): the duplicate key
    includes the description, so rows distinguishable only by their note are
    both importable."""
    token = await _login(client)
    await _create_wallet(client, token, "Desc File Checking", "checking", "0.00")
    await _create_category(client, token, "Desc File Food", "expense")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Desc File Checking,,,Desc File Food,Morning coffee,",
                    "2026-08-01,expense,12.50,Desc File Checking,,,Desc File Food,Evening coffee,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "ok"]
    assert body["duplicate_count"] == 0


async def test_preview_description_differentiates_rows_against_the_database(
    client: AsyncClient,
) -> None:
    """A database row and a file row identical on date, amount, type, Wallet,
    and Category but with different descriptions are distinct rows: the file
    row is ready, while a row matching the description too is a Duplicate."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Desc Db Checking", "checking", "0.00"
    )
    food = await _create_category(client, token, "Desc Db Food", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food, "description": "Lunch",
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Desc Db Checking,,,Desc Db Food,Dinner,",
                    "2026-08-01,expense,12.50,Desc Db Checking,,,Desc Db Food,Lunch,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate"]
    assert body["ok_count"] == 1
    assert body["duplicate_count"] == 1


async def test_preview_blank_description_matches_a_missing_one(
    client: AsyncClient,
) -> None:
    """A blank description in the file matches a database row with no
    description (still a Duplicate), and a database row whose description is
    the empty string matches a blank file row too."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Desc Blank Checking", "checking", "0.00"
    )
    # One database row with description stored as NULL, one stored as "".
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "income", "amount": "7.00", "date": "2026-08-02",
            "wallet_id": checking, "description": "",
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Desc Blank Checking,,,,,",
                    "2026-08-02,income,7.00,Desc Blank Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["duplicate", "duplicate"]
    assert body["duplicate_count"] == 2


async def test_preview_transfer_duplicate_key_includes_description(
    client: AsyncClient,
) -> None:
    """Transfer rows key on date, amount, source wallet, destination wallet,
    and description (ADR-0006): transfers differing only by description are
    both ready, while a repeat including the description is a Duplicate."""
    token = await _login(client)
    await _create_wallet(client, token, "Desc Tr Checking", "checking", "0.00")
    await _create_wallet(client, token, "Desc Tr Savings", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,transfer,50.00,,Desc Tr Checking,Desc Tr Savings,,Rent,",
                    "2026-08-01,transfer,50.00,,Desc Tr Checking,Desc Tr Savings,,Rent,",
                    "2026-08-01,transfer,50.00,,Desc Tr Checking,Desc Tr Savings,,Refund,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate", "ok"]
    assert body["ok_count"] == 2
    assert body["duplicate_count"] == 1


async def test_preview_transfer_description_against_the_database(
    client: AsyncClient,
) -> None:
    """The description dimension also applies against the database: a transfer
    matching an existing one except for the description is ready, a transfer
    matching it including the description is a Duplicate."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Desc Tr Db Checking", "checking", "0.00"
    )
    savings = await _create_wallet(
        client, token, "Desc Tr Db Savings", "checking", "0.00"
    )
    await client.post(
        "/transactions",
        json={
            "type": "transfer", "amount": "50.00", "date": "2026-08-01",
            "source_wallet_id": checking, "destination_wallet_id": savings,
            "description": "Rent",
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,transfer,50.00,,Desc Tr Db Checking,Desc Tr Db Savings,,Refund,",
                    "2026-08-01,transfer,50.00,,Desc Tr Db Checking,Desc Tr Db Savings,,Rent,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate"]
    assert body["ok_count"] == 1
    assert body["duplicate_count"] == 1


async def test_preview_flags_duplicate_key_differs_by_category(
    client: AsyncClient,
) -> None:
    """The expense/income key includes the Category: the same date + amount +
    wallet with a different Category is NOT a duplicate."""
    token = await _login(client)
    checking = await _create_wallet(client, token, "Dup Key Checking", "checking", "0.00")
    food = await _create_category(client, token, "Dup Key Food", "expense")
    travel = await _create_category(client, token, "Dup Key Travel", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food,
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Dup Key Checking,,,Dup Key Travel,,",
                    "2026-08-01,expense,12.50,Dup Key Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "ok"]


async def test_preview_rejects_unknown_wallets_before_confirmation(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    await _create_wallet(client, token, "Known Wallet", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,12.50,Phantom Wallet,,,,",
                    "2026-08-02,expense,10.00,Known Wallet,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    rows = body["rows"]
    assert rows[0]["status"] == "error"
    assert "Unknown wallet 'Phantom Wallet'" in rows[0]["error"]
    assert rows[1]["status"] == "ok"
    assert body["error_count"] == 1


async def test_preview_reports_parse_errors_per_row(client: AsyncClient) -> None:
    token = await _login(client)
    await _create_wallet(client, token, "Parse Checking", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-13-45,expense,12.50,Parse Checking,,,,",
                    "2026-08-01,expense,not-an-amount,Parse Checking,,,,",
                    "2026-08-01,savings,12.50,Parse Checking,,,,",
                    "2026-08-01,expense,12.50,Parse Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    rows = body["rows"]
    assert rows[0]["status"] == "error"
    assert "Invalid date '2026-13-45'" in rows[0]["error"]
    assert rows[1]["status"] == "error"
    assert "Invalid amount 'not-an-amount'" in rows[1]["error"]
    assert rows[2]["status"] == "error"
    assert "Type must be expense, income, or transfer" in rows[2]["error"]
    assert rows[3]["status"] == "ok"


async def test_preview_checks_category_type_and_wallet_rules(client: AsyncClient) -> None:
    """The preview applies CONTEXT.md before confirmation: a Category must
    match the row's Type, Contact Wallets only take Transfers, frozen Wallets
    are read-only, and Transfer rows must not carry wallet/category and must
    have different legs."""
    token = await _login(client)
    await _create_wallet(client, token, "Rules Checking", "checking", "100.00")
    await _create_wallet(client, token, "Rules Savings", "checking", "0.00")
    await _create_wallet(client, token, "Rules Marco", "contact", "0.00")
    await _create_wallet(client, token, "Rules Frozen", "checking", "0.00")
    await _create_category(client, token, "Rules Income Cat", "income")
    wallets = (await client.get("/wallets", headers=_auth(token))).json()
    frozen_id = next(w["id"] for w in wallets if w["name"] == "Rules Frozen")
    await client.delete(f"/wallets/{frozen_id}", headers=_auth(token))

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    # Income Category on an Expense row.
                    "2026-08-01,expense,10.00,Rules Checking,,,Rules Income Cat,,",
                    # Contact Wallet as the Expense's Wallet.
                    "2026-08-01,expense,10.00,Rules Marco,,,,,",
                    # Frozen Wallet is read-only.
                    "2026-08-01,expense,10.00,Rules Frozen,,,,,",
                    # Transfer rows carry no wallet, no category.
                    "2026-08-01,transfer,10.00,Rules Checking,Rules Checking,Rules Savings,,",
                    "2026-08-01,transfer,10.00,,Rules Checking,Rules Checking,,",
                    # Expense rows carry no source/destination.
                    "2026-08-01,expense,10.00,Rules Checking,Rules Savings,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    rows = body["rows"]
    errors = [row["error"] for row in rows]
    assert rows[0]["status"] == "error"
    assert "Rules Income Cat" in errors[0] and "not expense" in errors[0]
    assert rows[1]["status"] == "error"
    assert "Contact Wallets only participate in Transfers" in errors[1]
    assert rows[2]["status"] == "error"
    assert "is frozen" in errors[2]
    assert rows[3]["status"] == "error"
    assert "not wallet" in errors[3]
    assert rows[4]["status"] == "error"
    assert "different Wallets" in errors[4]
    assert rows[5]["status"] == "error"
    assert "only for Transfers" in errors[5]
    assert body["error_count"] == 6
    assert body["ok_count"] == 0


async def test_preview_parses_an_xlsx_file(client: AsyncClient) -> None:
    from io import BytesIO

    from openpyxl import Workbook

    token = await _login(client)
    await _create_wallet(client, token, "Xlsx Checking", "checking", "0.00")
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(
        ["date", "type", "amount", "wallet", "source wallet", "destination wallet",
         "category", "description", "location"]
    )
    sheet.append(["2026-08-01", "expense", 12.5, "Xlsx Checking", None, None, None, "Coffee", None])
    content = BytesIO()
    workbook.save(content)

    response = await client.post(
        "/import/preview",
        files={"file": ("import.xlsx", content.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok_count"] == 1
    row = body["rows"][0]
    assert row["status"] == "ok"
    assert row["amount"] == "12.50"
    assert row["description"] == "Coffee"


async def test_preview_rejects_non_template_files(client: AsyncClient) -> None:
    token = await _login(client)

    wrong_extension = await client.post(
        "/import/preview",
        files={"file": ("import.txt", b"hello", "text/plain")},
        headers=_auth(token),
    )
    assert wrong_extension.status_code == 422

    missing_column = await client.post(
        "/import/preview",
        files={"file": ("import.csv", b"date,type,amount\n2026-08-01,expense,1.00\n", "text/csv")},
        headers=_auth(token),
    )
    assert missing_column.status_code == 422
    assert "Missing required column" in missing_column.json()["detail"]


async def test_import_endpoints_require_authentication(client: AsyncClient) -> None:
    assert (
        await client.post(
            "/import/preview",
            files={"file": ("import.csv", b"date,type,amount\n", "text/csv")},
        )
    ).status_code == 401
    assert (
        await client.post("/import/confirm", json={"rows": []})
    ).status_code == 401


async def _wallet_balance(client: AsyncClient, token: str, wallet_id: int) -> str:
    wallets = (await client.get("/wallets", headers=_auth(token))).json()
    return next(w["balance"] for w in wallets if w["id"] == wallet_id)


async def _preview(client: AsyncClient, token: str, *rows: str) -> dict:
    response = await client.post(
        "/import/preview",
        files={"file": ("import.csv", _csv_bytes(*rows), "text/csv")},
        headers=_auth(token),
    )
    assert response.status_code == 200
    return response.json()


def _to_input(row: dict) -> dict:
    """A preview row, as the frontend echoes it back for confirmation."""
    return {
        key: row[key]
        for key in (
            "type", "date", "amount", "wallet", "source_wallet",
            "destination_wallet", "category", "description",
            "latitude", "longitude",
        )
    }


def _expense(
    amount: str,
    wallet: str,
    *,
    date: str = "2026-08-01",
    row: int | None = None,
    **extra: str | None,
) -> dict:
    return {
        "type": "expense", "date": date, "amount": amount, "wallet": wallet,
        "source_wallet": None, "destination_wallet": None, "category": None,
        "description": None, "latitude": None, "longitude": None,
        **({"row": row} if row is not None else {}),
        **extra,
    }


async def test_confirm_inserts_all_rows_transactionally(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Confirm Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Confirm Savings", "checking", "0.00")
    await _create_category(client, token, "Confirm Food", "expense")
    preview = await _preview(
        client,
        token,
        "2026-08-01,expense,12.50,Confirm Checking,,,Confirm Food,Lunch,",
        "2026-08-02,income,7.00,Confirm Checking,,,,,",
        "2026-08-03,transfer,50.00,,Confirm Checking,Confirm Savings,,,",
    )
    assert preview["ok_count"] == 3

    response = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row) for row in preview["rows"]]},
        headers=_auth(token),
    )

    assert response.status_code == 201
    created = response.json()
    assert len(created) == 3
    assert {t["type"] for t in created} == {"expense", "income", "transfer"}
    expense = next(t for t in created if t["type"] == "expense")
    assert expense["category_id"] is not None
    assert expense["description"] == "Lunch"
    # Checking: 100 - 12.50 + 7.00 - 50.00 = 44.50; Savings received 50.00.
    assert await _wallet_balance(client, token, checking) == "44.50"
    assert await _wallet_balance(client, token, savings) == "50.00"


async def test_confirm_rejects_an_invalid_row_and_inserts_nothing(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Reject Checking", "checking", "0.00")

    response = await client.post(
        "/import/confirm",
        json={"rows": [_expense("12.50", "Phantom Wallet")]},
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert "Unknown wallet 'Phantom Wallet'" in response.json()["detail"]
    # Nothing was inserted: the Wallet has no Transactions and its balance is 0.
    transactions = (
        await client.get(f"/transactions?wallet_id={checking}", headers=_auth(token))
    ).json()["items"]
    assert transactions == []
    assert await _wallet_balance(client, token, checking) == "0.00"


async def test_confirm_is_transactional_when_a_middle_row_fails(
    client: AsyncClient,
) -> None:
    """A valid first row is rolled back with the rest: nothing is inserted
    until every confirmed row is valid (US 32)."""
    token = await _login(client)
    checking = await _create_wallet(client, token, "Txn Checking", "checking", "0.00")
    savings = await _create_wallet(client, token, "Txn Savings", "checking", "0.00")

    response = await client.post(
        "/import/confirm",
        json={
            "rows": [
                _expense("10.00", "Txn Checking"),
                _expense("10.00", "Phantom Wallet"),
                {
                    "type": "transfer", "date": "2026-08-03", "amount": "20.00",
                    "wallet": None, "source_wallet": "Txn Checking",
                    "destination_wallet": "Txn Savings", "category": None,
                    "description": None, "latitude": None, "longitude": None,
                },
            ]
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    # Neither Wallet gained a Transaction; the batch rolled back entirely.
    assert (
        await client.get(f"/transactions?wallet_id={checking}", headers=_auth(token))
    ).json()["items"] == []
    assert await _wallet_balance(client, token, checking) == "0.00"
    assert await _wallet_balance(client, token, savings) == "0.00"


async def test_confirm_rejects_rows_already_in_the_database(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Dup Confirm Checking", "checking", "0.00")
    food = await _create_category(client, token, "Dup Confirm Food", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food,
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/confirm",
        json={
            "rows": [_expense("12.50", "Dup Confirm Checking", category="Dup Confirm Food")]
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert "duplicates" in response.json()["detail"]
    # Only the pre-existing expense remains on the Wallet.
    transactions = (
        await client.get(f"/transactions?wallet_id={checking}", headers=_auth(token))
    ).json()["items"]
    assert len(transactions) == 1


async def test_confirm_inserts_description_and_location(client: AsyncClient) -> None:
    token = await _login(client)
    await _create_wallet(client, token, "Loc Checking", "checking", "0.00")
    preview = await _preview(
        client,
        token,
        '2026-08-01,expense,12.50,Loc Checking,,,,Weekly shop,"41.9028,12.4964"',
    )
    row = preview["rows"][0]
    assert row["status"] == "ok"
    assert row["latitude"] == "41.9028"
    assert row["longitude"] == "12.4964"

    response = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row)]},
        headers=_auth(token),
    )

    assert response.status_code == 201
    created = response.json()[0]
    assert created["description"] == "Weekly shop"
    assert created["latitude"] == "41.9028"
    assert created["longitude"] == "12.4964"


async def test_confirm_accepts_euro_amounts_and_type_case(client: AsyncClient) -> None:
    """The parser is lenient about the template's spelling: "12,50" and
    "Expense" (and ';'-separated exports) all land as canonical data."""
    token = await _login(client)
    await _create_wallet(client, token, "Case Checking", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                b"date;type;amount;wallet;source wallet;destination wallet;category;description;location\n"
                b"2026-08-01;Expense;12,50;Case Checking;;;;;\n",
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok_count"] == 1
    row = body["rows"][0]
    assert row["type"] == "expense"
    assert row["amount"] == "12.50"

    confirmed = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row)]},
        headers=_auth(token),
    )
    assert confirmed.status_code == 201
    assert confirmed.json()[0]["amount"] == "12.50"


async def test_preview_resolves_same_named_categories_by_type(
    client: AsyncClient,
) -> None:
    """An expense "Food" and an income "Food" coexist (CONTEXT.md): each row
    resolves to the Category of its own Type, and the preview says ok for both."""
    token = await _login(client)
    await _create_wallet(client, token, "Same Name Checking", "checking", "0.00")
    await _create_category(client, token, "Same Name Food", "expense")
    await _create_category(client, token, "Same Name Food", "income")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,10.00,Same Name Checking,,,Same Name Food,,",
                    "2026-08-01,income,10.00,Same Name Checking,,,Same Name Food,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "ok"]


async def test_confirm_accepts_a_row_differing_only_by_description(
    client: AsyncClient,
) -> None:
    """Confirm re-checks with the same key as the preview: a row identical to
    a database row except for the description is not a Duplicate and is
    inserted (ADR-0006)."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Desc Confirm Checking", "checking", "0.00"
    )
    food = await _create_category(client, token, "Desc Confirm Food", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food, "description": "Lunch",
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/confirm",
        json={
            "rows": [
                _expense(
                    "12.50", "Desc Confirm Checking",
                    category="Desc Confirm Food", description="Dinner",
                )
            ]
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    created = response.json()
    assert len(created) == 1
    assert created[0]["description"] == "Dinner"


async def test_confirm_duplicate_by_description_rejects_the_whole_batch(
    client: AsyncClient,
) -> None:
    """A confirmed row matching a database row including the description is a
    Duplicate at confirm time too, and the batch is rejected all-or-nothing:
    the valid row in the same batch is rolled back with it."""
    token = await _login(client)
    checking = await _create_wallet(
        client, token, "Desc Reject Checking", "checking", "0.00"
    )
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "description": "Lunch",
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/confirm",
        json={
            "rows": [
                _expense("1.00", "Desc Reject Checking", description="Fresh"),
                _expense("12.50", "Desc Reject Checking", description="Lunch"),
            ]
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert "duplicates" in response.json()["detail"]
    # Nothing was written: only the pre-existing expense remains on the Wallet.
    transactions = (
        await client.get(f"/transactions?wallet_id={checking}", headers=_auth(token))
    ).json()["items"]
    assert len(transactions) == 1


async def test_confirm_duplicate_message_names_the_row(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Dup Row Checking", "checking", "0.00")
    food = await _create_category(client, token, "Dup Row Food", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense", "amount": "12.50", "date": "2026-08-01",
            "wallet_id": checking, "category_id": food,
        },
        headers=_auth(token),
    )

    response = await client.post(
        "/import/confirm",
        json={
            "rows": [
                _expense("12.50", "Dup Row Checking", category="Dup Row Food", row=4)
            ]
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert "Row 4" in response.json()["detail"]


async def test_preview_flags_rows_repeated_within_the_file(client: AsyncClient) -> None:
    """The same row twice in one file: the first is ok, the later occurrences
    are flagged duplicate so the user drops them before confirming — otherwise
    the transactional insert would reject the whole batch at confirm time."""
    token = await _login(client)
    await _create_wallet(client, token, "Repeat Checking", "checking", "0.00")

    response = await client.post(
        "/import/preview",
        files={
            "file": (
                "import.csv",
                _csv_bytes(
                    "2026-08-01,expense,10.00,Repeat Checking,,,,,",
                    "2026-08-01,expense,10.00,Repeat Checking,,,,,",
                    "2026-08-01,expense,10.00,Repeat Checking,,,,,",
                ),
                "text/csv",
            )
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert [row["status"] for row in body["rows"]] == ["ok", "duplicate", "duplicate"]
    assert body["duplicate_count"] == 2
    assert body["ok_count"] == 1


async def test_confirm_reports_cash_warning_on_created_transactions(
    client: AsyncClient,
) -> None:
    """An import that makes a Cash Wallet negative returns the warning flag on
    the created Transactions, exactly like a typed Expense (CONTEXT.md): the
    write succeeds and the response carries the indicator."""
    token = await _login(client)
    cash = await _create_wallet(client, token, "Import Cash", "cash", "10.00")
    preview = await _preview(client, token, "2026-08-01,expense,25.00,Import Cash,,,,")

    response = await client.post(
        "/import/confirm",
        json={"rows": [_to_input(row) for row in preview["rows"]]},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()[0]["warning"] is True
    assert await _wallet_balance(client, token, cash) == "-15.00"
