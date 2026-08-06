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

    assert response.status_code == 204
    assert await _wallet_balance(client, token, wallet_id) == "100.00"


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

    all_transactions = (await client.get("/transactions", headers=_auth(token))).json()
    assert len(all_transactions) >= 3

    only_a = (
        await client.get(f"/transactions?wallet_id={wallet_a}", headers=_auth(token))
    ).json()
    assert [t["date"] for t in only_a] == ["2026-08-06", "2026-08-01"]
    assert all(t["wallet_id"] == wallet_a for t in only_a)

    only_b = (
        await client.get(f"/transactions?wallet_id={wallet_b}", headers=_auth(token))
    ).json()
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
    transactions = (await client.get("/transactions", headers=_auth(token))).json()
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

