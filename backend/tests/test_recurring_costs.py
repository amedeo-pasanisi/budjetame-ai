"""Recurring Cost definitions — issue #56, through the HTTP seam.

A Recurring Cost is a name, a fixed amount, an interval (every N days,
weeks, months, or years), and a start date — every definition always
carries one: left empty at creation it is set to the creation day
(ADR-0024), and an Occurrence's due date is its own date. The Wallet and
Category of a linked Expense are chosen at Transaction creation time — the
definition itself never carries them. Occurrences are derived, never
stored; the list exposes each cost's next due date.
Guards: names unique per Account case-insensitively; a start date can be
changed, never unset; all data scoped to the Account (foreign data is a
403, ADR-0003).

Hand-worked expected dates use far-future start dates, so the expectations
are stable regardless of when the suite runs: "today" is always before them.
The pure arithmetic itself (including clamping) is pinned in
test_recurrence.py with a fixed "today".
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import RecurringCost, Wallet

from conftest import (
    SEED_EMAIL,
    SEED_PASSWORD,
    delete_account,
    insert_foreign_account,
)

ROME = ZoneInfo("Europe/Rome")


async def _login(client: AsyncClient) -> str:
    response = await client.post(
        "/auth/login", json={"email": SEED_EMAIL, "password": SEED_PASSWORD}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _cost(**overrides: object) -> dict[str, object]:
    """A valid monthly cost payload; tests override what they exercise."""
    payload: dict[str, object] = {
        "name": "Rent",
        "amount": "850.00",
        "interval_value": 1,
        "interval_unit": "months",
    }
    payload.update(overrides)
    return payload


async def test_recurring_costs_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/recurring-costs")).status_code == 401
    assert (
        await client.post("/recurring-costs", json=_cost())
    ).status_code == 401


async def test_create_recurring_cost(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/recurring-costs",
        json=_cost(start_date="2030-03-15"),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Rent"
    assert body["amount"] == "850.00"
    assert body["interval_value"] == 1
    assert body["interval_unit"] == "months"
    assert body["start_date"] == "2030-03-15"
    # The first Occurrence is the start date itself: 2030-03-15.
    assert body["next_due_date"] == "2030-03-15"


async def test_create_without_start_date_defaults_to_the_creation_date(
    client: AsyncClient,
) -> None:
    """An empty start date is set to the creation day at creation
    (ADR-0024), so a fresh definition always carries one and a daily cost's
    first Occurrence is due today in Europe/Rome."""
    token = await _login(client)

    response = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Coffee",
            interval_value=1,
            interval_unit="days",
        ),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["start_date"] == datetime.now(ROME).date().isoformat()
    assert body["next_due_date"] == datetime.now(ROME).date().isoformat()


async def test_create_with_a_weekly_interval(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Cleaner",
            interval_value=2,
            interval_unit="weeks",
            start_date="2030-01-01",
        ),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["interval_unit"] == "weeks"
    assert body["next_due_date"] == "2030-01-01"


async def test_create_with_a_yearly_interval(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Insurance",
            interval_unit="years",
            start_date="2031-12-01",
        ),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["start_date"] == "2031-12-01"
    assert body["next_due_date"] == "2031-12-01"


async def test_list_is_sorted_by_next_due_date(client: AsyncClient) -> None:
    """The list sorts by next due date ascending — the one order the screen
    needs (issue #56)."""
    token = await _login(client)
    latest = await client.post(
        "/recurring-costs",
        json=_cost(name="Daily Z", interval_unit="days", start_date="2031-01-01"),
        headers=_auth(token),
    )
    earliest = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Monthly A",
            interval_unit="months",
            start_date="2030-06-01",
        ),
        headers=_auth(token),
    )
    middle = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Monthly B",
            interval_unit="months",
            start_date="2030-12-31",
        ),
        headers=_auth(token),
    )
    assert all(r.status_code == 201 for r in (latest, earliest, middle))

    response = await client.get("/recurring-costs", headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    # Earlier tests left other costs around: only the relative order of these
    # three matters (the screen's one order — next due date ascending).
    ids = [cost["id"] for cost in body]
    earliest_id, middle_id, latest_id = (
        earliest.json()["id"],
        middle.json()["id"],
        latest.json()["id"],
    )
    assert ids.index(earliest_id) < ids.index(middle_id) < ids.index(latest_id)
    by_id = {cost["id"]: cost for cost in body}
    assert by_id[earliest_id]["next_due_date"] == "2030-06-01"
    assert by_id[middle_id]["next_due_date"] == "2030-12-31"
    assert by_id[latest_id]["next_due_date"] == "2031-01-01"


async def test_duplicate_name_conflicts_case_insensitively(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    first = await client.post(
        "/recurring-costs", json=_cost(name="Name Rent"), headers=_auth(token)
    )
    assert first.status_code == 201

    second = await client.post(
        "/recurring-costs", json=_cost(name="name rent"), headers=_auth(token)
    )

    assert second.status_code == 409


async def test_create_rejects_bad_values(client: AsyncClient) -> None:
    token = await _login(client)

    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(interval_value=0),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(amount="0"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(start_date="2030-02-30"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(interval_unit="fortnights"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(name="   "),
            headers=_auth(token),
        )
    ).status_code == 422


async def test_edit_recurring_cost(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Edit Rent", start_date="2030-03-15"),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={
            "name": "Rent 2027",
            "amount": "900.00",
            "interval_value": 2,
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Rent 2027"
    assert body["amount"] == "900.00"
    assert body["interval_value"] == 2
    assert body["interval_unit"] == "months"
    # Untouched fields survive the edit.
    assert body["start_date"] == "2030-03-15"
    # Every 2 months from the 15th: 2030-03-15, 2030-05-15…
    assert body["next_due_date"] == "2030-03-15"


async def test_edit_cannot_unset_the_start_date(client: AsyncClient) -> None:
    """A definition always carries a start date (ADR-0024): an explicit null
    is rejected — the date can be changed, never unset."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Clearable Rent", start_date="2030-03-15"),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": None},
        headers=_auth(token),
    )

    assert response.status_code == 422

    moved = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": "2030-06-01"},
        headers=_auth(token),
    )
    assert moved.status_code == 200
    assert moved.json()["start_date"] == "2030-06-01"


async def test_edit_changing_the_unit_keeps_the_start_date(
    client: AsyncClient,
) -> None:
    """The interval unit is independent of the start date: switching a
    monthly cost to days keeps the stored date and reshapes only the derived
    future."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Stale Rent", start_date="2030-03-15"),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]

    fixed = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"interval_unit": "days"},
        headers=_auth(token),
    )
    assert fixed.status_code == 200
    assert fixed.json()["interval_unit"] == "days"
    assert fixed.json()["start_date"] == "2030-03-15"


