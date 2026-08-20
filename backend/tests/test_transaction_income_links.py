"""Linking an Income to a Recurring Income — issue #61, through the HTTP seam.

The mirror of the Recurring Cost link (issue #57, ADR-0011): an Income may
carry an optional Recurring Income link that pins exactly one Occurrence —
the oldest Unpaid one at link time (future Occurrences included when nothing
earlier is Unpaid — receiving ahead). The pin is stored, never recomputed:
later edits to the Transaction's date don't reassign it. Unlinking or
deleting the linked Income frees the Occurrence; deleting the Recurring
Income severs the link (the Income survives as an ordinary one). Expense and
Transfer never carry the link; a Transaction is one type, so at most one
link per Transaction. The recurring-incomes list exposes the next Unpaid
Occurrence date per income — what the form's picker shows.

Hand-worked expected dates use a far-future start date (2030-03-01, monthly),
so the Occurrence sequence is stable regardless of when the suite runs.
"""

from httpx import AsyncClient
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import RecurringIncome, Wallet, WalletType

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


async def _create_income(
    client: AsyncClient, token: str, **overrides: object
) -> int:
    """A monthly Recurring Income starting 2030-03-01; tests override what
    they exercise. The Occurrences are 2030-03-01, 2030-04-01, 2030-05-01,
    ..."""
    payload: dict[str, object] = {
        "name": "Salary",
        "amount": "2100.00",
        "interval_value": 1,
        "interval_unit": "months",
        "start_date": "2030-03-01",
    }
    payload.update(overrides)
    response = await client.post(
        "/recurring-incomes", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_linked_income(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    income_id: int,
    *,
    amount: str = "10.00",
    date: str = "2030-02-15",
) -> dict:
    """An Income linked to `income_id`, asserting the create succeeded."""
    response = await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": amount,
            "date": date,
            "wallet_id": wallet_id,
            "recurring_income_id": income_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()


async def _linked_pay(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    income_id: int,
) -> str:
    """The Occurrence a new linked Income pays right now."""
    body = await _create_linked_income(client, token, wallet_id, income_id)
    assert body["occurrence_date"] is not None
    return body["occurrence_date"]


async def test_linked_income_pays_the_oldest_unpaid_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Link Wallet")
    income_id = await _create_income(client, token, name="Inc Link Salary")

    # Each new link pays the oldest Unpaid Occurrence: the sequence is
    # consumed in order, 2030-03-01, 2030-04-01, 2030-05-01.
    first = await _create_linked_income(client, token, wallet_id, income_id)
    assert first["recurring_income_id"] == income_id
    assert first["occurrence_date"] == "2030-03-01"
    second = await _create_linked_income(client, token, wallet_id, income_id)
    assert second["occurrence_date"] == "2030-04-01"
    third = await _create_linked_income(client, token, wallet_id, income_id)
    assert third["occurrence_date"] == "2030-05-01"


async def test_link_receives_ahead_of_the_transaction_date(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Ahead Wallet")
    income_id = await _create_income(client, token, name="Inc Ahead Salary")

    # The Income is dated before the first Occurrence (receiving early): the
    # link still pays the oldest Unpaid Occurrence, 2030-03-01.
    body = await _create_linked_income(
        client, token, wallet_id, income_id, date="2029-02-15"
    )
    assert body["occurrence_date"] == "2030-03-01"


async def test_transaction_reads_expose_the_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Read Link Wallet")
    income_id = await _create_income(client, token, name="Inc Read Salary")
    created = await _create_linked_income(client, token, wallet_id, income_id)

    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == created["id"])
    assert body["recurring_income_id"] == income_id
    assert body["occurrence_date"] == "2030-03-01"


async def test_editing_the_date_does_not_reassign_the_pin(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Pin Wallet")
    income_id = await _create_income(client, token, name="Inc Pin Salary")
    first = await _create_linked_income(client, token, wallet_id, income_id)

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
    assert await _linked_pay(client, token, wallet_id, income_id) == "2030-04-01"


async def test_editing_other_fields_keeps_the_pin(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Pin Fields Wallet")
    income_id = await _create_income(client, token, name="Inc Pin Fields")
    first = await _create_linked_income(client, token, wallet_id, income_id)

    response = await client.patch(
        f"/transactions/{first['id']}",
        json={"amount": "42.00", "description": "late salary"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    assert response.json()["occurrence_date"] == "2030-03-01"
    assert response.json()["recurring_income_id"] == income_id


async def test_unlinking_frees_the_occurrence(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Unlink Wallet")
    income_id = await _create_income(client, token, name="Inc Unlink Salary")
    first = await _create_linked_income(client, token, wallet_id, income_id)
    await _create_linked_income(client, token, wallet_id, income_id)

    unlinked = await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_income_id": None},
        headers=_auth(token),
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["recurring_income_id"] is None
    assert unlinked.json()["occurrence_date"] is None

    # The freed Occurrence is the oldest Unpaid again: a new link pays it.
    assert await _linked_pay(client, token, wallet_id, income_id) == "2030-03-01"


async def test_relinking_pays_the_freed_occurrence(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Relink Wallet")
    income_id = await _create_income(client, token, name="Inc Relink Salary")
    first = await _create_linked_income(client, token, wallet_id, income_id)
    second = await _create_linked_income(client, token, wallet_id, income_id)
    assert second["occurrence_date"] == "2030-04-01"

    await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_income_id": None},
        headers=_auth(token),
    )
    relinked = await client.patch(
        f"/transactions/{first['id']}",
        json={"recurring_income_id": income_id},
        headers=_auth(token),
    )
    assert relinked.status_code == 200
    assert relinked.json()["occurrence_date"] == "2030-03-01"

    # Both pins are taken again: the next link pays the third Occurrence.
    assert await _linked_pay(client, token, wallet_id, income_id) == "2030-05-01"


async def test_switching_income_pays_the_new_incomes_oldest_unpaid(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Switch Wallet")
    first_income = await _create_income(client, token, name="Inc First")
    second_income = await _create_income(client, token, name="Inc Second")
    linked = await _create_linked_income(client, token, wallet_id, first_income)
    assert linked["occurrence_date"] == "2030-03-01"

    # Moving the Income to the other definition pays the other one's oldest
    # Unpaid Occurrence; the first one's pin is freed.
    switched = await client.patch(
        f"/transactions/{linked['id']}",
        json={"recurring_income_id": second_income},
        headers=_auth(token),
    )
    assert switched.status_code == 200
    assert switched.json()["recurring_income_id"] == second_income
    assert switched.json()["occurrence_date"] == "2030-03-01"
    assert await _linked_pay(client, token, wallet_id, first_income) == "2030-03-01"
    assert await _linked_pay(client, token, wallet_id, second_income) == "2030-04-01"


async def test_deleting_a_linked_income_frees_the_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Delete Link Wallet")
    income_id = await _create_income(client, token, name="Inc Delete Salary")
    first = await _create_linked_income(client, token, wallet_id, income_id)
    await _create_linked_income(client, token, wallet_id, income_id)

    response = await client.delete(
        f"/transactions/{first['id']}", headers=_auth(token)
    )
    assert response.status_code == 200

    assert await _linked_pay(client, token, wallet_id, income_id) == "2030-03-01"


async def test_deleting_a_recurring_income_severs_links(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Sever Wallet")
    income_id = await _create_income(client, token, name="Inc Sever Salary")
    linked = await _create_linked_income(client, token, wallet_id, income_id)

    response = await client.delete(
        f"/recurring-incomes/{income_id}", headers=_auth(token)
    )
    assert response.status_code == 204

    # The Income survives as an ordinary one: the link is severed.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == linked["id"])
    assert body["recurring_income_id"] is None
    assert body["occurrence_date"] is None

    # The severed income is gone: linking to it is indistinguishable from
    # linking to nothing (ADR-0003).
    response = await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": "10.00",
            "date": "2030-02-15",
            "wallet_id": wallet_id,
            "recurring_income_id": income_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 403


async def test_expense_and_transfer_reject_a_link(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Reject Link Wallet")
    contact_id = await _create_wallet(client, token, "Inc Reject Link Contact", "contact")
    income_id = await _create_income(client, token, name="Inc Reject Salary")

    expense = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2030-02-15",
            "wallet_id": wallet_id,
            "recurring_income_id": income_id,
        },
        headers=_auth(token),
    )
    assert expense.status_code == 422

    transfer = await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "10.00",
            "date": "2030-02-15",
            "source_wallet_id": wallet_id,
            "destination_wallet_id": contact_id,
            "recurring_income_id": income_id,
        },
        headers=_auth(token),
    )
    assert transfer.status_code == 422


async def test_editing_rejects_a_link_on_expense_and_transfer(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Edit Reject Wallet")
    contact_id = await _create_wallet(client, token, "Inc Edit Reject Contact", "contact")
    income_id = await _create_income(client, token, name="Inc Edit Reject")

    expense = await client.post(
        "/transactions",
        json={"type": "expense", "amount": "10.00", "date": "2030-02-15", "wallet_id": wallet_id},
        headers=_auth(token),
    )
    expense_patch = await client.patch(
        f"/transactions/{expense.json()['id']}",
        json={"recurring_income_id": income_id},
        headers=_auth(token),
    )
    assert expense_patch.status_code == 422

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
        json={"recurring_income_id": income_id},
        headers=_auth(token),
    )
    assert transfer_patch.status_code == 422


async def test_foreign_or_missing_income_link_is_rejected(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Foreign Link Wallet")
    account_id = insert_foreign_account(database_url, "interloper-income@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            foreign_wallet = Wallet(
                account_id=account_id,
                name="Foreign Income Wallet",
                type=WalletType.CHECKING.value,
            )
            session.add(foreign_wallet)
            session.flush()
            income = RecurringIncome(
                account_id=account_id,
                name="Foreign Income",
                amount="10.00",
                interval_value=1,
                interval_unit="months",
                start_date=None,
                due_day=None,
                due_month=None,
            )
            session.add(income)
            session.commit()
            foreign_income_id = income.id
        engine.dispose()

        for income_id in (foreign_income_id, 999999):
            response = await client.post(
                "/transactions",
                json={
                    "type": "income",
                    "amount": "10.00",
                    "date": "2030-02-15",
                    "wallet_id": wallet_id,
                    "recurring_income_id": income_id,
                },
                headers=_auth(token),
            )
            assert response.status_code == 403, income_id
    finally:
        delete_account(database_url, account_id)


async def test_recurring_incomes_list_exposes_the_next_unpaid_occurrence(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Picker Wallet")
    income_id = await _create_income(client, token, name="Inc Picker Salary")

    async def picker_date() -> str:
        incomes = (await client.get("/recurring-incomes", headers=_auth(token))).json()
        return next(
            income["next_unpaid_occurrence_date"]
            for income in incomes
            if income["id"] == income_id
        )

    # What the form's picker shows: the oldest Unpaid Occurrence's date.
    assert await picker_date() == "2030-03-01"
    await _create_linked_income(client, token, wallet_id, income_id)
    assert await picker_date() == "2030-04-01"
    await _create_linked_income(client, token, wallet_id, income_id)
    assert await picker_date() == "2030-05-01"


async def test_the_pin_survives_income_definition_edits(client: AsyncClient) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "Inc Definition Edit Wallet")
    income_id = await _create_income(
        client, token, name="Inc Definition Edit Salary"
    )
    linked = await _create_linked_income(client, token, wallet_id, income_id)

    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"start_date": "2030-06-01"},
        headers=_auth(token),
    )
    assert response.status_code == 200

    # The stored pin is untouched by the definition edit: the Transaction
    # still covers the Occurrence it paid at link time.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    body = next(item for item in items if item["id"] == linked["id"])
    assert body["recurring_income_id"] == income_id
    assert body["occurrence_date"] == "2030-03-01"
