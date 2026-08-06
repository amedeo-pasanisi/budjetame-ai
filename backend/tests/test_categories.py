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
)

from conftest import (
    SEED_EMAIL,
    SEED_PASSWORD,
    delete_account,
    insert_foreign_account,
)


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_categories_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/categories")).status_code == 401
    assert (
        await client.post(
            "/categories",
            json={"name": "Food", "type": "expense", "color": "#ef4444"},
        )
    ).status_code == 401


async def test_create_category(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/categories",
        json={
            "name": "Groceries",
            "type": "expense",
            "icon": "🛒",
            "color": "#ef4444",
        },
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Groceries"
    assert body["type"] == "expense"
    assert body["icon"] == "🛒"
    assert body["color"] == "#ef4444"


async def test_create_category_icon_is_optional(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/categories",
        json={"name": "Bonus", "type": "income", "color": "#10b981"},
        headers=_auth(token),
    )

    assert response.status_code == 201
    assert response.json()["icon"] is None


async def test_list_categories(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/categories",
        json={"name": "Utilities", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    await client.post(
        "/categories",
        json={"name": "Gifts", "type": "income", "icon": "💼", "color": "#10b981"},
        headers=_auth(token),
    )

    response = await client.get("/categories", headers=_auth(token))

    assert response.status_code == 200
    categories = {c["name"]: c for c in response.json()}
    assert categories["Utilities"]["type"] == "expense"
    assert categories["Utilities"]["color"] == "#ef4444"
    assert categories["Gifts"]["type"] == "income"
    assert categories["Gifts"]["icon"] == "💼"


async def test_same_name_in_different_types_coexists(client: AsyncClient) -> None:
    token = await _login(client)
    first = await client.post(
        "/categories",
        json={"name": "Travel", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )

    second = await client.post(
        "/categories",
        json={"name": "Travel", "type": "income", "color": "#10b981"},
        headers=_auth(token),
    )

    assert first.status_code == 201
    assert second.status_code == 201


async def test_duplicate_name_in_same_type_conflicts_case_insensitively(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    await client.post(
        "/categories",
        json={"name": "Entertainment", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )

    response = await client.post(
        "/categories",
        json={"name": "entertainment", "type": "expense", "color": "#f97316"},
        headers=_auth(token),
    )

    assert response.status_code == 409


async def test_create_category_rejects_unknown_type(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/categories",
        json={"name": "Oddity", "type": "savings", "color": "#ef4444"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_create_category_rejects_bad_color(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/categories",
        json={"name": "Rainbow", "type": "expense", "color": "red"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_create_category_rejects_empty_name(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/categories",
        json={"name": "   ", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_edit_category(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Dining", "type": "expense", "icon": "🍝", "color": "#ef4444"},
        headers=_auth(token),
    )
    category_id = created.json()["id"]

    response = await client.patch(
        f"/categories/{category_id}",
        json={"name": "Restaurants", "color": "#f97316"},
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Restaurants"
    assert body["color"] == "#f97316"
    assert body["icon"] == "🍝"
    assert body["type"] == "expense"


async def test_edit_category_can_clear_the_icon(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Iconed", "type": "expense", "icon": "🍀", "color": "#10b981"},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/categories/{created.json()['id']}",
        json={"icon": ""},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["icon"] is None


async def test_edit_category_rejects_changing_the_type(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Stubborn", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    category_id = created.json()["id"]

    response = await client.patch(
        f"/categories/{category_id}",
        json={"name": "Stubborn", "type": "income"},
        headers=_auth(token),
    )

    assert response.status_code == 422
    listed = (await client.get("/categories", headers=_auth(token))).json()
    assert next(c for c in listed if c["id"] == category_id)["type"] == "expense"


async def test_edit_category_requires_a_change(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Lazy", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/categories/{created.json()['id']}", json={}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_edit_category_to_a_duplicate_name_conflicts(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/categories",
        json={"name": "Alpha", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    created = await client.post(
        "/categories",
        json={"name": "Beta", "type": "expense", "color": "#10b981"},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/categories/{created.json()['id']}",
        json={"name": "ALPHA"},
        headers=_auth(token),
    )

    assert response.status_code == 409


async def test_delete_category_removes_it(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Gone", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    category_id = created.json()["id"]

    response = await client.delete(f"/categories/{category_id}", headers=_auth(token))

    assert response.status_code == 204
    names = [c["name"] for c in (await client.get("/categories", headers=_auth(token))).json()]
    assert "Gone" not in names


async def test_delete_category_uncategorizes_its_transactions(
    client: AsyncClient, database_url: str
) -> None:
    """Deleting a Category nulls the Category on its Transactions; Transactions
    are never deleted (the FK is ON DELETE SET NULL)."""
    token = await _login(client)
    wallet = await client.post(
        "/wallets", json={"name": "Uncat Wallet", "type": "checking"}, headers=_auth(token)
    )
    category = await client.post(
        "/categories",
        json={"name": "Meals Out", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    wallet_id = wallet.json()["id"]
    category_id = category.json()["id"]
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        account_id = session.scalar(
            select(Account.id).where(Account.email == SEED_EMAIL)
        )
        transaction = Transaction(
            account_id=account_id,
            wallet_id=wallet_id,
            category_id=category_id,
            type=TransactionType.OPENING_BALANCE.value,
            amount="25.00",
        )
        session.add(transaction)
        session.commit()
        transaction_id = transaction.id

    response = await client.delete(f"/categories/{category_id}", headers=_auth(token))

    assert response.status_code == 204
    with Session(engine) as session:
        remaining = session.get(Transaction, transaction_id)
        assert remaining is not None
        assert remaining.category_id is None


async def test_foreign_category_returns_403(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "intruder@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            category = Category(
                account_id=account_id,
                name="Spy",
                type=CategoryType.EXPENSE.value,
                color="#000000",
            )
            session.add(category)
            session.commit()
            category_id = category.id

        patch = await client.patch(
            f"/categories/{category_id}",
            json={"name": "Hijacked"},
            headers=_auth(token),
        )
        delete = await client.delete(
            f"/categories/{category_id}", headers=_auth(token)
        )
        assert patch.status_code == 403
        assert delete.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_list_never_includes_foreign_categories(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "intruder@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            session.add(
                Category(
                    account_id=account_id,
                    name="Eavesdrop",
                    type=CategoryType.INCOME.value,
                    color="#000000",
                )
            )
            session.commit()

        response = await client.get("/categories", headers=_auth(token))
        assert response.status_code == 200
        names = [c["name"] for c in response.json()]
        assert "Eavesdrop" not in names
    finally:
        delete_account(database_url, account_id)
