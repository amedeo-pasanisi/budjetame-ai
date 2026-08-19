"""Linking an Expense to a Recurring Cost — issue #57, through the HTTP seam.

An Expense may carry an optional Recurring Cost link that pins exactly one
Occurrence: the oldest Unpaid one at link time (future Occurrences included
when nothing earlier is Unpaid — paying ahead). The pin is stored, never
recomputed: later edits to the Transaction's date don't reassign it.
Unlinking or deleting the linked Expense frees the Occurrence; deleting the
Recurring Cost severs the link (the Expense survives as an ordinary one).
Income and Transfer never carry the link. The recurring-costs list exposes
the next Unpaid Occurrence date per cost — what the form's picker shows.

Hand-worked expected dates use a far-future start date (2030-03-01, monthly),
so the Occurrence sequence is stable regardless of when the suite runs.
"""

from httpx import AsyncClient
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import RecurringCost, Wallet, WalletType

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


async def _create_wallet(
    client: AsyncClient, token: str, name: str, type: str = "checking"
) -> int:
    response = await client.post(
        "/wallets", json={"name": name, "type": type}, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_cost(
    client: AsyncClient, token: str, wallet_id: int, **overrides: object
) -> int:
    """A monthly Recurring Cost starting 2030-03-01; tests override what they
    exercise. The Occurrences are 2030-03-01, 2030-04-01, 2030-05-01, ..."""
    payload: dict[str, object] = {
        "name": "Rent",
        "amount": "850.00",
        "wallet_id": wallet_id,
        "interval_value": 1,
        "interval_unit": "months",
        "start_date": "2030-03-01",
    }
    payload.update(overrides)
    response = await client.post(
        "/recurring-costs", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_linked_expense(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    cost_id: int,
    *,
    amount: str = "10.00",
    date: str = "2030-02-15",
) -> dict:
    """An Expense linked to `cost_id`, asserting the create succeeded."""
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": amount,
            "date": date,
            "wallet_id": wallet_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def _linked_pay(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    cost_id: int,
) -> str:
    """The Occurrence a new linked Expense pays right now."""
    body = await _create_linked_expense(client, token, wallet_id, cost_id)
    assert body["occurrence_date"] is not None
    return body["occurrence_date"]


async def test_linked_expense_pays_the_oldest_unpaid_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Link Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Link Rent")

    # Each new link pays the oldest Unpaid Occurrence: the sequence is
    # consumed in order, 2030-03-01, 2030-04-01, 2030-05-01.
    first = await _create_linked_expense(client, token, wallet_id, cost_id)
    assert first["recurring_cost_id"] == cost_id
    assert first["occurrence_date"] == "2030-03-01"
    second = await _create_linked_expense(client, token, wallet_id, cost_id)
    assert second["occurrence_date"] == "2030-04-01"
    third = await _create_linked_expense(client, token, wallet_id, cost_id)
    assert third["occurrence_date"] == "2030-05-01"


async def test_link_pays_ahead_of_the_transaction_date(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Ahead Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Ahead Rent")

    # The Expense is dated before the first Occurrence (paying ahead): the
    # link still pays the oldest Unpaid Occurrence, 2030-03-01.
    body = await _create_linked_expense(
        client, token, wallet_id, cost_id, date="2029-02-15"
    )
    assert body["occurrence_date"] == "2030-03-01"


async def test_transaction_reads_expose_the_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Read Link Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Read Link Rent")
    created = await _create_linked_expense(client, token, wallet_id, cost_id)

    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == created["id"])
    assert body["recurring_cost_id"] == cost_id
    assert body["occurrence_date"] == "2030-03-01"


async def test_editing_the_date_does_not_reassign_the_pin(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Pin Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Pin Rent")
    first = await _create_linked_expense(client, token, wallet_id, cost_id)

    # A later date edit keeps the pin: the Transaction still covers the
    # 2030-03-01 Occurrence, and a new link pays the next one — the pin was
    # never freed or moved.
    response = await client.patch(
        f"/transactions/{first['id']}",
        json={"date": "2030-06-10"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["occurrence_date"] == "2030-03-01"
    assert await _linked_pay(client, token, wallet_id, cost_id) == "2030-04-01"


async def test_editing_other_fields_keeps_the_pin(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Pin Fields Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Pin Fields Rent")
    first = await _create_linked_expense(client, token, wallet_id, cost_id)

    response = await client.patch(
        f"/transactions/{first['id']}",
        json={"amount": "42.00", "description": "late rent"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["occurrence_date"] == "2030-03-01"
    assert response.json()["recurring_cost_id"] == cost_id


async def test_unlinking_frees_the_occurrence(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Unlink Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Unlink Rent")
    first = await _create_linked_expense(client, token, wallet_id, cost_id)
    await _create_linked_expense(client, token, wallet_id, cost_id)

    unlinked = await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_cost_id": None},
        headers=_auth(token),
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["recurring_cost_id"] is None
    assert unlinked.json()["occurrence_date"] is None

    # The freed Occurrence is the oldest Unpaid again: a new link pays it.
    assert await _linked_pay(client, token, wallet_id, cost_id) == "2030-03-01"


async def test_relinking_pays_the_freed_occurrence(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Relink Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Relink Rent")
    first = await _create_linked_expense(client, token, wallet_id, cost_id)
    second = await _create_linked_expense(client, token, wallet_id, cost_id)
    assert second["occurrence_date"] == "2030-04-01"

    await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_cost_id": None},
        headers=_auth(token),
    )
    relinked = await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert relinked.status_code == 200
    assert relinked.json()["occurrence_date"] == "2030-03-01"

    # Both pins are taken again: the next link pays the third Occurrence.
    assert await _linked_pay(client, token, wallet_id, cost_id) == "2030-05-01"


async def test_switching_cost_pays_the_new_costs_oldest_unpaid(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Switch Cost Wallet")
    first_cost = await _create_cost(client, token, wallet_id, name="First")
    second_cost = await _create_cost(client, token, wallet_id, name="Second")
    linked = await _create_linked_expense(client, token, wallet_id, first_cost)
    assert linked["occurrence_date"] == "2030-03-01"

    # Moving the Expense to the other cost pays the other cost's oldest
    # Unpaid Occurrence; the first cost's pin is freed.
    switched = await client.patch(
        f"/transactions/{linked['id']}",
        json={"recurring_cost_id": second_cost},
        headers=_auth(token),
    )
    assert switched.status_code == 200
    assert switched.json()["recurring_cost_id"] == second_cost
    assert switched.json()["occurrence_date"] == "2030-03-01"
    assert await _linked_pay(client, token, wallet_id, first_cost) == "2030-03-01"
    assert await _linked_pay(client, token, wallet_id, second_cost) == "2030-04-01"


async def test_deleting_a_linked_expense_frees_the_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Delete Link Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Delete Link Rent")
    first = await _create_linked_expense(client, token, wallet_id, cost_id)
    await _create_linked_expense(client, token, wallet_id, cost_id)

    response = await client.delete(
        f"/transactions/{first['id']}", headers=_auth(token)
    )
    assert response.status_code == 200

    assert await _linked_pay(client, token, wallet_id, cost_id) == "2030-03-01"


async def test_deleting_a_recurring_cost_severs_links(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Sever Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Sever Rent")
    linked = await _create_linked_expense(client, token, wallet_id, cost_id)

    response = await client.delete(f"/recurring-costs/{cost_id}", headers=_auth(token))
    assert response.status_code == 204

    # The Expense survives as an ordinary one: the link is severed.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == linked["id"])
    assert body["recurring_cost_id"] is None
    assert body["occurrence_date"] is None

    # The severed cost is gone: linking to it is indistinguishable from
    # linking to nothing (ADR-0003).
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2030-02-15",
            "wallet_id": wallet_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 403


async def test_income_and_transfer_reject_a_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Reject Link Wallet")
    contact_id = await _create_wallet(client, token, "Reject Link Contact", "contact")
    cost_id = await _create_cost(client, token, wallet_id, name="Reject Link Rent")

    income = await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": "10.00",
            "date": "2030-02-15",
            "wallet_id": wallet_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert income.status_code == 422

    transfer = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "10.00",
            "date": "2030-02-15",
            "source_wallet_id": wallet_id,
            "destination_wallet_id": contact_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert transfer.status_code == 422


async def test_editing_rejects_a_link_on_income_and_transfer(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Reject Wallet")
    contact_id = await _create_wallet(client, token, "Edit Reject Contact", "contact")
    cost_id = await _create_cost(client, token, wallet_id, name="Edit Reject Rent")

    income = await client.post(
        "/transactions",
        json={"type": "income", "amount": "10.00", "date": "2030-02-15", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    income_patch = await client.patch(
        f"/transactions/{income.json()['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert income_patch.status_code == 422

    transfer = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "10.00",
            "date": "2030-02-15",
            "source_wallet_id": wallet_id,
            "destination_wallet_id": contact_id,
        },
        headers=_auth(token),
    )
    transfer_patch = await client.patch(
        f"/transactions/{transfer.json()['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert transfer_patch.status_code == 422


async def test_foreign_or_missing_cost_link_is_rejected(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Foreign Link Wallet")
    account_id = insert_foreign_account(database_url, "interloper@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            foreign_wallet = Wallet(
                account_id=account_id,
                name="Foreign Cost Wallet",
                type=WalletType.CHECKING.value,
            )
            session.add(foreign_wallet)
            session.flush()
            cost = RecurringCost(
                account_id=account_id,
                name="Foreign Cost",
                amount="10.00",
                wallet_id=foreign_wallet.id,
                interval_value=1,
                interval_unit="months",
                start_date=None,
                due_day=None,
                due_month=None,
            )
            session.add(cost)
            session.commit()
            foreign_cost_id = cost.id
        engine.dispose()

        for cost_id in (foreign_cost_id, 999999):
            response = await client.post(
                "/transactions",
                json={
                    "type": "expense",
                    "amount": "10.00",
                    "date": "2030-02-15",
                    "wallet_id": wallet_id,
                    "recurring_cost_id": cost_id,
                },
                headers=_auth(token),
            )
            assert response.status_code == 403, cost_id
    finally:
        delete_account(database_url, account_id)


async def test_recurring_costs_list_exposes_the_next_unpaid_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Picker Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Picker Rent")

    async def picker_date() -> str:
        costs = (await client.get("/recurring-costs", headers=_auth(token))).json()
        return next(cost["next_unpaid_occurrence_date"] for cost in costs if cost["id"] == cost_id)

    # What the form's picker shows: the oldest Unpaid Occurrence's date.
    assert await picker_date() == "2030-03-01"
    await _create_linked_expense(client, token, wallet_id, cost_id)
    assert await picker_date() == "2030-04-01"
    await _create_linked_expense(client, token, wallet_id, cost_id)
    assert await picker_date() == "2030-05-01"


async def test_the_pin_survives_cost_definition_edits(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Definition Edit Wallet")
    cost_id = await _create_cost(client, token, wallet_id, name="Definition Edit Rent")
    linked = await _create_linked_expense(client, token, wallet_id, cost_id)

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": "2030-06-01"},
        headers=_auth(token),
    )
    assert response.status_code == 200

    # The stored pin is untouched by the definition edit: the Transaction
    # still covers the Occurrence it paid at link time.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == linked["id"])
    assert body["recurring_cost_id"] == cost_id
    assert body["occurrence_date"] == "2030-03-01"
