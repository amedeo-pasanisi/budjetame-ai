"""Linking an Expense — or a Transfer to a Contact Wallet — to a Recurring
Cost — issues #57, ADR-0027, through the HTTP seam.

An Expense may carry an optional Recurring Cost link that pins exactly one
Occurrence: the oldest Unpaid one at link time (future Occurrences included
when nothing earlier is Unpaid — paying ahead). The pin is stored, never
recomputed: later edits to the Transaction's date don't reassign it.
Unlinking or deleting the linked Expense frees the Occurrence; deleting the
Recurring Cost severs the link (the Expense survives as an ordinary one).
Income never carries the link; a Transfer carries it only when its
destination is a Contact Wallet and its source is not (ADR-0027: money out
to a tracked person). The recurring-costs list exposes the next Unpaid
Occurrence date per cost — what the form's picker shows.

Hand-worked expected dates use a far-future start date (2030-03-01, monthly),
so the Occurrence sequence is stable regardless of when the suite runs.
"""

from datetime import date

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
    client: AsyncClient, token: str, **overrides: object
) -> int:
    """A monthly Recurring Cost starting 2030-03-01; tests override what they
    exercise. The Occurrences are 2030-03-01, 2030-04-01, 2030-05-01, ..."""
    payload: dict[str, object] = {
        "name": "Rent",
        "amount": "850.00",
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
    cost_id = await _create_cost(client, token, name="Link Rent")

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
    cost_id = await _create_cost(client, token, name="Ahead Rent")

    # The Expense is dated before the first Occurrence (paying ahead): the
    # link still pays the oldest Unpaid Occurrence, 2030-03-01.
    body = await _create_linked_expense(
        client, token, wallet_id, cost_id, date="2029-02-15"
    )
    assert body["occurrence_date"] == "2030-03-01"


async def test_transaction_reads_expose_the_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Read Link Wallet")
    cost_id = await _create_cost(client, token, name="Read Link Rent")
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
    cost_id = await _create_cost(client, token, name="Pin Rent")
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
    cost_id = await _create_cost(client, token, name="Pin Fields Rent")
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
    cost_id = await _create_cost(client, token, name="Unlink Rent")
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
    cost_id = await _create_cost(client, token, name="Relink Rent")
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
    first_cost = await _create_cost(client, token, name="First")
    second_cost = await _create_cost(client, token, name="Second")
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
    cost_id = await _create_cost(client, token, name="Delete Link Rent")
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
    cost_id = await _create_cost(client, token, name="Sever Rent")
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


async def test_income_rejects_a_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Reject Link Wallet")
    cost_id = await _create_cost(client, token, name="Reject Link Rent")

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

    # A Transfer's link eligibility is the pair-and-direction rule
    # (ADR-0027), exercised in the Transfer-link tests below.


async def test_editing_rejects_a_link_on_income(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Reject Wallet")
    cost_id = await _create_cost(client, token, name="Edit Reject Rent")

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
                interval_value=1,
                interval_unit="months",
                start_date=date(2030, 1, 1),
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
    cost_id = await _create_cost(client, token, name="Picker Rent")

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
    cost_id = await _create_cost(client, token, name="Definition Edit Rent")
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


# --- Transfer-to-a-Contact links (ADR-0027) --------------------------------

async def _create_linked_transfer_to_contact(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    contact_id: int,
    cost_id: int,
    *,
    amount: str = "300.00",
    date: str = "2030-03-05",
) -> dict:
    """A Transfer own Wallet → Contact Wallet linked to `cost_id`
    (ADR-0027): money out to a tracked person pays the cost like a linked
    Expense does, asserting the create succeeded."""
    response = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": amount,
            "date": date,
            "source_wallet_id": wallet_id,
            "destination_wallet_id": contact_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def test_transfer_to_a_contact_pays_the_oldest_unpaid_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Pay Contact Wallet")
    contact_id = await _create_wallet(client, token, "Cost Chiara", "contact")
    cost_id = await _create_cost(client, token, name="Chiara Monthly Cost")

    # Each new linked Transfer pays the oldest Unpaid Occurrence: the
    # sequence is consumed in order, 2030-03-01, 2030-04-01, 2030-05-01.
    first = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )
    assert first["type"] == "transfer"
    assert first["recurring_cost_id"] == cost_id
    assert first["occurrence_date"] == "2030-03-01"
    second = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id, date="2030-04-05"
    )
    assert second["occurrence_date"] == "2030-04-01"
    third = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id, date="2030-05-05"
    )
    assert third["occurrence_date"] == "2030-05-01"


