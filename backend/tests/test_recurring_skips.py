"""Skipped Occurrences — ADR-0016, through the HTTP seam.

A skip excuses one Occurrence of a Recurring Cost or Recurring Income: the
user does not have to pay (or receive) it, so it never enters the Backlog,
never counts toward Monthly Spendable, and a link can never pay it — the
picker and the link walk step over it, and paying one means un-skipping it
first. The Skip/Un-skip button targets the oldest Unpaid Occurrence — the
front of the queue, Skipped or not — so pressing it repeatedly clears a
Backlog oldest-first, and the badge ticks down as feedback; when nothing is
left to skip, the button reads Un-skip and restores the oldest Skipped one.
A skip is anchored to its Occurrence's period (the month for monthly
definitions, the year for yearly, the date itself for day/week) and travels
with it: editing the definition never drops it, and changing the interval
unit maps the period along.

Expected dates are computed relative to Europe/Rome today, so the
assertions hold whenever the suite runs. The Incomes side mirrors the Costs
side (ADR-0011) and shares the same rules.
"""

from datetime import date, datetime, timedelta
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


def _today() -> date:
    """The calendar day the backend derives against — Europe/Rome (CONTEXT.md)."""
    return datetime.now(ROME).date()


def _days(offset: int) -> str:
    """`offset` days from today, as the ISO date the API expects."""
    return (_today() + timedelta(days=offset)).isoformat()


def _month_15_day(offset: int, day: int) -> str:
    """The `day`th of the month `offset` months before today's month."""
    today = _today()
    total = today.month - 1 - offset
    year = today.year + total // 12
    month = total % 12 + 1
    return date(year, month, day).isoformat()


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


