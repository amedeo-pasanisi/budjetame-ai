import base64
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import (
    Account,
    Category,
    CategoryType,
    Transaction,
    TransactionType,
    Wallet,
    WalletType,
)

from conftest import SEED_EMAIL, SEED_PASSWORD, delete_account, insert_foreign_account


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


async def _wallet_balance(
    client: AsyncClient, token: str, wallet_id: int
) -> str:
    wallets = (await client.get("/wallets", headers=_auth(token))).json()
    return next(w["balance"] for w in wallets if w["id"] == wallet_id)


async def _list_page(
    client: AsyncClient, token: str, **params: str | int | None
) -> dict[str, Any]:
    """One page of the Transactions list — the { items, next_cursor } envelope.
    None values are dropped (httpx would send them as the literal "None")."""
    query = {k: v for k, v in params.items() if v is not None}
    response = await client.get("/transactions", params=query, headers=_auth(token))
    assert response.status_code == 200
    return response.json()


async def _list_all(
    client: AsyncClient, token: str, **params: str | int | None
) -> list[dict]:
    """Every Transaction matching the params, walked page by page."""
    items: list[dict] = []
    cursor: str | None = None
    while True:
        page = await _list_page(client, token, cursor=cursor, **params)
        items.extend(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            return items


async def test_transactions_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/transactions")).status_code == 401
    assert (
        await client.post(
            "/transactions",
            json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": 1},
        )
    ).status_code == 401


async def test_create_expense_updates_balance(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Expense Wallet", "checking", "100.00")

    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "30.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "expense"
    assert body["amount"] == "30.00"
    assert body["date"] == "2026-08-06"
    assert body["wallet_id"] == wallet_id
    assert body["warning"] is False
    assert await _wallet_balance(client, token, wallet_id) == "70.00"


async def test_create_income_updates_balance(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Income Wallet", "checking", "50.00")

    response = await client.post(
        "/transactions",
        json={"type": "income", "amount": "20.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["type"] == "income"
    assert await _wallet_balance(client, token, wallet_id) == "70.00"


async def test_create_transaction_with_category_description_and_location(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Full Transaction Wallet", "checking", "0.00")
    category_id = await _create_category(client, token, "Full Tx Groceries", "expense")

    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "12.50",
            "date": "2026-08-06",
            "wallet_id": wallet_id,
            "category_id": category_id,
            "description": "Weekly shop",
            "latitude": "41.9028",
            "longitude": "12.4964",
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["category_id"] == category_id
    assert body["description"] == "Weekly shop"
    assert body["latitude"] == "41.9028"
    assert body["longitude"] == "12.4964"


async def test_create_transaction_rejects_non_positive_amount(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Zero Amount Wallet", "checking", "0.00")

    for amount in ("0.00", "-5.00"):
        response = await client.post(
            "/transactions",
            json={"type": "expense", "amount": amount, "date": "2026-08-06", "wallet_id": wallet_id},
            headers=_auth(token),
        )
        assert response.status_code == 422, amount


async def test_create_transaction_rejects_bad_date(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Bad Date Wallet", "checking", "0.00")

    for date in ("2026-13-45", "06/08/2026", "yesterday"):
        response = await client.post(
            "/transactions",
            json={"type": "expense", "amount": "10.00", "date": date, "wallet_id": wallet_id},
            headers=_auth(token),
        )
        assert response.status_code == 422, date


async def test_create_transaction_rejects_types_other_than_expense_income(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Wrong Type Wallet", "checking", "0.00")

    for type_ in ("transfer", "opening_balance", "savings"):
        response = await client.post(
            "/transactions",
            json={"type": type_, "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
            headers=_auth(token),
        )
        assert response.status_code == 422, type_


async def test_cash_wallet_going_negative_returns_warning_but_succeeds(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Cash Warning Wallet", "cash", "10.00")

    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "25.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["warning"] is True
    assert await _wallet_balance(client, token, wallet_id) == "-15.00"


async def test_non_cash_wallet_going_negative_has_no_warning(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Checking Negative Wallet", "checking", "10.00")

    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "25.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["warning"] is False
    assert await _wallet_balance(client, token, wallet_id) == "-15.00"


async def test_contact_wallet_rejects_expense_and_income(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Marco Contact", "contact", "0.00")

    for type_ in ("expense", "income"):
        response = await client.post(
            "/transactions",
            json={"type": type_, "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
            headers=_auth(token),
        )
        assert response.status_code == 422, type_


async def test_category_must_match_the_transaction_type(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Category Match Wallet", "checking", "0.00")
    income_category = await _create_category(client, token, "Cat Match Bonus", "income")

    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2026-08-06",
            "wallet_id": wallet_id,
            "category_id": income_category,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_foreign_wallet_is_rejected(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "thief@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id,
                name="Foreign Funds",
                type=WalletType.CHECKING.value,
            )
            session.add(wallet)
            session.commit()
            wallet_id = wallet.id

        engine.dispose()
        response = await client.post(
            "/transactions",
            json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
            headers=_auth(token),
        )

        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_missing_wallet_is_rejected(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": 999999},
        headers=_auth(token),
    )

    assert response.status_code == 403


async def test_foreign_category_is_rejected(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Foreign Category Wallet", "checking", "0.00")
    account_id = insert_foreign_account(database_url, "spy@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            category = Category(
                account_id=account_id,
                name="Their Secrets",
                type=CategoryType.EXPENSE.value,
                color="#000000",
            )
            session.add(category)
            session.commit()
            category_id = category.id

        engine.dispose()
        response = await client.post(
            "/transactions",
            json={
                "type": "expense",
                "amount": "10.00",
                "date": "2026-08-06",
                "wallet_id": wallet_id,
                "category_id": category_id,
            },
            headers=_auth(token),
        )

        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_location_requires_both_coordinates(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Half Location Wallet", "checking", "0.00")

    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2026-08-06",
            "wallet_id": wallet_id,
            "latitude": "41.9028",
        },
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_location_rejects_out_of_range_coordinates(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Bad Location Wallet", "checking", "0.00")

    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2026-08-06",
            "wallet_id": wallet_id,
            "latitude": "200.0",
            "longitude": "12.5",
        },
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_edit_transaction_updates_the_balance(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Balance Wallet", "checking", "100.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "30.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    assert await _wallet_balance(client, token, wallet_id) == "70.00"

    edited = await client.patch(
        f"/transactions/{transaction_id}",
        json={"amount": "10.00"},
        headers=_auth(token),
    )

    assert edited.status_code == 200
    assert edited.json()["amount"] == "10.00"
    assert await _wallet_balance(client, token, wallet_id) == "90.00"


async def test_delete_transaction_updates_the_balance(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Delete Balance Wallet", "checking", "100.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "30.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    assert await _wallet_balance(client, token, wallet_id) == "70.00"

    response = await client.delete(f"/transactions/{transaction_id}", headers=_auth(token))

    assert response.status_code == 200
    # Deleting an Expense raises the balance — no Cash Wallet is pushed negative.
    assert response.json()["warning"] is False
    assert await _wallet_balance(client, token, wallet_id) == "100.00"


async def test_delete_making_cash_negative_returns_warning(client: AsyncClient) -> None:
    """US10/ID8: the delete response carries the indicator exactly when the
    delete leaves a Cash Wallet negative — deleting an Income undoes its
    credit, which can push the wallet below €0."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Delete Cash Warning", "cash", "0.00")
    income = await client.post(
        "/transactions",
        json={"type": "income", "amount": "100.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "130.00", "date": "2026-08-07", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    assert await _wallet_balance(client, token, wallet_id) == "-30.00"

    delete = await client.delete(
        f"/transactions/{income.json()['id']}", headers=_auth(token)
    )

    assert delete.status_code == 200
    assert delete.json()["warning"] is True
    assert await _wallet_balance(client, token, wallet_id) == "-130.00"


async def test_delete_that_does_not_make_cash_negative_has_no_warning(
    client: AsyncClient,
) -> None:
    """Deleting an Expense raises the Wallet's balance — never what the delete
    pushes negative — so the delete response has no indicator (US10/ID8)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Delete No Warn Cash", "cash", "50.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "20.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    delete = await client.delete(
        f"/transactions/{created.json()['id']}", headers=_auth(token)
    )

    assert delete.status_code == 200
    assert delete.json()["warning"] is False
    assert await _wallet_balance(client, token, wallet_id) == "50.00"


async def test_delete_of_a_transfer_making_the_destination_negative_warns(
    client: AsyncClient,
) -> None:
    """Deleting a Transfer undoes the Destination's credit — the Destination is
    the wallet a Transfer delete can push negative, not the Source (US10/ID8)."""
    token = await _login(client)
    cash = await _create_wallet(client, token, "Delete Transfer Dest Cash", "cash", "0.00")
    checking = await _create_wallet(
        client, token, "Delete Transfer Source Checking", "checking", "100.00"
    )
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "80.00", "date": "2026-08-06", "wallet_id": cash},
        headers=_auth(token),
    )
    transfer = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": cash,
        },
        headers=_auth(token),
    )
    assert await _wallet_balance(client, token, cash) == "-30.00"

    delete = await client.delete(
        f"/transactions/{transfer.json()['id']}", headers=_auth(token)
    )

    assert delete.status_code == 200
    assert delete.json()["warning"] is True
    assert await _wallet_balance(client, token, cash) == "-80.00"


async def test_list_transactions_never_carries_the_warning(client: AsyncClient) -> None:
    """The indicator belongs to the write (ID8): a Transaction on a
    currently-negative Cash Wallet reads back with warning False — the read
    does not re-assert the write's warning."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Read No Warn Cash", "cash", "10.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "25.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    # The write itself warns — the wallet is negative right now.
    assert created.json()["warning"] is True
    assert await _wallet_balance(client, token, wallet_id) == "-15.00"

    listing = await _list_all(client, token)
    rows = [t for t in listing if t["wallet_id"] == wallet_id]
    # The wallet's rows (the Opening Balance and the Expense) read back without
    # the indicator — it belongs to the write, never to reads.
    assert len(rows) == 2
    assert all(t["warning"] is False for t in rows)
    assert next(t for t in rows if t["id"] == created.json()["id"])["warning"] is False


async def test_edit_transaction_rejects_type_and_wallet_changes(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Immutable Fields Wallet", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]

    response = await client.patch(
        f"/transactions/{transaction_id}",
        json={"type": "income"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_edit_transaction_can_set_and_clear_a_category(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Category Wallet", "checking", "0.00")
    category_id = await _create_category(client, token, "Edit Cat Food", "expense")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]

    with_category = await client.patch(
        f"/transactions/{transaction_id}",
        json={"category_id": category_id},
        headers=_auth(token),
    )
    assert with_category.status_code == 200
    assert with_category.json()["category_id"] == category_id

    cleared = await client.patch(
        f"/transactions/{transaction_id}",
        json={"category_id": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200
    assert cleared.json()["category_id"] is None


async def test_edit_transaction_rejects_a_wrong_type_category(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Wrong Category Wallet", "checking", "0.00")
    income_category = await _create_category(client, token, "Edit Wrong Cat Bonus", "income")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/transactions/{created.json()['id']}",
        json={"category_id": income_category},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_edit_transaction_requires_a_change(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "No Change Wallet", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/transactions/{created.json()['id']}", json={}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_edit_transaction_can_change_the_date(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Date Wallet", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/transactions/{created.json()['id']}",
        json={"date": "2026-01-15"},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["date"] == "2026-01-15"


async def test_edit_making_cash_negative_returns_warning(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Cash Warning Wallet", "cash", "10.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "5.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    assert created.json()["warning"] is False

    response = await client.patch(
        f"/transactions/{transaction_id}",
        json={"amount": "25.00"},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["warning"] is True
    assert await _wallet_balance(client, token, wallet_id) == "-15.00"


async def test_list_transactions_is_newest_first_and_filters_by_wallet(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_a = await _create_wallet(client, token, "List Wallet A", "checking", "0.00")
    wallet_b = await _create_wallet(client, token, "List Wallet B", "checking", "0.00")
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "5.00", "date": "2026-08-01", "wallet_id": wallet_a},
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "7.00", "date": "2026-08-03", "wallet_id": wallet_b},
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={"type": "income", "amount": "50.00", "date": "2026-08-06", "wallet_id": wallet_a},
        headers=_auth(token),
    )

    all_transactions = await _list_all(client, token)
    assert len(all_transactions) >= 3

    only_a = await _list_all(client, token, wallet_id=wallet_a)
    assert [t["date"] for t in only_a] == ["2026-08-06", "2026-08-01"]
    assert all(t["wallet_id"] == wallet_a for t in only_a)

    only_b = await _list_all(client, token, wallet_id=wallet_b)
    assert [t["date"] for t in only_b] == ["2026-08-03"]


async def test_list_foreign_wallet_filter_is_forbidden(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "nosy@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id, name="Their Wallet", type=WalletType.CASH.value
            )
            session.add(wallet)
            session.commit()
            wallet_id = wallet.id

        engine.dispose()
        response = await client.get(
            f"/transactions?wallet_id={wallet_id}", headers=_auth(token)
        )

        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_foreign_transaction_returns_403(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "mole@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(account_id=account_id, name="Mole Wallet", type=WalletType.CASH.value)
            session.add(wallet)
            session.flush()
            transaction = Transaction(
                account_id=account_id,
                wallet_id=wallet.id,
                type=TransactionType.EXPENSE.value,
                amount="10.00",
            )
            session.add(transaction)
            session.commit()
            transaction_id = transaction.id

        engine.dispose()
        patch = await client.patch(
            f"/transactions/{transaction_id}",
            json={"amount": "5.00"},
            headers=_auth(token),
        )
        delete = await client.delete(
            f"/transactions/{transaction_id}", headers=_auth(token)
        )
        assert patch.status_code == 403
        assert delete.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_opening_balance_transactions_are_read_only(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/wallets",
        json={"name": "Opening Readonly Wallet", "type": "checking", "opening_balance": "100.00"},
        headers=_auth(token),
    )
    wallet_id = created.json()["id"]
    transactions = await _list_all(client, token)
    opening = next(t for t in transactions if t["wallet_id"] == wallet_id)

    patch = await client.patch(
        f"/transactions/{opening['id']}",
        json={"amount": "5.00"},
        headers=_auth(token),
    )
    delete = await client.delete(f"/transactions/{opening['id']}", headers=_auth(token))

    assert patch.status_code == 422
    assert delete.status_code == 422
    assert await _wallet_balance(client, token, wallet_id) == "100.00"


# --- T6: writes against frozen Wallets are rejected (ADR-0002) ---


async def _freeze_wallet(client: AsyncClient, token: str, wallet_id: int) -> None:
    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))
    assert response.status_code == 204


async def test_frozen_wallet_rejects_new_transactions(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Frozen Create Wallet", "checking", "0.00")
    await _freeze_wallet(client, token, wallet_id)

    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_frozen_wallet_transactions_cannot_be_edited_or_deleted(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Frozen Edit Wallet", "checking", "100.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "30.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    # Bring the Wallet to exactly €0 so freezing is allowed: a second expense of 70.
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "70.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    await _freeze_wallet(client, token, wallet_id)

    patch = await client.patch(
        f"/transactions/{transaction_id}",
        json={"amount": "5.00"},
        headers=_auth(token),
    )
    delete = await client.delete(f"/transactions/{transaction_id}", headers=_auth(token))

    assert patch.status_code == 422
    assert delete.status_code == 422


async def test_frozen_wallet_transactions_stay_viewable_and_net_to_zero(
    client: AsyncClient,
) -> None:
    """After freezing, the Wallet is gone from the list but its Transactions are
    still served, and they still net to €0 (ADR-0001: Balance = sum of
    Transactions; ADR-0002: nothing can change them anymore)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Frozen View Wallet", "checking", "100.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "100.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    await _freeze_wallet(client, token, wallet_id)

    listed = await _list_all(client, token, wallet_id=wallet_id)

    # The frozen Wallet's history stays viewable: the Opening Balance (100.00)
    # and the Expense (100.00) both remain listed.
    assert len(listed) == 2
    assert any(t["id"] == transaction_id and t["type"] == "expense" for t in listed)
    assert any(t["type"] == "opening_balance" for t in listed)
    total = Decimal("0.00")
    for transaction in listed:
        amount = Decimal(transaction["amount"])
        total += -amount if transaction["type"] == "expense" else amount
    assert total == Decimal("0.00")



# --- T7: Transfers, Contact Wallets, IOUs ---


async def _net_worth(client: AsyncClient, token: str) -> Decimal:
    """Sum of all Wallet balances — the derived Net Worth (CONTEXT.md)."""
    wallets = (await client.get("/wallets", headers=_auth(token))).json()
    return sum((Decimal(w["balance"]) for w in wallets), Decimal("0.00"))


async def test_create_transfer_moves_money_and_keeps_net_worth(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Transfer Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Transfer Savings", "checking", "0.00")
    before = await _net_worth(client, token)

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
            "description": "Pay the card",
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["type"] == "transfer"
    assert body["amount"] == "50.00"
    assert body["source_wallet_id"] == checking
    assert body["destination_wallet_id"] == savings
    assert body["category_id"] is None
    assert await _wallet_balance(client, token, checking) == "50.00"
    assert await _wallet_balance(client, token, savings) == "50.00"
    assert await _net_worth(client, token) == before


async def test_transfer_to_contact_wallet_is_a_receivable(client: AsyncClient) -> None:
    """Transferring €50 from Checking to a Contact Wallet ('Marco') leaves Marco
    at +€50 — a receivable in my favor — and Contact Balances count toward Net
    Worth (so the total includes Marco's +50)."""
    token = await _login(client)
    checking = await _create_wallet(client, token, "IOU Checking", "checking", "100.00")
    marco = await _create_wallet(client, token, "Marco", "contact", "0.00")
    before = await _net_worth(client, token)

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": marco,
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert await _wallet_balance(client, token, checking) == "50.00"
    assert await _wallet_balance(client, token, marco) == "50.00"
    # Net Worth is the sum of ALL balances, Contact included: Marco's receivable
    # offsets the source exactly, so the total is unchanged. If Contact Balances
    # were excluded from the sum, this Transfer would have reduced Net Worth by
    # €50 instead.
    assert await _net_worth(client, token) == before


async def test_transfer_requires_different_wallets(client: AsyncClient) -> None:
    token = await _login(client)
    wallet = await _create_wallet(client, token, "Same Wallet", "checking", "100.00")

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": wallet,
            "destination_wallet_id": wallet,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert await _wallet_balance(client, token, wallet) == "100.00"


async def test_transfer_never_carries_a_category(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "No Category Transfer", "checking", "100.00")
    savings = await _create_wallet(client, token, "No Category Savings", "checking", "0.00")
    category = await _create_category(client, token, "No Category Cat", "expense")

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
            "category_id": category,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_transfer_from_foreign_wallet_is_forbidden(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Foreign Source Checking", "checking", "100.00")
    account_id = insert_foreign_account(database_url, "foreign-source@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id, name="Their Funds", type=WalletType.CHECKING.value
            )
            session.add(wallet)
            session.commit()
            foreign_id = wallet.id

        engine.dispose()
        response = await client.post(
            "/transactions",
            json={
                "type": "transfer",
                "amount": "50.00",
                "date": "2026-08-08",
                "source_wallet_id": foreign_id,
                "destination_wallet_id": checking,
            },
            headers=_auth(token),
        )

        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_transfer_to_a_frozen_wallet_is_rejected(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Frozen Destination Checking", "checking", "100.00")
    frozen = await _create_wallet(client, token, "Frozen Destination", "checking", "0.00")
    await _freeze_wallet(client, token, frozen)

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": frozen,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert await _wallet_balance(client, token, checking) == "100.00"


async def test_transfer_from_a_frozen_wallet_is_rejected(client: AsyncClient) -> None:
    token = await _login(client)
    frozen = await _create_wallet(client, token, "Frozen Source", "checking", "0.00")
    savings = await _create_wallet(client, token, "Frozen Source Savings", "checking", "0.00")
    await _freeze_wallet(client, token, frozen)

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": frozen,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_transfer_making_cash_source_negative_warns_but_succeeds(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    cash = await _create_wallet(client, token, "Cash Transfer Source", "cash", "10.00")
    savings = await _create_wallet(client, token, "Cash Transfer Savings", "checking", "0.00")

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "25.00",
            "date": "2026-08-08",
            "source_wallet_id": cash,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["warning"] is True
    assert await _wallet_balance(client, token, cash) == "-15.00"


async def test_transfer_to_cash_destination_never_warns(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "No Warn Transfer Checking", "checking", "0.00")
    cash = await _create_wallet(client, token, "No Warn Cash Destination", "cash", "0.00")

    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "25.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": cash,
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["warning"] is False
    assert await _wallet_balance(client, token, cash) == "25.00"


async def test_edit_transfer_updates_both_balances(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Edit Transfer Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Edit Transfer Savings", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    assert await _wallet_balance(client, token, checking) == "50.00"
    assert await _wallet_balance(client, token, savings) == "50.00"

    edited = await client.patch(
        f"/transactions/{transaction_id}",
        json={"amount": "20.00"},
        headers=_auth(token),
    )

    assert edited.status_code == 200
    assert edited.json()["amount"] == "20.00"
    assert await _wallet_balance(client, token, checking) == "80.00"
    assert await _wallet_balance(client, token, savings) == "20.00"


async def test_edit_transfer_rejects_a_category(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Edit Transfer Cat Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Edit Transfer Cat Savings", "checking", "0.00")
    category = await _create_category(client, token, "Transfer Cat", "expense")
    created = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )

    response = await client.patch(
        f"/transactions/{created.json()['id']}",
        json={"category_id": category},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_delete_transfer_restores_both_balances(client: AsyncClient) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Delete Transfer Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Delete Transfer Savings", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]

    response = await client.delete(f"/transactions/{transaction_id}", headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["warning"] is False
    assert await _wallet_balance(client, token, checking) == "100.00"
    assert await _wallet_balance(client, token, savings) == "0.00"




async def test_transfer_of_a_frozen_wallet_cannot_be_edited_or_deleted(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Frozen Transfer Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Frozen Transfer Savings", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "100.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    # Checking is now at €0 and can be frozen.
    await _freeze_wallet(client, token, checking)

    patch = await client.patch(
        f"/transactions/{transaction_id}",
        json={"amount": "5.00"},
        headers=_auth(token),
    )
    delete = await client.delete(f"/transactions/{transaction_id}", headers=_auth(token))

    assert patch.status_code == 422
    assert delete.status_code == 422


async def test_wallet_transaction_filter_includes_transfers_on_both_legs(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    checking = await _create_wallet(client, token, "Filter Transfer Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Filter Transfer Savings", "checking", "0.00")
    transfer = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "50.00",
            "date": "2026-08-08",
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )
    transfer_id = transfer.json()["id"]

    as_source = await _list_all(client, token, wallet_id=checking)
    as_destination = await _list_all(client, token, wallet_id=savings)

    assert transfer_id in [t["id"] for t in as_source]
    assert transfer_id in [t["id"] for t in as_destination]


# --- T8: Transaction history filters ---


async def test_history_filters_by_date_range_inclusively(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "History Range Wallet", "checking", "0.00")
    for day in ("2026-08-01", "2026-08-10", "2026-08-20"):
        response = await client.post(
            "/transactions",
            json={"type": "expense", "amount": "5.00", "date": day, "wallet_id": wallet_id},
            headers=_auth(token),
        )
        assert response.status_code == 201

    middle = await _list_all(
        client,
        token,
        wallet_id=wallet_id,
        from_date="2026-08-05",
        to_date="2026-08-15",
    )
    assert [t["date"] for t in middle] == ["2026-08-10"]

    single_day = await _list_all(
        client,
        token,
        wallet_id=wallet_id,
        from_date="2026-08-20",
        to_date="2026-08-20",
    )
    assert [t["date"] for t in single_day] == ["2026-08-20"]

    open_ended = await _list_all(client, token, wallet_id=wallet_id, from_date="2026-08-11")
    assert [t["date"] for t in open_ended] == ["2026-08-20"]


async def test_history_filters_by_category(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "History Category Wallet", "checking", "0.00")
    food = await _create_category(client, token, "History Cat Food", "expense")
    travel = await _create_category(client, token, "History Cat Travel", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "5.00",
            "date": "2026-08-10",
            "wallet_id": wallet_id,
            "category_id": food,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "7.00",
            "date": "2026-08-11",
            "wallet_id": wallet_id,
            "category_id": travel,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "9.00", "date": "2026-08-12", "wallet_id": wallet_id},
        headers=_auth(token),
    )

    only_food = await _list_all(
        client, token, wallet_id=wallet_id, category_id=food
    )
    assert [t["amount"] for t in only_food] == ["5.00"]


async def test_history_combines_wallet_date_and_category_filters(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_a = await _create_wallet(client, token, "History Combine A", "checking", "0.00")
    wallet_b = await _create_wallet(client, token, "History Combine B", "checking", "0.00")
    food = await _create_category(client, token, "History Combine Food", "expense")
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "1.00",
            "date": "2026-08-01",
            "wallet_id": wallet_a,
            "category_id": food,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "2.00",
            "date": "2026-08-10",
            "wallet_id": wallet_a,
            "category_id": food,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={"type": "expense", "amount": "3.00", "date": "2026-08-10", "wallet_id": wallet_b},
        headers=_auth(token),
    )

    filtered = await _list_all(
        client,
        token,
        wallet_id=wallet_a,
        category_id=food,
        from_date="2026-08-05",
        to_date="2026-08-15",
    )

    assert [t["amount"] for t in filtered] == ["2.00"]


async def test_history_rejects_a_bad_date_filter(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "History Bad Date", "checking", "0.00")

    response = await client.get(
        f"/transactions?wallet_id={wallet_id}&from_date=06/08/2026", headers=_auth(token)
    )

    assert response.status_code == 422


async def test_history_foreign_category_filter_is_forbidden(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "History Foreign Cat", "checking", "0.00")
    account_id = insert_foreign_account(database_url, "history-spy@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            category = Category(
                account_id=account_id,
                name="Their History",
                type=CategoryType.EXPENSE.value,
                color="#000000",
            )
            session.add(category)
            session.commit()
            category_id = category.id

        engine.dispose()
        response = await client.get(
            f"/transactions?wallet_id={wallet_id}&category_id={category_id}",
            headers=_auth(token),
        )

        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


# --- T9: Geographic Location on transactions ---


async def test_edit_transaction_can_set_and_clear_a_location(client: AsyncClient) -> None:
    """Coordinates can be attached to (and removed from) a Transaction through
    the API; only the coordinates are stored — no Maps link ever reaches the
    database (spec decision #11, T9)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Location Wallet", "checking", "0.00")
    created = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2026-08-08", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    transaction_id = created.json()["id"]
    assert created.json()["latitude"] is None

    with_location = await client.patch(
        f"/transactions/{transaction_id}",
        json={"latitude": "41.9028", "longitude": "12.4964"},
        headers=_auth(token),
    )
    assert with_location.status_code == 200
    assert with_location.json()["latitude"] == "41.9028"
    assert with_location.json()["longitude"] == "12.4964"

    cleared = await client.patch(
        f"/transactions/{transaction_id}",
        json={"latitude": None, "longitude": None},
        headers=_auth(token),
    )
    assert cleared.status_code == 200
    assert cleared.json()["latitude"] is None
    assert cleared.json()["longitude"] is None


# --- Cursor pagination (#30) ---


async def _create_expense(
    client: AsyncClient, token: str, wallet_id: int, amount: str, date: str
) -> int:
    response = await client.post(
        "/transactions",
        json={"type": "expense", "amount": amount, "date": date, "wallet_id": wallet_id},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_list_returns_the_paged_envelope(client: AsyncClient) -> None:
    """The list endpoint serves { items, next_cursor }, never a bare array."""
    token = await _login(client)

    page = await _list_page(client, token)

    assert set(page.keys()) == {"items", "next_cursor"}
    assert isinstance(page["items"], list)
    assert page["next_cursor"] is None or isinstance(page["next_cursor"], str)


async def test_list_limit_returns_at_most_n_items_and_a_cursor(
    client: AsyncClient,
) -> None:
    """limit defaults to 50; the envelope carries an opaque next_cursor until
    the last page, which has next_cursor null."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Page Size Wallet", "checking", "0.00")
    base = date(2026, 1, 1)
    for offset in range(55):  # 55 expenses: 2026-01-01 .. 2026-02-24
        await _create_expense(
            client, token, wallet_id, "5.00", f"{base + timedelta(days=offset):%Y-%m-%d}"
        )

    first = await _list_page(client, token, wallet_id=wallet_id)
    assert len(first["items"]) == 50
    assert first["next_cursor"] is not None

    second = await _list_page(
        client, token, wallet_id=wallet_id, cursor=first["next_cursor"]
    )
    assert len(second["items"]) == 5
    assert second["next_cursor"] is None


async def test_list_pages_follow_strictly_before_ordering(
    client: AsyncClient,
) -> None:
    """A page walk is contiguous and newest-first: every row appears exactly
    once, and the cursor boundary is exclusive (each page starts strictly
    after the previous page's last row)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Ordered Pages Wallet", "checking", "0.00")
    ids = [
        await _create_expense(client, token, wallet_id, "5.00", f"2026-08-0{day}")
        for day in range(1, 8)  # 2026-08-01 .. 2026-08-07
    ]

    pages: list[list[dict]] = []
    cursor: str | None = None
    while True:
        page = await _list_page(client, token, wallet_id=wallet_id, limit=3, cursor=cursor)
        pages.append(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert [len(p) for p in pages] == [3, 3, 1]
    assert [t["id"] for p in pages for t in p] == list(reversed(ids))
    assert [t["date"] for t in pages[0]] == ["2026-08-07", "2026-08-06", "2026-08-05"]
    assert [t["date"] for t in pages[1]] == ["2026-08-04", "2026-08-03", "2026-08-02"]
    assert [t["date"] for t in pages[2]] == ["2026-08-01"]


async def test_list_breaks_same_date_ties_by_id_desc(client: AsyncClient) -> None:
    """(date, id) is the sort key: same-day rows page in id-descending order
    with no overlap or gaps across the walk."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Tiebreak Pages Wallet", "checking", "0.00")
    ids = [
        await _create_expense(client, token, wallet_id, "5.00", "2026-08-06")
        for _ in range(5)
    ]

    pages: list[list[dict]] = []
    cursor: str | None = None
    while True:
        page = await _list_page(client, token, wallet_id=wallet_id, limit=2, cursor=cursor)
        pages.append(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert [len(p) for p in pages] == [2, 2, 1]
    assert [t["id"] for p in pages for t in p] == list(reversed(ids))


async def test_list_cursor_survives_a_mid_scroll_insert(client: AsyncClient) -> None:
    """The Import scenario: rows inserted after page 1 was fetched neither
    duplicate nor skip already-fetched rows — a newer row lands in page 1's
    region (found on refetch), an older row lands in the final page."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Insert Pages Wallet", "checking", "0.00")
    for day in range(1, 6):  # 2026-08-01 .. 2026-08-05
        await _create_expense(client, token, wallet_id, "5.00", f"2026-08-0{day}")

    first = await _list_page(client, token, wallet_id=wallet_id, limit=2)
    assert [t["date"] for t in first["items"]] == ["2026-08-05", "2026-08-04"]
    cursor = first["next_cursor"]
    assert cursor is not None

    # Mid-scroll inserts: one newer than everything fetched, one older.
    await _create_expense(client, token, wallet_id, "5.00", "2026-08-06")
    await _create_expense(client, token, wallet_id, "5.00", "2026-07-30")

    second = await _list_page(client, token, wallet_id=wallet_id, limit=2, cursor=cursor)
    assert [t["date"] for t in second["items"]] == ["2026-08-03", "2026-08-02"]
    third = await _list_page(
        client, token, wallet_id=wallet_id, limit=2, cursor=second["next_cursor"]
    )
    assert [t["date"] for t in third["items"]] == ["2026-08-01", "2026-07-30"]
    assert third["next_cursor"] is None


async def test_list_filters_compose_with_paging(client: AsyncClient) -> None:
    """Wallet, Category, and date-range filters all compose with the cursor:
    each walk returns exactly the filtered rows, in order, no duplicates."""
    token = await _login(client)
    wallet_a = await _create_wallet(client, token, "Compose Pages A", "checking", "0.00")
    wallet_b = await _create_wallet(client, token, "Compose Pages B", "checking", "0.00")
    food = await _create_category(client, token, "Compose Pages Food", "expense")
    for day in range(1, 8):  # 7 on A, 3 on B
        await _create_expense(client, token, wallet_a, "5.00", f"2026-08-0{day}")
    for day in range(1, 4):
        await _create_expense(client, token, wallet_b, "5.00", f"2026-08-0{day}")
    # The two newest of A's rows carry the Food Category.
    a_rows = await _list_all(client, token, wallet_id=wallet_a)
    for row in a_rows[:2]:
        await client.patch(
            f"/transactions/{row['id']}",
            json={"category_id": food},
            headers=_auth(token),
        )

    # Wallet walk never leaks B's rows; the walk matches the single fetch.
    walked = await _list_all(client, token, wallet_id=wallet_a, limit=3)
    assert len(walked) == 7
    assert all(t["wallet_id"] == wallet_a for t in walked)
    assert [t["id"] for t in walked] == [
        t["id"] for t in await _list_all(client, token, wallet_id=wallet_a)
    ]

    # Wallet + Category.
    only_food = await _list_all(
        client, token, wallet_id=wallet_a, category_id=food, limit=2
    )
    assert [t["date"] for t in only_food] == ["2026-08-07", "2026-08-06"]
    assert all(t["category_id"] == food for t in only_food)

    # Wallet + inclusive date range.
    ranged = await _list_all(
        client,
        token,
        wallet_id=wallet_a,
        from_date="2026-08-03",
        to_date="2026-08-05",
        limit=2,
    )
    assert [t["date"] for t in ranged] == ["2026-08-05", "2026-08-04", "2026-08-03"]


async def test_list_rejects_a_malformed_cursor(client: AsyncClient) -> None:
    """The cursor is opaque: anything that does not decode to exactly a
    timezone-aware (date, id) pair is a 422 — never guessed at."""
    token = await _login(client)
    bad_cursors = [
        "not-base64!",
        "####",
        base64.urlsafe_b64encode(b"not json").decode(),
        base64.urlsafe_b64encode(b"{}").decode(),
        base64.urlsafe_b64encode(b'{"d": 1, "i": 2}').decode(),
        base64.urlsafe_b64encode(b'{"d": "not-a-date", "i": 1}').decode(),
        base64.urlsafe_b64encode(b'{"d": "2026-08-06", "i": "x"}').decode(),
        base64.urlsafe_b64encode(b'{"d": "2026-08-06", "i": 1}').decode(),  # naive date
        base64.urlsafe_b64encode(b'{"d": "2026-08-06T00:00:00+00:00", "i": 1.5}').decode(),
        base64.urlsafe_b64encode(b'{"d": "2026-08-06T00:00:00+00:00", "i": true}').decode(),
    ]
    for cursor in bad_cursors:
        response = await client.get(
            "/transactions", params={"cursor": cursor}, headers=_auth(token)
        )
        assert response.status_code == 422, cursor


async def test_list_rejects_an_invalid_limit(client: AsyncClient) -> None:
    token = await _login(client)

    for limit in ("0", "-1", "101", "abc", "1.5"):
        response = await client.get(
            "/transactions", params={"limit": limit}, headers=_auth(token)
        )
        assert response.status_code == 422, limit


async def test_list_returns_a_well_formed_cursor_round_trip(
    client: AsyncClient,
) -> None:
    """A cursor issued by the server walks the next page: decoding is the
    inverse of encoding, through the HTTP seam."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Round Trip Wallet", "checking", "0.00")
    await _create_expense(client, token, wallet_id, "5.00", "2026-08-01")
    await _create_expense(client, token, wallet_id, "5.00", "2026-08-02")

    first = await _list_page(client, token, wallet_id=wallet_id, limit=1)
    assert [t["date"] for t in first["items"]] == ["2026-08-02"]
    second = await _list_page(
        client, token, wallet_id=wallet_id, limit=1, cursor=first["next_cursor"]
    )
    assert [t["date"] for t in second["items"]] == ["2026-08-01"]
    assert second["next_cursor"] is None
