from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import Account, Transaction, TransactionType, Wallet, WalletType
from app.security import hash_password

from conftest import SEED_EMAIL, SEED_PASSWORD


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
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        account = Account(
            email="stranger@budjetame.dev", password_hash=hash_password("whatever")
        )
        session.add(account)
        session.flush()
        wallet = Wallet(
            account_id=account.id,
            name="Stranger Wallet",
            type=WalletType.CASH.value,
        )
        session.add(wallet)
        session.flush()
        account_id, wallet_id = account.id, wallet.id
        session.commit()
    return account_id, wallet_id


def _delete_account(database_url: str, account_id: int) -> None:
    """Tear down the foreign fixture; wallets cascade (ondelete=CASCADE)."""
    engine = create_db_engine(database_url)
    with Session(engine) as session:
        session.delete(session.get(Account, account_id))
        session.commit()


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
        _delete_account(database_url, account_id)


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
        _delete_account(database_url, account_id)


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