async def _create_cost(
    client: AsyncClient,
    token: str,
    *,
    name: str,
    start_date: str,
    interval_value: int = 1,
    interval_unit: str = "days",
) -> int:
    payload: dict[str, object] = {
        "name": name,
        "amount": "10.00",
        "interval_value": interval_value,
        "interval_unit": interval_unit,
        "start_date": start_date,
    }
    response = await client.post(
        "/recurring-costs", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_income(
    client: AsyncClient,
    token: str,
    *,
    name: str,
    start_date: str,
    interval_value: int = 1,
    interval_unit: str = "days",
) -> int:
    response = await client.post(
        "/recurring-incomes",
        json={
            "name": name,
            "amount": "10.00",
            "interval_value": interval_value,
            "interval_unit": interval_unit,
            "start_date": start_date,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _toggle_cost(
    client: AsyncClient, token: str, cost_id: int
) -> dict:
    """The Skip/Un-skip button's call, returning the refreshed definition."""
    response = await client.post(
        f"/recurring-costs/{cost_id}/skip-toggle", headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _toggle_income(
    client: AsyncClient, token: str, income_id: int
) -> dict:
    response = await client.post(
        f"/recurring-incomes/{income_id}/skip-toggle", headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _cost_state(
    client: AsyncClient, token: str, cost_id: int
) -> dict:
    """The API's derived state for one cost, found in the list."""
    response = await client.get("/recurring-costs", headers=_auth(token))
    assert response.status_code == 200
    return next(cost for cost in response.json() if cost["id"] == cost_id)


async def _income_state(
    client: AsyncClient, token: str, income_id: int
) -> dict:
    response = await client.get("/recurring-incomes", headers=_auth(token))
    assert response.status_code == 200
    return next(income for income in response.json() if income["id"] == income_id)


async def _link_expense(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    cost_id: int,
) -> str:
    """An Expense linked to `cost_id`, returning the pinned Occurrence date."""
    response = await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "10.00",
            "date": _days(0),
            "wallet_id": wallet_id,
            "recurring_cost_id": cost_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    occurrence = response.json()["occurrence_date"]
    assert occurrence is not None
    return occurrence


async def _link_income(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    income_id: int,
) -> str:
    response = await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": "10.00",
            "date": _days(0),
            "wallet_id": wallet_id,
            "recurring_income_id": income_id,
        },
        headers=_auth(token),
    )
    assert response.status_code == 201
    occurrence = response.json()["occurrence_date"]
    assert occurrence is not None
    return occurrence


# --- the Skip/Un-skip button: the front of the queue ----------------------

async def test_skipping_the_oldest_unpaid_occurrence_drops_the_badge(
    client: AsyncClient,
) -> None:
    """A daily cost missed for ten days reads 10 unpaid. One toggle skips
    the oldest Unpaid Occurrence — the one a new link would pay — and the
    badge drops to 9; the button still reads Skip while anything is left to
    skip. The response carries the refreshed derived state."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S16 Skip Coffee", start_date=_days(-9)
    )

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 10
    assert state["overdue"] is True
    assert state["next_skip_action"] == "skip"

    toggled = await _toggle_cost(client, token, cost_id)

    assert toggled["backlog_count"] == 9
    assert toggled["overdue"] is True
    assert toggled["next_skip_action"] == "skip"
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 9


async def test_repeated_toggles_clear_the_backlog_then_unskip(
    client: AsyncClient,
) -> None:
    """Pressing Skip repeatedly clears the whole Backlog oldest-first, one
    per press — the badge ticks 10, 9, ..., 0 and Overdue clears. Once
    nothing is left to skip, the button reads Un-skip; pressing it restores
    the oldest Skipped Occurrence (badge 1), and the button reads Skip
    again."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S16 Clear Coffee", start_date=_days(-9)
    )

    for _ in range(10):
        toggled = await _toggle_cost(client, token, cost_id)

    assert toggled["backlog_count"] == 0
    assert toggled["overdue"] is False
    assert toggled["next_skip_action"] == "unskip"

    toggled = await _toggle_cost(client, token, cost_id)
    assert toggled["backlog_count"] == 1
    assert toggled["next_skip_action"] == "skip"


async def test_skip_never_targets_a_paid_occurrence(
    client: AsyncClient,
) -> None:
    """The button resolves the front of the queue: with the whole Backlog
    paid by links, the toggle skips the next future Occurrence — never one
    a Transaction covers — so the picker walks past it, and the badge
    stays 0. (The next due date still reads today's paid Occurrence: it is
    due, and `next_due_date` only steps over Skipped ones.)"""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S16 Paid Wallet")
    cost_id = await _create_cost(
        client, token, name="S16 Paid Coffee", start_date=_days(-9)
    )
    for _ in range(10):
        await _link_expense(client, token, wallet_id, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(0)
    assert state["next_unpaid_occurrence_date"] == _days(1)

    toggled = await _toggle_cost(client, token, cost_id)

    assert toggled["backlog_count"] == 0
    assert toggled["next_skip_action"] == "unskip"
    assert toggled["next_due_date"] == _days(0)
    assert toggled["next_unpaid_occurrence_date"] == _days(2)

    # Pressing again un-skips the skipped future Occurrence: the picker
    # comes back to it, and the button reads Skip.
    toggled = await _toggle_cost(client, token, cost_id)
    assert toggled["next_unpaid_occurrence_date"] == _days(1)
    assert toggled["next_skip_action"] == "skip"


async def test_a_link_never_pays_a_skipped_occurrence(
    client: AsyncClient,
) -> None:
    """A Skipped Occurrence is never offered to a link: after skipping the
    oldest, the next linked Expense pins the *second* Occurrence — the
    picker and the link walk step over the skipped one (un-skipping comes
    first)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S16 Link Wallet")
    cost_id = await _create_cost(
        client, token, name="S16 Link Coffee", start_date=_days(-9)
    )

    await _toggle_cost(client, token, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["next_unpaid_occurrence_date"] == _days(-8)

    pin = await _link_expense(client, token, wallet_id, cost_id)

    assert pin == _days(-8)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 8


async def test_skipping_a_future_occurrence_pushes_the_next_due(
    client: AsyncClient,
) -> None:
    """Nothing due yet: the toggle skips the upcoming Occurrence — the next
    due date walks to the one after, and the button stays on Skip."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S16 Future Rent", start_date=_days(5)
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(5)

    toggled = await _toggle_cost(client, token, cost_id)

    assert toggled["next_due_date"] == _days(6)
    assert toggled["next_unpaid_occurrence_date"] == _days(6)
    assert toggled["backlog_count"] == 0
    assert toggled["next_skip_action"] == "unskip"


# --- a skip travels with its Occurrence (ADR-0016) ------------------------

async def test_the_skip_survives_a_start_date_edit_http(
    client: AsyncClient,
) -> None:
    """A monthly cost starting on today's day-of-month of last month: two
    Occurrences are due (last month's and today's). Skipping the oldest,
    then moving the start date a month earlier to the 1st — which keeps
    last month's Occurrence on the sequence — keeps that Occurrence
    excused: the badge goes 2 -> 1 -> 2 (the new earlier month is unpaid)
    and the button still reads Skip for the next one."""
    token = await _login(client)
    cost_id = await _create_cost(
        client,
        token,
        name="S16 Edit Rent",
        start_date=_month_15_day(1, min(_today().day, 28)),
        interval_unit="months",
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 2

    await _toggle_cost(client, token, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 1

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": _month_15_day(2, 1)},
        headers=_auth(token),
    )
    assert response.status_code == 200

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 2
    assert state["next_skip_action"] == "skip"


async def test_a_skipped_month_becomes_the_year_when_the_interval_turns_yearly(
    client: AsyncClient,
) -> None:
    """The original question made concrete: a monthly cost with a skipped
    month, converted to a yearly payment period — the skip maps from the
    month to its year, so that year's Occurrence is excused: the badge
    reads 0 and the button reads Un-skip. Toggling un-skips it (badge 1)."""
    token = await _login(client)
    cost_id = await _create_cost(
        client,
        token,
        name="S16 Yearly Gym",
        start_date=_month_15_day(3, 1),
        interval_unit="months",
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 4

    await _toggle_cost(client, token, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 3

    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={
            "interval_value": 1,
            "interval_unit": "years",
        },
        headers=_auth(token),
    )
    assert response.status_code == 200

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["overdue"] is False
    assert state["next_skip_action"] == "unskip"
    start = date.fromisoformat(_month_15_day(3, 1))
    assert state["next_due_date"] == date(
        start.year + 1, start.month, start.day
    ).isoformat()

    toggled = await _toggle_cost(client, token, cost_id)
    assert toggled["backlog_count"] == 1
    assert toggled["next_skip_action"] == "skip"


async def test_deleting_a_definition_drops_its_skips(
    client: AsyncClient,
) -> None:
    """Deleting a Recurring Cost cascades its skips away: the recreated
    definition starts clean — the button reads Skip, the badge reads 1."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S16 Delete Coffee", start_date=_days(0)
    )
    toggled = await _toggle_cost(client, token, cost_id)
    assert toggled["backlog_count"] == 0
    assert toggled["next_skip_action"] == "unskip"

    response = await client.delete(f"/recurring-costs/{cost_id}", headers=_auth(token))
    assert response.status_code == 204

    cost_id = await _create_cost(
        client, token, name="S16 Delete Coffee", start_date=_days(0)
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 1
    assert state["next_skip_action"] == "skip"


# --- the Incomes side mirrors the contract (ADR-0011) ---------------------

async def test_incomes_mirror_the_skip_contract(
    client: AsyncClient,
) -> None:
    """Recurring Incomes behave identically: one toggle skips the oldest
    Unpaid Occurrence (badge 10 -> 9), a link never pays a skipped one, and
    the button flips to Un-skip once nothing is left to skip."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S16 Income Wallet")
    income_id = await _create_income(
        client, token, name="S16 Skip Salary", start_date=_days(-9)
    )

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 10
    assert state["next_skip_action"] == "skip"

    toggled = await _toggle_income(client, token, income_id)
    assert toggled["backlog_count"] == 9
    assert toggled["next_skip_action"] == "skip"
    assert toggled["next_unpaid_occurrence_date"] == _days(-8)

    pin = await _link_income(client, token, wallet_id, income_id)
    assert pin == _days(-8)

    # Eight more presses skip k=2..k=9: the whole Backlog is excused.
    for _ in range(8):
        toggled = await _toggle_income(client, token, income_id)
    assert toggled["backlog_count"] == 0
    assert toggled["next_skip_action"] == "unskip"

    # The next press un-skips the oldest Skipped Occurrence (k=0): the
    # badge returns to 1 and the button reads Skip again.
    toggled = await _toggle_income(client, token, income_id)
    assert toggled["backlog_count"] == 1
    assert toggled["next_skip_action"] == "skip"


# --- scoping (ADR-0003) ----------------------------------------------------

async def test_skip_toggle_is_scoped_to_the_account(
    client: AsyncClient, database_url: str
) -> None:
    """A foreign Recurring Cost's skip-toggle answers 403 — foreign data is
    indistinguishable from absent data (ADR-0003)."""
    token = await _login(client)
    account_id = insert_foreign_account(database_url, "recurring-skip-scope@budjetame.dev")
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

        toggle = await client.post(
            f"/recurring-costs/{cost_id}/skip-toggle", headers=_auth(token)
        )
        assert toggle.status_code == 403
    finally:
        delete_account(database_url, account_id)
