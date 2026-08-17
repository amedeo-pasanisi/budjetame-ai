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


async def _create_wallet(client: AsyncClient, token: str, name: str) -> int:
    response = await client.post(
        "/wallets", json={"name": name, "type": "checking"}, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_expense(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    category_id: int,
    amount: str = "10.00",
) -> int:
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": amount,
            "date": "2026-08-06",
            "wallet_id": wallet_id,
            "category_id": category_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


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


async def test_rename_to_an_existing_name_returns_the_merge_conflict(
    client: AsyncClient,
) -> None:
    """A colliding rename offers a merge (ADR-0007) instead of a bare error:
    the 409 carries the existing Category's id and the count of Transactions on
    the renamed Category — the number the merge would move, not the target's."""
    token = await _login(client)
    target = await client.post(
        "/categories",
        json={"name": "Conflict Target", "type": "expense", "icon": "🛒", "color": "#ef4444"},
        headers=_auth(token),
    )
    source = await client.post(
        "/categories",
        json={"name": "Conflict Source", "type": "expense", "icon": "🍔", "color": "#10b981"},
        headers=_auth(token),
    )
    target_id = target.json()["id"]
    source_id = source.json()["id"]
    wallet_id = await _create_wallet(client, token, "Conflict Wallet")
    await _create_expense(client, token, wallet_id, target_id, "5.00")
    await _create_expense(client, token, wallet_id, source_id, "3.00")
    await _create_expense(client, token, wallet_id, source_id, "4.00")

    response = await client.patch(
        f"/categories/{source_id}",
        json={"name": "conflict target"},
        headers=_auth(token),
    )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["target_id"] == target_id
    assert detail["transaction_count"] == 2


async def test_rename_conflict_writes_nothing(client: AsyncClient) -> None:
    """The rename that collides is not applied: neither the name nor the
    icon/color edits of the same submission reach the database (the frontend
    confirms the merge before anything moves)."""
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
    source_id = created.json()["id"]

    response = await client.patch(
        f"/categories/{source_id}",
        json={"name": "ALPHA", "color": "#6366f1"},
        headers=_auth(token),
    )

    assert response.status_code == 409
    listed = {c["id"]: c for c in (await client.get("/categories", headers=_auth(token))).json()}
    assert listed[source_id]["name"] == "Beta"
    assert listed[source_id]["color"] == "#10b981"


async def test_rename_to_a_name_taken_only_in_the_other_type_is_a_plain_rename(
    client: AsyncClient,
) -> None:
    """Names are unique per Type: renaming to a name that exists only under
    the other Type is not a collision (ADR-0007)."""
    token = await _login(client)
    await client.post(
        "/categories",
        json={"name": "Food", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    created = await client.post(
        "/categories",
        json={"name": "Other Type Bonus", "type": "income", "color": "#10b981"},
        headers=_auth(token),
    )

    response = await client.patch(
        f"/categories/{created.json()['id']}",
        json={"name": "Food"},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Food"
    assert response.json()["type"] == "income"


async def test_rename_to_its_own_name_is_a_plain_rename(client: AsyncClient) -> None:
    """Renaming to the Category's own name (case changes included) never
    collides with itself (ADR-0007)."""
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Self Groceries", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    category_id = created.json()["id"]

    response = await client.patch(
        f"/categories/{category_id}",
        json={"name": "SELF GROCERIES"},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["id"] == category_id
    assert response.json()["name"] == "SELF GROCERIES"


async def test_merge_moves_transactions_and_deletes_the_renamed_category(
    client: AsyncClient,
) -> None:
    """The confirmed merge (ADR-0007): the existing Category survives with its
    name, icon, and color; every Transaction of the renamed Category moves to
    it (its own stay); the renamed Category is deleted."""
    token = await _login(client)
    target = await client.post(
        "/categories",
        json={"name": "Merge Target", "type": "expense", "icon": "🛒", "color": "#ef4444"},
        headers=_auth(token),
    )
    source = await client.post(
        "/categories",
        json={"name": "Merge Source", "type": "expense", "icon": "🍔", "color": "#10b981"},
        headers=_auth(token),
    )
    target_id = target.json()["id"]
    source_id = source.json()["id"]
    wallet_id = await _create_wallet(client, token, "Merge Wallet")
    target_tx = await _create_expense(client, token, wallet_id, target_id, "5.00")
    source_tx_1 = await _create_expense(client, token, wallet_id, source_id, "3.00")
    source_tx_2 = await _create_expense(client, token, wallet_id, source_id, "4.00")

    response = await client.post(
        f"/categories/{source_id}/merge",
        json={"target_id": target_id},
        headers=_auth(token),
    )

    assert response.status_code == 200
    surviving = response.json()
    assert surviving["id"] == target_id
    assert surviving["name"] == "Merge Target"
    assert surviving["icon"] == "🛒"
    assert surviving["color"] == "#ef4444"
    assert surviving["type"] == "expense"
    listed = [c["id"] for c in (await client.get("/categories", headers=_auth(token))).json()]
    assert target_id in listed
    assert source_id not in listed
    page = (await client.get("/transactions", headers=_auth(token))).json()
    moved = {t["id"]: t["category_id"] for t in page["items"]}
    assert moved[target_tx] == target_id
    assert moved[source_tx_1] == target_id
    assert moved[source_tx_2] == target_id


async def test_merge_of_a_category_without_transactions_still_merges(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    target = await client.post(
        "/categories",
        json={"name": "Target", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    source = await client.post(
        "/categories",
        json={"name": "Empty", "type": "expense", "color": "#10b981"},
        headers=_auth(token),
    )
    target_id = target.json()["id"]
    source_id = source.json()["id"]

    response = await client.post(
        f"/categories/{source_id}/merge",
        json={"target_id": target_id},
        headers=_auth(token),
    )

    assert response.status_code == 200
    assert response.json()["id"] == target_id
    listed = [c["id"] for c in (await client.get("/categories", headers=_auth(token))).json()]
    assert target_id in listed
    assert source_id not in listed


async def test_merge_rejects_a_target_of_the_other_type(client: AsyncClient) -> None:
    """A merge never crosses Types (ADR-0007); a rejected merge changes
    nothing."""
    token = await _login(client)
    expense = await client.post(
        "/categories",
        json={"name": "Cross Dining", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    income = await client.post(
        "/categories",
        json={"name": "Cross Salary", "type": "income", "color": "#10b981"},
        headers=_auth(token),
    )
    expense_id = expense.json()["id"]
    income_id = income.json()["id"]
    wallet_id = await _create_wallet(client, token, "Cross Type Wallet")
    tx_id = await _create_expense(client, token, wallet_id, expense_id, "7.00")

    response = await client.post(
        f"/categories/{expense_id}/merge",
        json={"target_id": income_id},
        headers=_auth(token),
    )

    assert response.status_code == 422
    listed = [c["id"] for c in (await client.get("/categories", headers=_auth(token))).json()]
    assert expense_id in listed
    assert income_id in listed
    page = (await client.get("/transactions", headers=_auth(token))).json()
    assert {t["id"]: t["category_id"] for t in page["items"]}[tx_id] == expense_id


async def test_merge_rejects_merging_a_category_into_itself(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Self", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    category_id = created.json()["id"]

    response = await client.post(
        f"/categories/{category_id}/merge",
        json={"target_id": category_id},
        headers=_auth(token),
    )

    assert response.status_code == 422
    listed = [c["id"] for c in (await client.get("/categories", headers=_auth(token))).json()]
    assert category_id in listed


async def test_merge_requires_an_owned_target(
    client: AsyncClient, database_url: str
) -> None:
    """The merge target must belong to the Account: a foreign one is
    indistinguishable from an absent one (ADR-0003)."""
    token = await _login(client)
    created = await client.post(
        "/categories",
        json={"name": "Mine", "type": "expense", "color": "#ef4444"},
        headers=_auth(token),
    )
    account_id = insert_foreign_account(database_url, "merger@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            target = Category(
                account_id=account_id,
                name="Theirs",
                type=CategoryType.EXPENSE.value,
                color="#000000",
            )
            session.add(target)
            session.commit()
            target_id = target.id

        engine.dispose()
        response = await client.post(
            f"/categories/{created.json()['id']}/merge",
            json={"target_id": target_id},
            headers=_auth(token),
        )
        assert response.status_code == 403
        listed = [c["id"] for c in (await client.get("/categories", headers=_auth(token))).json()]
        assert created.json()["id"] in listed
    finally:
        delete_account(database_url, account_id)


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

    engine.dispose()
    response = await client.delete(f"/categories/{category_id}", headers=_auth(token))

    assert response.status_code == 204
    # The Transaction survives the Category delete, uncategorized — asserted
    # through the API seam: it is still listed, with category_id null.
    listing = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    rows = [t for t in listing if t["id"] == transaction_id]
    assert len(rows) == 1
    assert rows[0]["category_id"] is None


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

        engine.dispose()
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

        engine.dispose()
        response = await client.get("/categories", headers=_auth(token))
        assert response.status_code == 200
        names = [c["name"] for c in response.json()]
        assert "Eavesdrop" not in names
    finally:
        delete_account(database_url, account_id)