async def test_transfer_link_reads_and_next_unpaid_flow_without_special_casing(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Read Transfer Wallet")
    contact_id = await _create_wallet(client, token, "Read Transfer Contact", "contact")
    cost_id = await _create_cost(client, token, name="Read Transfer Rent")
    created = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )

    async def picker_date() -> str:
        costs = (await client.get("/recurring-costs", headers=_auth(token))).json()
        return next(
            cost["next_unpaid_occurrence_date"]
            for cost in costs
            if cost["id"] == cost_id
        )

    # The ledger row carries the pin like any linked Transaction...
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == created["id"])
    assert body["type"] == "transfer"
    assert body["recurring_cost_id"] == cost_id
    assert body["occurrence_date"] == "2030-03-01"

    # ...the definition's ledger filter/jump finds it (issue #86)...
    filtered = await client.get(
        "/transactions", params={"recurring_cost_id": cost_id}, headers=_auth(token)
    )
    assert [row["id"] for row in filtered.json()["items"]] == [created["id"]]

    # ...and the paid set advances: the picker's next Unpaid moves on.
    assert await picker_date() == "2030-04-01"


async def test_editing_the_transfer_date_does_not_reassign_the_pin(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Transfer Pin Wallet")
    contact_id = await _create_wallet(client, token, "Transfer Pin Contact", "contact")
    cost_id = await _create_cost(client, token, name="Transfer Pin Rent")
    first = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )

    # A later date edit keeps the pin: the Transfer still covers the
    # 2030-03-01 Occurrence, and a new link pays the next one.
    response = await client.patch(
        f"/transactions/{first['id']}",
        json={"date": "2030-06-10"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["occurrence_date"] == "2030-03-01"
    assert (
        await _create_linked_transfer_to_contact(
            client, token, wallet_id, contact_id, cost_id, date="2030-06-12"
        )
    )["occurrence_date"] == "2030-04-01"


async def test_unlinking_a_transfer_frees_the_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Transfer Unlink Wallet")
    contact_id = await _create_wallet(client, token, "Transfer Unlink Contact", "contact")
    cost_id = await _create_cost(client, token, name="Transfer Unlink Rent")
    first = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )
    await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )

    unlinked = await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_cost_id": None},
        headers=_auth(token),
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["recurring_cost_id"] is None
    assert unlinked.json()["occurrence_date"] is None

    # The freed Occurrence is the oldest Unpaid again: a new link pays it.
    assert (
        await _create_linked_transfer_to_contact(
            client, token, wallet_id, contact_id, cost_id
        )
    )["occurrence_date"] == "2030-03-01"


async def test_relinking_a_transfer_pays_the_freed_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Transfer Relink Wallet")
    contact_id = await _create_wallet(client, token, "Transfer Relink Contact", "contact")
    first_cost = await _create_cost(client, token, name="Transfer First")
    second_cost = await _create_cost(client, token, name="Transfer Second")
    linked = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, first_cost
    )
    assert linked["occurrence_date"] == "2030-03-01"

    # Moving the Transfer to the other cost pays the other cost's oldest
    # Unpaid Occurrence; the first cost's pin is freed.
    switched = await client.patch(
        f"/transactions/{linked['id']}",
        json={"recurring_cost_id": second_cost},
        headers=_auth(token),
    )
    assert switched.status_code == 200
    assert switched.json()["recurring_cost_id"] == second_cost
    assert switched.json()["occurrence_date"] == "2030-03-01"
    assert (
        await _create_linked_transfer_to_contact(
            client, token, wallet_id, contact_id, first_cost
        )
    )["occurrence_date"] == "2030-03-01"
    assert (
        await _create_linked_transfer_to_contact(
            client, token, wallet_id, contact_id, second_cost
        )
    )["occurrence_date"] == "2030-04-01"


async def test_deleting_a_linked_transfer_frees_the_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Transfer Delete Wallet")
    contact_id = await _create_wallet(client, token, "Transfer Delete Contact", "contact")
    cost_id = await _create_cost(client, token, name="Transfer Delete Rent")
    first = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )
    await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )

    response = await client.delete(
        f"/transactions/{first['id']}", headers=_auth(token)
    )
    assert response.status_code == 200

    assert (
        await _create_linked_transfer_to_contact(
            client, token, wallet_id, contact_id, cost_id
        )
    )["occurrence_date"] == "2030-03-01"


async def test_deleting_a_recurring_cost_severs_a_transfer_link(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Sever Transfer Wallet")
    contact_id = await _create_wallet(client, token, "Sever Transfer Contact", "contact")
    cost_id = await _create_cost(client, token, name="Sever Transfer Rent")
    linked = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )

    response = await client.delete(f"/recurring-costs/{cost_id}", headers=_auth(token))
    assert response.status_code == 204

    # The Transfer survives as an ordinary one: the link is severed.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == linked["id"])
    assert body["recurring_cost_id"] is None
    assert body["occurrence_date"] is None