async def test_edit_rejects_a_duplicate_name(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/recurring-costs", json=_cost(name="Dup Rent"), headers=_auth(token)
    )
    created = await client.post(
        "/recurring-costs", json=_cost(name="Dup Other"), headers=_auth(token)
    )
    cost_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"name": "rent"},
        headers=_auth(token),
    )

    assert response.status_code == 409


async def test_edit_requires_a_change(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Empty Rent"), headers=_auth(token)
    )

    response = await client.patch(
        f"/recurring-costs/{created.json()['id']}", json={}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_freeze_recurring_cost(client: AsyncClient) -> None:
    """Freeze replaces delete: the definition stays in the database with
    frozen=True, its links intact, and hidden from the default list."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Freezable Rent"), headers=_auth(token)
    )
    cost_id = created.json()["id"]

    response = await client.post(
        f"/recurring-costs/{cost_id}/freeze", headers=_auth(token)
    )

    assert response.status_code == 200
    assert response.json()["frozen"] is True
    assert response.json()["backlog_count"] == 0
    assert response.json()["next_due_date"] is None
    assert response.json()["next_unpaid_occurrence_date"] is None

    # Hidden from the default list.
    listed = await client.get("/recurring-costs", headers=_auth(token))
    assert cost_id not in [cost["id"] for cost in listed.json()]

    # Visible with include_frozen.
    with_frozen = await client.get(
        "/recurring-costs?include_frozen=true", headers=_auth(token)
    )
    assert cost_id in [cost["id"] for cost in with_frozen.json()]


async def test_freeze_is_idempotent(client: AsyncClient) -> None:
    """Freezing an already-frozen definition is a no-op."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Idempotent Rent"), headers=_auth(token)
    )
    cost_id = created.json()["id"]

    await client.post(f"/recurring-costs/{cost_id}/freeze", headers=_auth(token))
    second = await client.post(
        f"/recurring-costs/{cost_id}/freeze", headers=_auth(token)
    )
    assert second.status_code == 200
    assert second.json()["frozen"] is True


