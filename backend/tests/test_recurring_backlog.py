"""The Backlog, Overdue flag, and the state read — issue #58, through the
HTTP seam.

Every Recurring Cost read exposes its derived state: `backlog_count` (Unpaid
Occurrences whose due date is today or earlier in Europe/Rome — the "N
unpaid" badge), `overdue` (Backlog non-empty), and the existing
`next_due_date`. The count is derived on the fly from the definition and the
stored link pins (issue #57): paying an Occurrence drops the count by one,
and editing a cost's interval or start date reshapes only the derived future
— an Occurrence covered by a link is never counted back in, and the pin on
the linked Expense never moves.

Expected dates are computed relative to Europe/Rome today, so the assertions
hold whenever the suite runs.
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from httpx import AsyncClient

from conftest import SEED_EMAIL, SEED_PASSWORD

ROME = ZoneInfo("Europe/Rome")


def _today() -> date:
    """The calendar day the backend derives against — Europe/Rome (CONTEXT.md)."""
    return datetime.now(ROME).date()


def _days(offset: int) -> str:
    """`offset` days from today, as the ISO date the API expects."""
    return (_today() + timedelta(days=offset)).isoformat()


def _month_15(offset: int) -> str:
    """The 15th of the month `offset` months before today's month — the
    start of the override test's monthly cost. The month arithmetic is
    plain calendar stepping, matching how the pure module walks months."""
    today = _today()
    total = today.month - 1 - offset
    year = today.year + total // 12
    month = total % 12 + 1
    return date(year, month, 15).isoformat()


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
    due_day: int | None = None,
) -> int:
    payload: dict[str, object] = {
        "name": name,
        "amount": "10.00",
        "interval_value": interval_value,
        "interval_unit": interval_unit,
        "start_date": start_date,
    }
    if due_day is not None:
        payload["due_day"] = due_day
    response = await client.post(
        "/recurring-costs", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


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


async def _cost_state(
    client: AsyncClient, token: str, cost_id: int
) -> dict:
    """The API's derived state for one cost, found in the list."""
    response = await client.get("/recurring-costs", headers=_auth(token))
    assert response.status_code == 200
    return next(cost for cost in response.json() if cost["id"] == cost_id)


