"""Recurring Cost definitions — issue #56, through the HTTP seam.

A Recurring Cost is a name, a fixed amount, an interval (every N days,
weeks, months, or years), an optional start date (defaults to the creation
date when unset), and an optional due-date override (day-of-month for
months, month+day for years, none for day/week). The Wallet and Category of
a linked Expense are chosen at Transaction creation time — the definition
itself never carries them. Occurrences are derived, never stored; the list
exposes each cost's next due date (override applied, clamping included).
Guards: names unique per Account case-insensitively; all data scoped to the
Account (foreign data is a 403, ADR-0003).

Hand-worked expected dates use far-future start dates, so the expectations
are stable regardless of when the suite runs: "today" is always before them.
The pure arithmetic itself (including clamping) is pinned in
test_recurrence.py with a fixed "today".
"""

from datetime import datetime
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
        json=_cost(start_date="2030-03-15", due_day=1),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Rent"
    assert body["amount"] == "850.00"
    assert body["interval_value"] == 1
    assert body["interval_unit"] == "months"
    assert body["start_date"] == "2030-03-15"
    assert body["due_day"] == 1
    assert body["due_month"] is None
    # The sequence starts on the 15th but is due on the 1st: the first due
    # date is 2030-03-01, before its own Occurrence (spec user story 5).
    assert body["next_due_date"] == "2030-03-01"


async def test_create_without_start_date_defaults_to_the_creation_date(
    client: AsyncClient,
) -> None:
    """An unset start date defaults to the creation date, so a daily cost's
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
    assert body["start_date"] is None
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


async def test_create_with_a_yearly_override(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/recurring-costs",
        json=_cost(
            name="Insurance",
            interval_unit="years",
            start_date="2031-05-10",
            due_day=1,
            due_month=12,
        ),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["due_day"] == 1
    assert body["due_month"] == 12
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
            due_day=1,
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
    assert by_id[middle_id]["next_due_date"] == "2030-12-01"
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


async def test_override_rules_follow_the_interval_unit(client: AsyncClient) -> None:
    """The due-date override is a day-of-month for month intervals, a
    month+day for year intervals, and never allowed for day/week
    intervals."""
    token = await _login(client)

    cases: list[dict[str, object]] = [
        {"interval_unit": "days", "due_day": 5},
        {"interval_unit": "weeks", "due_day": 5},
        {"interval_unit": "weeks", "due_month": 3, "due_day": 5},
        {"interval_unit": "months", "due_month": 3, "due_day": 5},
        {"interval_unit": "years", "due_day": 5},
        {"interval_unit": "years", "due_month": 3},
    ]
    for overrides in cases:
        response = await client.post(
            "/recurring-costs",
            json=_cost(name=f"Override {overrides}", **overrides),
            headers=_auth(token),
        )
        assert response.status_code == 422, overrides


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
    assert (
        await client.post(
            "/recurring-costs",
            json=_cost(due_day=32),
            headers=_auth(token),
        )
    ).status_code == 422


async def test_edit_recurring_cost(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Edit Rent", start_date="2030-03-15", due_day=1),
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
    assert body["due_day"] == 1
    # Every 2 months from the 15th, due on the 1st: 2030-03-01, 2030-05-01…
    assert body["next_due_date"] == "2030-03-01"


async def test_edit_can_clear_the_start_date_and_the_override(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Clearable Rent", start_date="2030-03-15", due_day=1),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": None, "due_day": None},
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["start_date"] is None
    assert body["due_day"] is None


async def test_edit_rejects_an_override_stale_after_a_unit_change(
    client: AsyncClient,
) -> None:
    """Changing the interval to days while a month override is still set is
    rejected; clearing the override in the same submission is accepted — the
    rules judge the resulting definition."""
    token = await _login(client)
    created = await client.post(
        "/recurring-costs",
        json=_cost(name="Stale Rent", start_date="2030-03-15", due_day=1),
        headers=_auth(token),
    )
    cost_id = created.json()["id"]

    stale = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"interval_unit": "days"},
        headers=_auth(token),
    )
    assert stale.status_code == 422

    fixed = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"interval_unit": "days", "due_day": None},
        headers=_auth(token),
    )
    assert fixed.status_code == 200
    assert fixed.json()["interval_unit"] == "days"
    assert fixed.json()["due_day"] is None


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


async def test_delete_recurring_cost(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-costs", json=_cost(name="Deletable Rent"), headers=_auth(token)
    )
    cost_id = created.json()["id"]

    response = await client.delete(f"/recurring-costs/{cost_id}", headers=_auth(token))

    assert response.status_code == 204
    listed = await client.get("/recurring-costs", headers=_auth(token))
    assert cost_id not in [cost["id"] for cost in listed.json()]


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
        delete = await client.delete(
            f"/recurring-costs/{cost_id}", headers=_auth(token)
        )
        assert patch.status_code == 403
        assert delete.status_code == 403

        listing = await client.get("/recurring-costs", headers=_auth(token))
        assert cost_id not in [cost["id"] for cost in listing.json()]
    finally:
        delete_account(database_url, account_id)
