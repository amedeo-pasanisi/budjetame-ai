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
    try:
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id,
                name="Stranger Wallet",
                type=WalletType.CASH.value,
            )
            session.add(wallet)
            session.commit()
            return account_id, wallet.id
    finally:
        engine.dispose()



    engine.dispose()
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

    engine.dispose()
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

    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))

    assert response.status_code == 200
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert all(w["id"] != wallet_id for w in listed)


async def test_freeze_is_rejected_while_balance_is_nonzero(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(
        client, token, "Not Zero", "checking", "100.00"
    )

    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))

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

    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))

    assert response.status_code == 200


async def test_frozen_wallet_cannot_be_renamed(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Frozen Name", "cash")
    frozen = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

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
        response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_freeze_missing_wallet_returns_403(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post("/wallets/999999/freeze", headers=_auth(token))

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

    frozen = await client.post(f"/wallets/{target_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

    after = {
        w["id"]: w["balance"]
        for w in (await client.get("/wallets", headers=_auth(token))).json()
    }
    assert target_id not in after
    assert after[other_id] == before[other_id]


async def test_list_wallets_can_include_frozen_wallets(client: AsyncClient) -> None:
    """T8's history screen must be able to reach a frozen Wallet's history, so
    `GET /wallets?include_frozen=true` returns frozen Wallets with `frozen:
    true`. The default list stays frozen-hidden (ADR-0002)."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Historic", "cash")
    active_id = await _create_wallet_via_api(client, token, "Still Active", "cash")
    frozen = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

    default = (await client.get("/wallets", headers=_auth(token))).json()
    assert all(w["id"] != wallet_id for w in default)

    included = (
        await client.get("/wallets?include_frozen=true", headers=_auth(token))
    ).json()
    historic = next(w for w in included if w["id"] == wallet_id)
    assert historic["frozen"] is True
    active = next(w for w in included if w["id"] == active_id)
    assert active["frozen"] is False
    assert all(w["balance"] is not None for w in included)


# --- Unfreeze (issue #48) ---


async def test_unfreeze_restores_a_frozen_wallet(client: AsyncClient) -> None:
    """Unfreezing puts a Frozen Wallet back into the active list, exactly as
    if it had never been frozen (issue #48)."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "To Unfreeze", "cash")
    frozen = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

    response = await client.post(f"/wallets/{wallet_id}/unfreeze", headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == wallet_id
    assert body["frozen"] is False
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert any(w["id"] == wallet_id for w in listed)


async def test_unfrozen_wallet_accepts_transactions_again(
    client: AsyncClient,
) -> None:
    """Full reversal: while frozen a write is rejected (ADR-0002), after
    unfreezing the Wallet accepts Transactions again (issue #48)."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Revived", "cash")
    frozen = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

    while_frozen = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "5.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    assert while_frozen.status_code == 422

    unfrozen = await client.post(f"/wallets/{wallet_id}/unfreeze", headers=_auth(token))
    assert unfrozen.status_code == 200

    after = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "5.00", "date": "2026-08-06", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    assert after.status_code == 201
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    revived = next(w for w in listed if w["id"] == wallet_id)
    assert revived["balance"] == "-5.00"


async def test_unfreeze_an_active_wallet_is_a_noop(client: AsyncClient) -> None:
    """Unfreeze mirrors freeze's idempotency: calling it on an active Wallet
    succeeds and changes nothing (issue #48)."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Never Frozen", "cash")

    response = await client.post(f"/wallets/{wallet_id}/unfreeze", headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["frozen"] is False
    listed = (await client.get("/wallets", headers=_auth(token))).json()
    assert any(w["id"] == wallet_id for w in listed)


async def test_unfreeze_foreign_wallet_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id, wallet_id = _insert_foreign_wallet(database_url)
    try:
        response = await client.post(f"/wallets/{wallet_id}/unfreeze", headers=_auth(token))
        assert response.status_code == 403
    finally:
        delete_account(database_url, account_id)


async def test_unfreeze_missing_wallet_returns_403(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post("/wallets/999999/unfreeze", headers=_auth(token))

    assert response.status_code == 403


# --- Delete (ADR-0034) ---


async def _freeze(client: AsyncClient, token: str, wallet_id: int) -> None:
    response = await client.post(f"/wallets/{wallet_id}/freeze", headers=_auth(token))
    assert response.status_code == 200
    assert response.json()["frozen"] is True


async def _listed_ids(client: AsyncClient, token: str) -> set[int]:
    included = await client.get("/wallets?include_frozen=true", headers=_auth(token))
    return {w["id"] for w in included.json()}


async def test_delete_a_frozen_wallet_with_no_history_returns_the_row_and_removes_it(
    client: AsyncClient,
) -> None:
    """A frozen Wallet no Transaction has ever touched can be deleted for good
    (ADR-0034): the response is the full row — the client's replay payload —
    and the Wallet is gone from the list, even with include_frozen."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Typo Walet", "cash")
    await _freeze(client, token, wallet_id)

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == wallet_id
    assert body["name"] == "Typo Walet"
    assert body["type"] == "cash"
    assert body["frozen"] is True
    assert body["balance"] == "0.00"
    assert wallet_id not in await _listed_ids(client, token)


async def test_delete_an_active_wallet_is_refused_with_freeze_first(
    client: AsyncClient,
) -> None:
    """Freeze remains the only action on an active Wallet (ADR-0034): the API
    enforces the same two-step path the UI shows."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Still Active Del", "cash")

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 422
    assert "freeze" in response.json()["detail"].lower()
    assert wallet_id in await _listed_ids(client, token)


async def _balances(client: AsyncClient, token: str) -> dict[int, str]:
    listed = await client.get("/wallets?include_frozen=true", headers=_auth(token))
    return {w["id"]: w["balance"] for w in listed.json()}


async def _post_transaction(client: AsyncClient, token: str, **payload: object) -> int:
    response = await client.post("/transactions", json=payload, headers=_auth(token))
    assert response.status_code == 201, response.json()
    return response.json()["id"]


async def test_delete_is_refused_when_the_only_transaction_is_the_opening_balance(
    client: AsyncClient,
) -> None:
    """An Opening Balance is history: a balance-bearing record never
    disappears with a Wallet (ADR-0034). The Wallet nets to EUR 0 through an
    Expense so it can be frozen, then carries two Transactions."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Opened", "cash", "20.00")
    await _post_transaction(
        client, token, type="expense", amount="20.00", date="2026-08-01", wallet_id=wallet_id
    )
    await _freeze(client, token, wallet_id)

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 422
    assert response.json()["detail"] == "This wallet has 2 transactions"
    assert wallet_id in await _listed_ids(client, token)


async def test_delete_is_refused_when_the_wallet_carries_an_expense(
    client: AsyncClient,
) -> None:
    """A Wallet with an Expense on it has history; an Income nets it to EUR 0
    so it can be frozen, and the refusal counts both."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Spent From", "cash")
    await _post_transaction(
        client, token, type="income", amount="5.00", date="2026-08-01", wallet_id=wallet_id
    )
    await _post_transaction(
        client, token, type="expense", amount="5.00", date="2026-08-02", wallet_id=wallet_id
    )
    await _freeze(client, token, wallet_id)

    response = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))

    assert response.status_code == 422
    assert response.json()["detail"] == "This wallet has 2 transactions"
    assert wallet_id in await _listed_ids(client, token)


async def test_delete_is_refused_when_the_wallet_is_a_transfer_leg(
    client: AsyncClient,
) -> None:
    """A Wallet that appears as either leg of a Transfer has history, so the
    other Wallet's Balance can never change because of a delete."""
    token = await _login(client)
    source_id = await _create_wallet_via_api(client, token, "Leg Source", "checking")
    destination_id = await _create_wallet_via_api(client, token, "Leg Dest", "cash")
    other_id = await _create_wallet_via_api(client, token, "Leg Funded", "checking", "40.00")
    # Each leg Wallet goes out and comes back, so both net to EUR 0 and freeze.
    await _post_transaction(
        client, token, type="transfer", amount="15.00", date="2026-08-01",
        source_wallet_id=other_id, destination_wallet_id=source_id,
    )
    await _post_transaction(
        client, token, type="transfer", amount="15.00", date="2026-08-02",
        source_wallet_id=source_id, destination_wallet_id=destination_id,
    )
    await _post_transaction(
        client, token, type="transfer", amount="15.00", date="2026-08-03",
        source_wallet_id=destination_id, destination_wallet_id=other_id,
    )
    await _freeze(client, token, source_id)
    await _freeze(client, token, destination_id)
    before = await _balances(client, token)

    as_source = await client.delete(f"/wallets/{source_id}", headers=_auth(token))
    as_destination = await client.delete(f"/wallets/{destination_id}", headers=_auth(token))

    assert as_source.status_code == 422
    assert as_source.json()["detail"] == "This wallet has 2 transactions"
    assert as_destination.status_code == 422
    assert as_destination.json()["detail"] == "This wallet has 2 transactions"
    assert await _balances(client, token) == before
    assert before[other_id] == "40.00"


async def test_a_frozen_contact_wallet_follows_the_same_rule(client: AsyncClient) -> None:
    """A Contact added by mistake can go; one that ever carried a Transfer
    stays frozen (ADR-0034): no special case."""
    token = await _login(client)
    mistake_id = await _create_wallet_via_api(client, token, "Mistaken Contact", "contact")
    lender_id = await _create_wallet_via_api(client, token, "Real Contact", "contact")
    bank_id = await _create_wallet_via_api(client, token, "Contact Bank", "checking", "10.00")
    await _post_transaction(
        client, token, type="transfer", amount="10.00", date="2026-08-01",
        source_wallet_id=bank_id, destination_wallet_id=lender_id,
    )
    await _post_transaction(
        client, token, type="transfer", amount="10.00", date="2026-08-02",
        source_wallet_id=lender_id, destination_wallet_id=bank_id,
    )
    await _freeze(client, token, mistake_id)
    await _freeze(client, token, lender_id)

    deleted = await client.delete(f"/wallets/{mistake_id}", headers=_auth(token))
    refused = await client.delete(f"/wallets/{lender_id}", headers=_auth(token))

    assert deleted.status_code == 200
    assert deleted.json()["type"] == "contact"
    assert refused.status_code == 422
    assert refused.json()["detail"] == "This wallet has 2 transactions"


async def test_delete_foreign_or_missing_wallet_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id, wallet_id = _insert_foreign_wallet(database_url)
    try:
        foreign = await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))
        assert foreign.status_code == 403
    finally:
        delete_account(database_url, account_id)
    missing = await client.delete("/wallets/999999", headers=_auth(token))
    assert missing.status_code == 403


# --- Undo a delete (ADR-0034, mirroring ADR-0031) ---


async def test_undo_re_inserts_the_same_wallet_still_frozen_and_the_next_create_does_not_collide(
    client: AsyncClient,
) -> None:
    """Undo is a true reversal: the very same Wallet comes back - same id,
    still frozen, in the Frozen list - and the sequence is re-synced so a
    later create never collides with the restored id."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Undo Me", "credit_card")
    await _freeze(client, token, wallet_id)
    deleted = (await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))).json()

    undo = await client.post("/wallets/undo", json=deleted, headers=_auth(token))

    assert undo.status_code == 201
    restored = undo.json()
    assert restored["id"] == wallet_id
    assert restored["name"] == "Undo Me"
    assert restored["type"] == "credit_card"
    assert restored["frozen"] is True
    assert restored["created_at"] == deleted["created_at"]
    default = (await client.get("/wallets", headers=_auth(token))).json()
    assert all(w["id"] != wallet_id for w in default)
    assert wallet_id in await _listed_ids(client, token)

    next_id = await _create_wallet_via_api(client, token, "After Undo", "cash")
    assert next_id != wallet_id
    assert next_id > wallet_id


async def test_undo_after_the_name_was_reused_is_refused_as_a_name_conflict(
    client: AsyncClient,
) -> None:
    """Fixing a typo is delete-then-recreate; an Undo after that fails with
    the name-conflict shape, never a silent rename (ADR-0034)."""
    token = await _login(client)
    wallet_id = await _create_wallet_via_api(client, token, "Reused Name", "cash")
    await _freeze(client, token, wallet_id)
    deleted = (await client.delete(f"/wallets/{wallet_id}", headers=_auth(token))).json()
    replacement = await _create_wallet_via_api(client, token, "reused name", "checking")

    undo = await client.post("/wallets/undo", json=deleted, headers=_auth(token))

    assert undo.status_code == 409
    assert "name" in undo.json()["detail"].lower()
    ids = await _listed_ids(client, token)
    assert wallet_id not in ids
    assert replacement in ids


async def test_undo_of_a_foreign_wallet_id_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    """A replay whose id is another Account's Wallet is refused as foreign:
    the Account on a re-inserted row is always the caller's, and an existing
    foreign id must stay indistinguishable from absent data (ADR-0003)."""
    token = await _login(client)
    account_id, wallet_id = _insert_foreign_wallet(database_url)
    try:
        undo = await client.post(
            "/wallets/undo",
            json={
                "id": wallet_id,
                "name": "Stranger Wallet",
                "type": "cash",
                "balance": "0.00",
                "frozen": True,
                "created_at": "2026-08-01T10:00:00Z",
            },
            headers=_auth(token),
        )
        assert undo.status_code == 403
    finally:
        delete_account(database_url, account_id)
