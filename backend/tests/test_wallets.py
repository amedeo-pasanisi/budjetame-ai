from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import Account, Transaction, TransactionType, Wallet, WalletType

from conftest import SEED_EMAIL, SEED_PASSWORD, delete_account, insert_foreign_account


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _insert_foreign_wallet(database_url: str) -> tuple[int, int]:
    """Fixture: a second Account owning a Wallet, for ADR-0003 scoping tests."""
    account_id = insert_foreign_account(database_url, "stranger@budjetame.dev")
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        wallet = Wallet(
            account_id=account_id,
            name="Stranger Wallet",
            type=WalletType.CASH.value,
        )
        session.add(wallet)
        session.commit()
        return account_id, wallet.id



async def test_wallets_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/wallets")).status_code == 401
    assert (
        await client.post("/wallets", json={"name": "Cash", "type": "cash"})
    ).status_code == 401


async def test_create_wallet_defaults_to_zero_balance(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/wallets", json={"name": "Pocket", "type": "cash"}, headers=_auth(token)
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Pocket"
    assert body["type"] == "cash"
    assert body["balance"] == "0.00"


async def test_create_wallet_records_opening_balance_transaction(
    client: AsyncClient,
) -> None:
    token = await _login(client)

    response = await client.post(
        "/wallets",
        json={"name": "Intesa", "type": "checking", "opening_balance": "1000.00"},
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["balance"] == "1000.00"


async def test_list_wallets_returns_balances(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/wallets",
        json={"name": "Credit", "type": "credit_card", "opening_balance": "250.50"},
        headers=_auth(token),
    )
    await client.post(
        "/wallets", json={"name": "Spare Cash", "type": "cash"}, headers=_auth(token)
    )

    response = await client.get("/wallets", headers=_auth(token))

    assert response.status_code == 200
    wallets = {w["name"]: w for w in response.json()}
    assert wallets["Credit"]["type"] == "credit_card"
    assert wallets["Credit"]["balance"] == "250.50"
    assert wallets["Spare Cash"]["balance"] == "0.00"


async def test_create_wallet_rejects_negative_opening_balance(
    client: AsyncClient,
) -> None:
    token = await _login(client)

    response = await client.post(
        "/wallets",
        json={"name": "Negative", "type": "cash", "opening_balance": "-1.00"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_create_wallet_rejects_unknown_type(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/wallets", json={"name": "Savings", "type": "savings"}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_create_wallet_rejects_empty_name(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/wallets", json={"name": "  ", "type": "cash"}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_contact_wallet_rejects_a_nonzero_opening_balance(
    client: AsyncClient,
) -> None:
    """Money moves in and out of Contact Wallets only via Transfers, so they
    must start at €0 (CONTEXT.md) — an Opening Balance would bypass that."""
    token = await _login(client)

    response = await client.post(
        "/wallets",
        json={"name": "Iou Contact", "type": "contact", "opening_balance": "50.00"},
        headers=_auth(token),
    )

    assert response.status_code == 422
    zero = await client.post(
        "/wallets", json={"name": "Iou Contact", "type": "contact"}, headers=_auth(token)
    )
    assert zero.status_code == 201
    assert zero.json()["balance"] == "0.00"


async def test_wallet_names_are_unique_case_insensitively(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/wallets", json={"name": "Everyday", "type": "checking"}, headers=_auth(token)
    )

    response = await client.post(
        "/wallets", json={"name": "everyday", "type": "cash"}, headers=_auth(token)
    )

    assert response.status_code == 409


async def test_rename_wallet_updates_name_keeps_type(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/wallets", json={"name": "Old Name", "type": "cash"}, headers=_auth(token)
    )
    wallet_id = created.json()["id"]

    response = await client.patch(
        f"/wallets/{wallet_id}", json={"name": "New Name"}, headers=_auth(token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "New Name"
    assert body["type"] == "cash"
    assert body["balance"] == "0.00"


async def test_rename_rejects_changing_the_type(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/wallets", json={"name": "Stubborn", "type": "cash"}, headers=_auth(token)
    )
    wallet_id = created.json()["id"]

    response = await client.patch(
        f"/wallets/{wallet_id}",
        json={"name": "Stubborn", "type": "credit_card"},
        headers=_auth(token),
    )

    assert response.status_code == 422
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert next(w for w in listed if w["id"] == wallet_id)["type"] == "cash"


async def test_rename_to_a_duplicate_name_conflicts(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/wallets", json={"name": "Taken", "type": "checking"}, headers=_auth(token)
    )
    created = await client.post(
        "/wallets", json={"name": "Mine", "type": "cash"}, headers=_auth(token)
    )

    response = await client.patch(
        f"/wallets/{created.json()['id']}", json={"name": "TAKEN"}, headers=_auth(token)
    )

    assert response.status_code == 409


async def test_foreign_wallet_returns_403(client: AsyncClient, database_url: str) -> None:
    token = await _login(client)
    account_id, wallet_id = _insert_foreign_wallet(database_url)
    try:
        response = await client.patch(
            f"/wallets/{wallet_id}", json={"name": "Hijacked"}, headers=_auth(token)
        )
        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_missing_wallet_returns_403(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.patch(
        "/wallets/999999", json={"name": "Ghost"}, headers=_auth(token)
    )

    assert response.status_code == 403


async def test_list_never_includes_foreign_wallets(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id, _ = _insert_foreign_wallet(database_url)
    try:
        response = await client.get("/wallets", headers=_auth(token))
        assert response.status_code == 200
        names = [w["name"] for w in response.json()]
        assert "Stranger Wallet" not in names
    finally:
        delete_account(database_url, account_id)


async def test_balance_is_derived_from_transactions(client: AsyncClient, database_url: str) -> None:
    """Balance is computed at read time (ADR-0001): a Transaction inserted outside
    the API is already reflected in the next read."""
    token = await _login(client)
    created = await client.post(
        "/wallets",
        json={"name": "Derived", "type": "checking", "opening_balance": "50.00"},
        headers=_auth(token),
    )
    wallet_id = created.json()["id"]
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        account_id = session.scalar(
            select(Account.id).where(Account.email == SEED_EMAIL)
        )
        session.add(
            Transaction(
                account_id=account_id,
                wallet_id=wallet_id,
                type=TransactionType.OPENING_BALANCE.value,
                amount="75.50",
            )
        )
        session.commit()

    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert next(w for w in listed if w["id"] == wallet_id)["balance"] == "125.50"


# --- T6: Wallet freeze (ADR-0002) ---


async def _create_wallet_via_api(
    client: AsyncClient,
    token: str,
    name: str,
    type: str,
    opening_balance: str = "0.00",
) -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": opening_balance},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_freeze_at_zero_balance_succeeds_and_hides_the_wallet(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "To Freeze", "cash")

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 204
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert all(w["id"] != wallet_id for w in listed)


async def test_freeze_is_rejected_while_balance_is_nonzero(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(
        client, token, "Not Zero", "checking", "100.00"
    )

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 422
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert any(w["id"] == wallet_id for w in listed)


async def test_freeze_is_allowed_when_transactions_net_to_zero(
    client: AsyncClient,
) -> None:
    """A Wallet whose Transactions sum to exactly €0 (here: opening 100,
    expense 100) can be frozen even though it has history."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(
        client, token, "Net Zero", "checking", "100.00"
    )
    expense = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "100.00",
            "date": "2026-08-06",
            "wallet_id": wallet_id,
        },
        headers=_auth(token),
    )
    assert expense.status_code == 201

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 204


async def test_frozen_wallet_cannot_be_renamed(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Frozen Name", "cash")
    frozen = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))
    assert frozen.status_code == 204

    response = await client.patch(
        f"/wallets/{wallet_id}", json={"name": "Renamed"}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_freeze_foreign_wallet_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id, wallet_id = _insert_foreign_wallet(database_url)
    try:
        response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))
        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_freeze_missing_wallet_returns_403(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.delete("/wallets/999999", headers=_auth(token))

    assert response.status_code == 403


async def test_freezing_does_not_change_other_wallet_balances(
    client: AsyncClient,
) -> None:
    """Net Worth is the sum of all Wallet balances; a frozen Wallet contributes
    €0, so freezing must leave every other balance untouched (ADR-0002)."""
    token = await _login(client)
    other_id = await _create_wallet_via_api(
        client, token, "Net Worth Other", "checking", "50.00"
    )
    target_id = await _create_wallet_via_api(client, token, "Net Worth Target", "cash")
    before = {
        w["id"]: w["balance"]
        for w in (await client.get("/wallets", headers=_auth(token))).json()
    }

    frozen = await client.delete(f"/wallets/{target_id}", headers=_auth(token))
    assert frozen.status_code == 204

    after = {
        w["id"]: w["balance"]
        for w in (await client.get("/wallets", headers=_auth(token))).json()
    }
    assert target_id not in after
    assert after[other_id] == before[other_id]
