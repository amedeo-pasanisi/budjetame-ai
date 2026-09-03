"""Recurring Income definitions — issue #60, through the HTTP seam.

The mirror of the Recurring Cost tests (ADR-0011): a Recurring Income is a
name, a fixed amount, an interval (every N days, weeks, months, or years),
and a start date — every definition always carries one: left empty at
creation it is set to the creation day (ADR-0024), and an Occurrence's due
date is its own date. The Wallet and Category of a linked Income are chosen
at Transaction creation time — the definition itself never carries them.
Occurrences are derived, never stored; the list exposes each income's next
due date, sorted by it. Guards: names
unique per Account case-insensitively; a start date can be changed, never
unset; all data scoped to the Account (foreign data is a 403, ADR-0003).

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
from app.models import RecurringIncome, Wallet

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


def _income(**overrides: object) -> dict[str, object]:
    """A valid monthly income payload; tests override what they exercise."""
    payload: dict[str, object] = {
        "name": "Salary",
        "amount": "2100.00",
        "interval_value": 1,
        "interval_unit": "months",
    }
    payload.update(overrides)
    return payload


async def test_recurring_incomes_require_authentication(client: AsyncClient) -> None:
    assert (await client.get("/recurring-incomes")).status_code == 401
    assert (
        await client.post("/recurring-incomes", json=_income())
    ).status_code == 401


async def test_create_recurring_income(client: AsyncClient) -> None:
    token = await _login(client)

    response = await client.post(
        "/recurring-incomes",
        json=_income(start_date="2030-03-15"),
        headers=_auth(token),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Salary"
    assert body["amount"] == "2100.00"
    assert body["interval_value"] == 1
    assert body["interval_unit"] == "months"
    assert body["start_date"] == "2030-03-15"
    # The first Occurrence is the start date itself: 2030-03-15.
    assert body["next_due_date"] == "2030-03-15"


async def test_create_without_start_date_defaults_to_the_creation_date(
    client: AsyncClient,
) -> None:
    """An empty start date is set to the creation day at creation
    (ADR-0024), so a fresh definition always carries one and a daily
    income's first Occurrence is due today in Europe/Rome."""
    token = await _login(client)

    response = await client.post(
        "/recurring-incomes",
        json=_income(
            name="Tip",
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
        "/recurring-incomes",
        json=_income(
            name="Allowance",
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
        "/recurring-incomes",
        json=_income(
            name="Bonus",
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
    needs (issue #60)."""
    token = await _login(client)
    latest = await client.post(
        "/recurring-incomes",
        json=_income(name="Daily Z", interval_unit="days", start_date="2031-01-01"),
        headers=_auth(token),
    )
    earliest = await client.post(
        "/recurring-incomes",
        json=_income(
            name="Monthly A",
            interval_unit="months",
            start_date="2030-06-01",
        ),
        headers=_auth(token),
    )
    middle = await client.post(
        "/recurring-incomes",
        json=_income(
            name="Monthly B",
            interval_unit="months",
            start_date="2030-12-31",
        ),
        headers=_auth(token),
    )
    assert all(r.status_code == 201 for r in (latest, earliest, middle))

    response = await client.get("/recurring-incomes", headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    # Earlier tests left other incomes around: only the relative order of
    # these three matters (the screen's one order — next due date ascending).
    ids = [income["id"] for income in body]
    earliest_id, middle_id, latest_id = (
        earliest.json()["id"],
        middle.json()["id"],
        latest.json()["id"],
    )
    assert ids.index(earliest_id) < ids.index(middle_id) < ids.index(latest_id)
    by_id = {income["id"]: income for income in body}
    assert by_id[earliest_id]["next_due_date"] == "2030-06-01"
    assert by_id[middle_id]["next_due_date"] == "2030-12-31"
    assert by_id[latest_id]["next_due_date"] == "2031-01-01"


async def test_duplicate_name_conflicts_case_insensitively(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    first = await client.post(
        "/recurring-incomes", json=_income(name="Name Salary"), headers=_auth(token)
    )
    assert first.status_code == 201

    second = await client.post(
        "/recurring-incomes", json=_income(name="name salary"), headers=_auth(token)
    )

    assert second.status_code == 409


async def test_create_rejects_bad_values(client: AsyncClient) -> None:
    token = await _login(client)

    assert (
        await client.post(
            "/recurring-incomes",
            json=_income(interval_value=0),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-incomes",
            json=_income(amount="0"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-incomes",
            json=_income(start_date="2030-02-30"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-incomes",
            json=_income(interval_unit="fortnights"),
            headers=_auth(token),
        )
    ).status_code == 422
    assert (
        await client.post(
            "/recurring-incomes",
            json=_income(name="   "),
            headers=_auth(token),
        )
    ).status_code == 422


async def test_edit_recurring_income(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-incomes",
        json=_income(name="Edit Salary", start_date="2030-03-15"),
        headers=_auth(token),
    )
    income_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={
            "name": "Salary 2027",
            "amount": "2200.00",
            "interval_value": 2,
        },
        headers=_auth(token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Salary 2027"
    assert body["amount"] == "2200.00"
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
        "/recurring-incomes",
        json=_income(name="Clearable Salary", start_date="2030-03-15"),
        headers=_auth(token),
    )
    income_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"start_date": None},
        headers=_auth(token),
    )

    assert response.status_code == 422

    moved = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"start_date": "2030-06-01"},
        headers=_auth(token),
    )
    assert moved.status_code == 200
    assert moved.json()["start_date"] == "2030-06-01"


async def test_edit_changing_the_unit_keeps_the_start_date(
    client: AsyncClient,
) -> None:
    """The interval unit is independent of the start date: switching a
    monthly income to days keeps the stored date and reshapes only the
    derived future."""
    token = await _login(client)
    created = await client.post(
        "/recurring-incomes",
        json=_income(name="Stale Salary", start_date="2030-03-15"),
        headers=_auth(token),
    )
    income_id = created.json()["id"]

    fixed = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"interval_unit": "days"},
        headers=_auth(token),
    )
    assert fixed.status_code == 200
    assert fixed.json()["interval_unit"] == "days"
    assert fixed.json()["start_date"] == "2030-03-15"


async def test_edit_rejects_a_duplicate_name(client: AsyncClient) -> None:
    token = await _login(client)
    await client.post(
        "/recurring-incomes", json=_income(name="Dup Salary"), headers=_auth(token)
    )
    created = await client.post(
        "/recurring-incomes", json=_income(name="Dup Other"), headers=_auth(token)
    )
    income_id = created.json()["id"]

    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"name": "salary"},
        headers=_auth(token),
    )

    assert response.status_code == 409


async def test_edit_requires_a_change(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-incomes", json=_income(name="Empty Salary"), headers=_auth(token)
    )

    response = await client.patch(
        f"/recurring-incomes/{created.json()['id']}", json={}, headers=_auth(token)
    )

    assert response.status_code == 422


async def test_delete_recurring_income(client: AsyncClient) -> None:
    token = await _login(client)
    created = await client.post(
        "/recurring-incomes", json=_income(name="Deletable Salary"), headers=_auth(token)
    )
    income_id = created.json()["id"]

    response = await client.delete(f"/recurring-incomes/{income_id}", headers=_auth(token))

    assert response.status_code == 204
    listed = await client.get("/recurring-incomes", headers=_auth(token))
    assert income_id not in [income["id"] for income in listed.json()]


async def test_foreign_recurring_income_returns_403(
    client: AsyncClient, database_url: str
) -> None:
    """Foreign data is indistinguishable from absent data: patch and delete
    answer 403, and the list never includes it (ADR-0003)."""
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "recurring-income-scope@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id, name="Their Wallet", type="checking", frozen=False
            )
            session.add(wallet)
            session.flush()
            income = RecurringIncome(
                account_id=account_id,
                name="Spy Income",
                amount="10.00",
                interval_value=1,
                interval_unit="months",
                start_date=date(2030, 1, 1),
            )
            session.add(income)
            session.commit()
            income_id = income.id
        engine.dispose()

        patch = await client.patch(
            f"/recurring-incomes/{income_id}",
            json={"name": "Hijacked"},
            headers=_auth(token),
        )
        delete = await client.delete(
            f"/recurring-incomes/{income_id}", headers=_auth(token)
        )
        assert patch.status_code == 403
        assert delete.status_code == 403

        listing = await client.get("/recurring-incomes", headers=_auth(token))
        assert income_id not in [income["id"] for income in listing.json()]
    finally:
        delete_account(database_url, account_id)