async def test_a_skipped_occurrence_is_never_pinned_by_a_transfer_link(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Transfer Skip Wallet")
    contact_id = await _create_wallet(client, token, "Transfer Skip Contact", "contact")
    cost_id = await _create_cost(client, token, name="Transfer Skip Rent")

    # The user excuses 2030-03-01 (ADR-0016): the link walk steps over it.
    skipped = await client.put(
        f"/recurring-costs/{cost_id}/occurrences/2030-03-01",
        json={"skipped": True},
        headers=_auth(token),
    )
    assert skipped.status_code == 200

    # The linked Transfer pays the next Unpaid Occurrence instead — a
    # Skipped one is never paid; un-skipping comes first.
    linked = await _create_linked_transfer_to_contact(
        client, token, wallet_id, contact_id, cost_id
    )
    assert linked["occurrence_date"] == "2030-04-01"


async def test_transfer_cost_link_rules_reject_non_qualifying_pairs(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Rule Wallet")
    other_id = await _create_wallet(client, token, "Rule Other")
    contact_id = await _create_wallet(client, token, "Rule Contact", "contact")
    other_contact_id = await _create_wallet(
        client, token, "Rule Other Contact", "contact"
    )
    cost_id = await _create_cost(client, token, name="Rule Rent")

    # Own↔own, Contact↔Contact, and the wrong direction (money in from a
    # Contact Wallet would be a Recurring Income) never qualify (ADR-0027).
    for source_id, destination_id, message in (
        (wallet_id, other_id, "destination is a Contact Wallet"),
        (contact_id, other_contact_id, "between two Contact Wallets"),
        (contact_id, wallet_id, "destination is a Contact Wallet"),
    ):
        response = await client.post(
            "/transactions",
            json={
                "type": "transfer",
                "amount": "300.00",
                "date": "2030-03-05",
                "source_wallet_id": source_id,
                "destination_wallet_id": destination_id,
                "recurring_cost_id": cost_id,
            },
            headers=_auth(token),
        )
        assert response.status_code == 422, (source_id, destination_id)
        assert message in response.json()["detail"], response.json()["detail"]


async def test_editing_a_cost_link_onto_a_transfer_follows_the_pair_rule(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Edit Rule Wallet")
    other_id = await _create_wallet(client, token, "Edit Rule Other")
    contact_id = await _create_wallet(client, token, "Edit Rule Contact", "contact")
    cost_id = await _create_cost(client, token, name="Edit Rule Rent")

    # A plain Own↔own Transfer: setting the link is rejected with a rule
    # error naming the problem — never silently severed.
    plain = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "300.00",
            "date": "2030-03-05",
            "source_wallet_id": wallet_id,
            "destination_wallet_id": other_id,
        },
        headers=_auth(token),
    )
    assert plain.status_code == 201
    rejected = await client.patch(
        f"/transactions/{plain.json()['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert rejected.status_code == 422
    assert "destination is a Contact Wallet" in rejected.json()["detail"]

    # Unlinking in the same form succeeds: clearing an absent link is a
    # no-op, and the edit goes through.
    unlinked = await client.patch(
        f"/transactions/{plain.json()['id']}",
        json={"recurring_cost_id": None},
        headers=_auth(token),
    )
    assert unlinked.status_code == 200

    # The same rejection rides a money-in (Contact → own) Transfer: its
    # matching kind is a Recurring Income, not a Recurring Cost.
    incoming = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "300.00",
            "date": "2030-03-05",
            "source_wallet_id": contact_id,
            "destination_wallet_id": wallet_id,
        },
        headers=_auth(token),
    )
    assert incoming.status_code == 201
    wrong_direction = await client.patch(
        f"/transactions/{incoming.json()['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert wrong_direction.status_code == 422

    # And the matching edit lands: a plain Transfer to a Contact Wallet can
    # take the cost link on a later edit, pinning the oldest Unpaid
    # Occurrence at that moment.
    qualifying = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "300.00",
            "date": "2030-03-05",
            "source_wallet_id": wallet_id,
            "destination_wallet_id": contact_id,
        },
        headers=_auth(token),
    )
    assert qualifying.status_code == 201
    linked = await client.patch(
        f"/transactions/{qualifying.json()['id']}",
        json={"recurring_cost_id": cost_id},
        headers=_auth(token),
    )
    assert linked.status_code == 200
    assert linked.json()["occurrence_date"] == "2030-03-01"