async def test_a_daily_cost_missed_for_ten_days_reads_ten_unpaid(
    client: AsyncClient,
) -> None:
    """The original question made concrete: a daily cost starting nine days
    ago has ten Occurrences due today or earlier — the first ten days of its
    life — all Unpaid, so the badge reads "10 unpaid" and the cost is
    Overdue. Today's Occurrence is due today, so it is both the Backlog's
    newest item and the next due date."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Backlog Wallet")
    cost_id = await _create_cost(
        client, token, name="Backlog Coffee", start_date=_days(-9)
    )

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 10
    assert state["overdue"] is True
    assert state["next_due_date"] == _days(0)


async def test_paying_one_occurrence_drops_the_count_to_nine(
    client: AsyncClient,
) -> None:
    """Paying per the linking rules — the oldest Unpaid Occurrence — clears
    one item: 10 unpaid becomes 9. Each further link drops one more."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Pay One Wallet")
    cost_id = await _create_cost(
        client, token, name="Pay One Coffee", start_date=_days(-9)
    )

    first_pin = await _link_expense(client, token, wallet_id, cost_id)
    assert first_pin == _days(-9)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 9
    assert state["overdue"] is True

    await _link_expense(client, token, wallet_id, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 8
    assert state["overdue"] is True


async def test_paying_the_whole_backlog_clears_overdue(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Clear Wallet")
    cost_id = await _create_cost(
        client, token, name="Clear Coffee", start_date=_days(-9)
    )

    for _ in range(10):
        await _link_expense(client, token, wallet_id, cost_id)

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["overdue"] is False


async def test_future_occurrences_are_never_counted_as_unpaid(
    client: AsyncClient,
) -> None:
    """A cost whose Occurrences are all due after today has no Backlog, even
    with nothing paid — future Occurrences appear as the next due date, not
    as unpaid. Paying one ahead (pinning a future Occurrence) changes
    nothing: the badge still reads zero."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Future Wallet")
    cost_id = await _create_cost(
        client, token, name="Future Rent", start_date=_days(5)
    )

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["overdue"] is False
    assert state["next_due_date"] == _days(5)

    pin = await _link_expense(client, token, wallet_id, cost_id)
    assert pin == _days(5)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["overdue"] is False


async def test_an_occurrence_due_today_counts_in_the_backlog(
    client: AsyncClient,
) -> None:
    """Backlog counts "today or earlier" (CONTEXT.md): a cost created today
    is immediately one behind until its first payment lands."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Today Wallet")
    cost_id = await _create_cost(
        client, token, name="Today Coffee", start_date=_days(0)
    )

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 1
    assert state["overdue"] is True

    await _link_expense(client, token, wallet_id, cost_id)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["overdue"] is False


async def test_the_override_shifts_which_occurrences_are_due(
    client: AsyncClient,
) -> None:
    """The rent example: Occurrences on the 15th, due on the 1st. The due
    date — not the Occurrence's own date — decides the Backlog: with today
    inside month M, the Occurrences of M-3, M-2, M-1, and M are all due on
    or before today (the M one due the 1st, ahead of its own date)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Override Wallet")
    cost_id = await _create_cost(
        client,
        token,
                name="Override Rent",
        start_date=_month_15(3),
        interval_unit="months",
        due_day=1,
    )

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 4
    assert state["overdue"] is True

    # Paying the oldest two (the M-3 and M-2 Occurrences) leaves two.
    first_pin = await _link_expense(client, token, wallet_id, cost_id)
    assert first_pin == _month_15(3)
    second_pin = await _link_expense(client, token, wallet_id, cost_id)
    assert second_pin == _month_15(2)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 2
    assert state["overdue"] is True


async def test_editing_interval_or_start_date_never_unpays(
    client: AsyncClient,
) -> None:
    """Editing the definition reshapes only the derived future: the stored
    pin never moves, and the Occurrence it covers is never counted back into
    the Backlog — even when the edit moves it into the past or out of the
    sequence entirely."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Edit Backlog Wallet")
    cost_id = await _create_cost(
        client, token, name="Edit Backlog", start_date=_days(-4)
    )
    pin = await _link_expense(client, token, wallet_id, cost_id)
    assert pin == _days(-4)

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 4
    assert state["overdue"] is True

    # Start date pushed further back: the sequence now covers ten days, the
    # pinned one still paid — 10 minus 1.
    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"start_date": _days(-9)},
        headers=_auth(token),
    )
    assert response.status_code == 200
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 9
    assert state["overdue"] is True

    # Interval widened to every 2 days: the sequence is now 10 days ago, 8,
    # 6, 4, 2 — the pinned day (4 days ago) fell out of it entirely, so the
    # Backlog is the whole new sequence. The pin is untouched either way.
    response = await client.patch(
        f"/recurring-costs/{cost_id}",
        json={"interval_value": 2},
        headers=_auth(token),
    )
    assert response.status_code == 200
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 5
    assert state["overdue"] is True

    # The linked Expense still pins the same Occurrence — never reassigned.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    linked = next(item for item in items if item["recurring_cost_id"] == cost_id)
    assert linked["occurrence_date"] == _days(-4)

    # A new link pays the reshaped sequence's oldest Unpaid Occurrence.
    assert await _link_expense(client, token, wallet_id, cost_id) == _days(-9)


async def test_the_list_exposes_the_state_read_per_cost(
    client: AsyncClient,
) -> None:
    """The state read is per cost in the list — what the screen's summary
    line ("X costs overdue · N unpaid occurrences") adds up from."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B58 Summary Wallet")
    behind_id = await _create_cost(
        client, token, name="Summary Behind", start_date=_days(-2)
    )
    ahead_id = await _create_cost(
        client, token, name="Summary Ahead", start_date=_days(30),
        interval_unit="months",
    )

    behind = await _cost_state(client, token, behind_id)
    ahead = await _cost_state(client, token, ahead_id)
    assert behind["backlog_count"] == 3
    assert behind["overdue"] is True
    assert ahead["backlog_count"] == 0
    assert ahead["overdue"] is False
    # What the screen's summary line adds up from these two: one cost
    # overdue, three unpaid occurrences.
