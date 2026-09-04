"""The Backlog and the state read for Recurring Incomes — issue #62,
through the HTTP seam. The mirror of the cost side's #58 tests
(ADR-0011).

Every Recurring Income read exposes its derived state: `backlog_count`
(Unpaid Occurrences whose due date is today or earlier in Europe/Rome — the
"N unpaid" badge) and the existing `next_due_date`. The count is derived on the fly from the definition and the
stored link pins (issue #61): receiving an Occurrence drops the count by
one, and editing the income's interval or start date reshapes only the
derived future — an Occurrence covered by a link is never counted back in,
and the pin on the linked Income never moves.

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
    start of the monthly Backlog tests (own-date judging, ADR-0024). The
    month arithmetic is
    plain calendar stepping, matching how the pure module walks months."""
    today = _today()
    total = today.month - 1 - offset
    year = today.year + total // 12
    month = total % 12 + 1
    return date(year, month, 15).isoformat()


def _month_1(offset: int) -> str:
    """The 1st of the month `offset` months before today's month — always
    due on or before today, whatever the day of the month the suite runs
    on."""
    return _month_15(offset)[:8] + "01"


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


async def _create_income(
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
        "/recurring-incomes", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _link_income(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    income_id: int,
) -> str:
    """An Income linked to `income_id`, returning the pinned Occurrence date."""
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


async def _income_state(
    client: AsyncClient, token: str, income_id: int
) -> dict:
    """The API's derived state for one income, found in the list."""
    response = await client.get("/recurring-incomes", headers=_auth(token))
    assert response.status_code == 200
    return next(income for income in response.json() if income["id"] == income_id)


async def test_a_daily_income_missed_for_ten_days_reads_ten_unpaid(
    client: AsyncClient,
) -> None:
    """The original question made concrete: a daily income starting nine days
    ago has ten Occurrences due today or earlier — the first ten days of its
    life — all Unpaid, so the badge reads "10 unpaid". Today's Occurrence is due
    today, so it is both the Backlog's newest item and the next due date."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Backlog Wallet")
    income_id = await _create_income(
        client, token, name="Backlog Freelance", start_date=_days(-9)
    )

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 10
    assert state["next_due_date"] == _days(0)


async def test_receiving_one_occurrence_drops_the_count_to_nine(
    client: AsyncClient,
) -> None:
    """Receiving per the linking rules — the oldest Unpaid Occurrence —
    clears one item: 10 unpaid becomes 9. Each further link drops one more."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Receive One Wallet")
    income_id = await _create_income(
        client, token, name="Receive One Freelance", start_date=_days(-9)
    )

    first_pin = await _link_income(client, token, wallet_id, income_id)
    assert first_pin == _days(-9)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 9

    await _link_income(client, token, wallet_id, income_id)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 8


async def test_receiving_the_whole_backlog_clears_the_badge(
    client: AsyncClient,
) -> None:
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Clear Wallet")
    income_id = await _create_income(
        client, token, name="Clear Freelance", start_date=_days(-9)
    )

    for _ in range(10):
        await _link_income(client, token, wallet_id, income_id)

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 0


async def test_future_occurrences_are_never_counted_as_unpaid(
    client: AsyncClient,
) -> None:
    """An income whose Occurrences are all due after today has no Backlog,
    even with nothing received — future Occurrences appear as the next due
    date, not as unpaid. Receiving one ahead (pinning a future Occurrence)
    changes nothing: the badge still reads zero."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Future Wallet")
    income_id = await _create_income(
        client, token, name="Future Rent", start_date=_days(5)
    )

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(5)

    pin = await _link_income(client, token, wallet_id, income_id)
    assert pin == _days(5)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 0


async def test_an_occurrence_due_today_counts_in_the_backlog(
    client: AsyncClient,
) -> None:
    """Backlog counts "today or earlier" (CONTEXT.md): an income created
    today is immediately one behind until its first receipt lands."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Today Wallet")
    income_id = await _create_income(
        client, token, name="Today Freelance", start_date=_days(0)
    )

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 1

    await _link_income(client, token, wallet_id, income_id)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 0


async def test_a_monthly_income_backlog_reads_its_own_occurrence_dates(
    client: AsyncClient,
) -> None:
    """The mirror of the cost-side own-date test: the Backlog judges each
    Occurrence by its own date (ADR-0024). A monthly income starting on the
    1st of the month M-3: with today inside month M, the Occurrences of M-3,
    M-2, M-1, and M are all due on or before today (the M one on the 1st)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Own-date Wallet")
    income_id = await _create_income(
        client,
        token,
        name="Salary on the 1st",
        start_date=_month_1(3),
        interval_unit="months",
    )

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 4

    # Receiving the oldest two (the M-3 and M-2 Occurrences) leaves two.
    first_pin = await _link_income(client, token, wallet_id, income_id)
    assert first_pin == _month_1(3)
    second_pin = await _link_income(client, token, wallet_id, income_id)
    assert second_pin == _month_1(2)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 2


async def test_editing_interval_or_start_date_never_unpays(
    client: AsyncClient,
) -> None:
    """Editing the definition reshapes only the derived future: the stored
    pin never moves, and the Occurrence it covers is never counted back into
    the Backlog — even when the edit moves it into the past or out of the
    sequence entirely."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Edit Backlog Wallet")
    income_id = await _create_income(
        client, token, name="Edit Backlog", start_date=_days(-4)
    )
    pin = await _link_income(client, token, wallet_id, income_id)
    assert pin == _days(-4)

    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 4

    # Start date pushed further back: the sequence now covers ten days, the
    # pinned one still received — 10 minus 1.
    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"start_date": _days(-9)},
        headers=_auth(token),
    )
    assert response.status_code == 200
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 9

    # Interval widened to every 2 days: the sequence is now 10 days ago, 8,
    # 6, 4, 2 — the pinned day (4 days ago) fell out of it entirely, so the
    # Backlog is the whole new sequence. The pin is untouched either way.
    response = await client.patch(
        f"/recurring-incomes/{income_id}",
        json={"interval_value": 2},
        headers=_auth(token),
    )
    assert response.status_code == 200
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 5

    # The linked Income still pins the same Occurrence — never reassigned.
    items = (await client.get("/transactions", headers=_auth(token))).json()["items"]
    linked = next(item for item in items if item["recurring_income_id"] == income_id)
    assert linked["occurrence_date"] == _days(-4)

    # A new link receives the reshaped sequence's oldest Unpaid Occurrence.
    assert await _link_income(client, token, wallet_id, income_id) == _days(-9)


async def test_the_list_exposes_the_state_read_per_income(
    client: AsyncClient,
) -> None:
    """The state read is per income in the list — what the screen's per-card
    badge adds up from."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "B62 Summary Wallet")
    behind_id = await _create_income(
        client, token, name="Summary Behind", start_date=_days(-2)
    )
    ahead_id = await _create_income(
        client, token, name="Summary Ahead", start_date=_days(30),
        interval_unit="months",
    )

    behind = await _income_state(client, token, behind_id)
    ahead = await _income_state(client, token, ahead_id)
    assert behind["backlog_count"] == 3
    assert ahead["backlog_count"] == 0