async def test_frozen_cost_cannot_be_edited(client: AsyncClient) -> None:
    """Frozen definitions are read-only — PATCH is rejected (ADR-0028)."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Frozen Edit Rent"),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]
    await client.post(f"/recurring-costs/{cost_id}/freeze", headers=_auth(token))

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"name": "Should Not Work"},
        headers=_auth(token),
    )

    assert response.status_code == 422


async def test_unfreeze_recurring_cost(client: AsyncClient) -> None:
    """Unfreeze restores the definition to active: frozen=False, derived
    fields come back, it reappears in the default list."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Unfreezable Rent", start_date="2030-03-15"),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]
    await client.post(f"/recurring-costs/{cost_id}/freeze", headers=_auth(token))

    response = await client.post(
        f"/recurring-costs/{cost_id}/unfreeze", headers=_auth(token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["frozen"] is False
    assert body["next_due_date"] == "2030-03-15"
    assert body["next_unpaid_occurrence_date"] == "2030-03-15"

    # Back in the default list.
    listed = await client.get("/recurring-costs", headers=_auth(token))
    assert cost_id in [cost["id"] for cost in listed.json()]


async def test_unfreeze_is_idempotent(client: AsyncClient) -> None:
    """Unfreezing an already-active definition is a no-op."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Always Active"), headers=_auth(token)
    )
    cost_id = created.json()["id"]

    response = await client.post(
        f"/recurring-costs/{cost_id}/unfreeze", headers=_auth(token)
    )
    assert response.status_code == 200
    assert response.json()["frozen"] is False


async def test_foreign_recurring_cost_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    """Foreign data is indistinguishable from absent data: patch and delete
    answer 403, and the list never includes it (ADR-0003)."""
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "recurring-scope@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id, name="Their Wallet", type="checking", frozen=False
            )
            session.add(wallet)
            session.flush()
            cost = RecurringCost(
                account_id=account_id,
                name="Spy Cost",
                amount="10.00",
                interval_value=1,
                interval_unit="months",
                start_date=date(2030, 1, 1),
            )
            session.add(cost)
            session.commit()
            cost_id = cost.id
        engine.dispose()

        patch = await client.patch(
            f"/recurring-costs/{cost_id}",
            json={"name": "Hijacked"},
            headers=_auth(token),
        )
        freeze = await client.post(
            f"/recurring-costs/{cost_id}/freeze", headers=_auth(token)
        )
        unfreeze = await client.post(
            f"/recurring-costs/{cost_id}/unfreeze", headers=_auth(token)
        )
        assert patch.status_code == 403
        assert freeze.status_code == 403
        assert unfreeze.status_code == 403

        listing = await client.get("/recurring-costs", headers=_auth(token))
        assert cost_id not in [cost["id"] for cost in listing.json()]
    finally:
        delete_account(database_url, account_id)


# --- Delete and undo (ADR-0034) ---


async def _frozen_definition(client: AsyncClient, token: str, name: str) -> dict:
    """A definition created and frozen through the API, as the freeze
    returned it."""
    created = await client.post(
        "/recurring-costs", json=_cost(name=name), headers=_auth(token)
    )
    assert created.status_code == 201, created.json()
    frozen = await client.post(
        f"/recurring-costs/{created.json()['id']}/freeze", headers=_auth(token)
    )
    assert frozen.status_code == 200
    return frozen.json()


async def _ids_with_frozen(client: AsyncClient, token: str) -> set[int]:
    listed = await client.get(
        "/recurring-costs?include_frozen=true", headers=_auth(token)
    )
    return {row["id"] for row in listed.json()}


async def _link_a_transaction(
    client: AsyncClient, token: str, definition_id: int
) -> tuple[int, int]:
    """A Transaction linked to the definition — history the delete must
    refuse to sever — and the Wallet it sits on, as (transaction id, wallet
    id)."""
    wallet = await client.post(
        "/wallets",
        json={"name": f"Link Wallet cost {definition_id}", "type": "checking", "opening_balance": "0.00"},
        headers=_auth(token),
    )
    assert wallet.status_code == 201
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": "2026-08-01",
            "wallet_id": wallet.json()["id"],
            "recurring_cost_id": definition_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"], wallet.json()["id"]


async def _transaction(
    client: AsyncClient, token: str, transaction_id: int, wallet_id: int
) -> dict:
    """The Transaction as the ledger lists it, read through its Wallet's
    filter so other suites' rows never push it off the first page."""
    page = await client.get(
        f"/transactions?wallet_id={wallet_id}", headers=_auth(token)
    )
    assert page.status_code == 200
    return next(item for item in page.json()["items"] if item["id"] == transaction_id)


async def test_delete_a_frozen_definition_with_no_history_returns_the_row_and_removes_it(
    client: AsyncClient,
) -> None:
    """A frozen definition no Transaction is linked to can be deleted for good
    (ADR-0034): the response is the full row - frozen flag and freeze date
    included, the client's replay payload - and the definition is gone from
    the list, even with include_frozen."""
    token = await _login(client)
    frozen = await _frozen_definition(client, token, "Abandoned Trial")

    response = await client.delete(
        f"/recurring-costs/{frozen['id']}", headers=_auth(token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == frozen["id"]
    assert body["name"] == "Abandoned Trial"
    assert body["frozen"] is True
    assert body["freeze_date"] == datetime.now(ROME).date().isoformat()
    assert frozen["freeze_date"] == body["freeze_date"]
    assert frozen["id"] not in await _ids_with_frozen(client, token)


async def test_delete_an_active_definition_is_refused_with_freeze_first(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Active Not Deletable"), headers=_auth(token)
    )
    definition_id = created.json()["id"]

    response = await client.delete(
        f"/recurring-costs/{definition_id}", headers=_auth(token)
    )

    assert response.status_code == 422
    assert "freeze" in response.json()["detail"].lower()
    assert definition_id in await _ids_with_frozen(client, token)


async def test_delete_is_refused_when_a_transaction_is_linked_and_the_link_survives(
    client: AsyncClient,
) -> None:
    """A delete never severs a link (ADR-0034): the refusal names the count
    and the hint to unlink first, and the Transaction keeps its link."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Paid Once"), headers=_auth(token)
    )
    definition_id = created.json()["id"]
    transaction_id, wallet_id = await _link_a_transaction(client, token, definition_id)
    frozen = await client.post(f"/recurring-costs/{definition_id}/freeze", headers=_auth(token))
    assert frozen.status_code == 200

    response = await client.delete(
        f"/recurring-costs/{definition_id}", headers=_auth(token)
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "1 transaction is linked to this recurring cost — unlink it first"
    )
    assert definition_id in await _ids_with_frozen(client, token)
    assert (await _transaction(client, token, transaction_id, wallet_id))["recurring_cost_id"] == definition_id


async def test_delete_and_undo_of_a_foreign_or_missing_definition_return_403(
    client: AsyncClient, database_url: str
) -> None:
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "delete-scope@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            definition = RecurringCost(
                account_id=account_id,
                name="Their Definition",
                amount="10.00",
                interval_value=1,
                interval_unit="months",
                start_date=date(2030, 1, 1),
                frozen=True,
                freeze_date=date(2030, 2, 1),
            )
            session.add(definition)
            session.commit()
            foreign_id = definition.id
        engine.dispose()

        deleted = await client.delete(f"/recurring-costs/{foreign_id}", headers=_auth(token))
        assert deleted.status_code == 403
        undo = await client.post(
            "/recurring-costs/undo",
            json={
                "id": foreign_id,
                "name": "Their Definition",
                "amount": "10.00",
                "interval_value": 1,
                "interval_unit": "months",
                "start_date": "2030-01-01",
                "frozen": True,
                "freeze_date": "2030-02-01",
                "created_at": "2026-08-01T10:00:00Z",
            },
            headers=_auth(token),
        )
        assert undo.status_code == 403
    finally:
        delete_account(database_url, account_id)
    missing = await client.delete("/recurring-costs/999999", headers=_auth(token))
    assert missing.status_code == 403


async def test_undo_re_inserts_the_same_definition_still_frozen_and_the_next_create_does_not_collide(
    client: AsyncClient,
) -> None:
    """Undo is a true reversal: the very same definition comes back - same id,
    still frozen, same freeze date, in the Frozen section - and the sequence
    is re-synced so a later create never collides with the restored id."""
    token = await _login(client)
    frozen = await _frozen_definition(client, token, "Undo Trial")
    deleted = (
        await client.delete(f"/recurring-costs/{frozen['id']}", headers=_auth(token))
    ).json()

    undo = await client.post("/recurring-costs/undo", json=deleted, headers=_auth(token))

    assert undo.status_code == 201
    restored = undo.json()
    assert restored["id"] == frozen["id"]
    assert restored["name"] == "Undo Trial"
    assert restored["amount"] == deleted["amount"]
    assert restored["interval_value"] == deleted["interval_value"]
    assert restored["interval_unit"] == deleted["interval_unit"]
    assert restored["start_date"] == deleted["start_date"]
    assert restored["frozen"] is True
    assert restored["freeze_date"] == deleted["freeze_date"]
    assert restored["created_at"] == deleted["created_at"]
    assert restored["next_due_date"] is None
    default = await client.get("/recurring-costs", headers=_auth(token))
    assert frozen["id"] not in [row["id"] for row in default.json()]
    assert frozen["id"] in await _ids_with_frozen(client, token)

    created = await client.post(
        "/recurring-costs", json=_cost(name="After Undo"), headers=_auth(token)
    )
    assert created.status_code == 201
    assert created.json()["id"] > frozen["id"]


async def test_undo_after_the_name_was_reused_is_refused_as_a_name_conflict(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    frozen = await _frozen_definition(client, token, "Reused Trial")
    deleted = (
        await client.delete(f"/recurring-costs/{frozen['id']}", headers=_auth(token))
    ).json()
    replacement = await client.post(
        "/recurring-costs", json=_cost(name="reused trial"), headers=_auth(token)
    )
    assert replacement.status_code == 201

    undo = await client.post("/recurring-costs/undo", json=deleted, headers=_auth(token))

    assert undo.status_code == 409
    assert "name" in undo.json()["detail"].lower()
    ids = await _ids_with_frozen(client, token)
    assert frozen["id"] not in ids
    assert replacement.json()["id"] in ids
