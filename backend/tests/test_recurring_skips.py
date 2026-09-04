"""Skipped Occurrences — ADR-0016 through ADR-0026, through the HTTP seam.

A skip excuses one Occurrence of a Recurring Cost or Recurring Income: the
user does not have to pay (or receive) it, so it never enters the Backlog,
never counts toward Monthly Spendable, and a link can never pay it — the
picker and the link walk step over it, and paying one means un-skipping it
first (ADR-0016).

The card Skip/Un-skip button is gone (ADR-0026): the Occurrences section in
the edit modal reads the definition's Occurrences — GET
/recurring-costs/{id}/occurrences: every non-Paid row (Paid history lives
in the ledger) with its skipped state, newest first — and writes a per-date
skip/un-skip — PUT /recurring-costs/{id}/occurrences/{date} with
{"skipped": bool}, idempotent, returning the refreshed read. Rows: all the
past ones (due today or earlier, today first), then the future ones —
every Skipped future Occurrence stays on the list (an excused one must
stay reachable), and the next incoming Unpaid one, the live row, heads the
list: future Occurrences reveal one at a time, so a whole month can be
excused by tapping the top row repeatedly. Each row toggles independently,
in any order — the button's queue discipline is gone. A skip still anchors
to its Occurrence's period and travels with it; deleting a definition drops
its skips.

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


async def _cost_occurrences(
    client: AsyncClient, token: str, cost_id: int
) -> list[dict]:
    """The Occurrences section's read (ADR-0026) for one cost."""
    response = await client.get(
        f"/recurring-costs/{cost_id}/occurrences", headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _income_occurrences(
    client: AsyncClient, token: str, income_id: int
) -> list[dict]:
    response = await client.get(
        f"/recurring-incomes/{income_id}/occurrences", headers=_auth(token)
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _set_cost_skipped(
    client: AsyncClient, token: str, cost_id: int, occurrence_date: str, skipped: bool
) -> list[dict]:
    """The per-Occurrence skip write (ADR-0026), returning the refreshed
    read."""
    response = await client.put(
        f"/recurring-costs/{cost_id}/occurrences/{occurrence_date}",
        json={"skipped": skipped},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _set_income_skipped(
    client: AsyncClient, token: str, income_id: int, occurrence_date: str, skipped: bool
) -> list[dict]:
    response = await client.put(
        f"/recurring-incomes/{income_id}/occurrences/{occurrence_date}",
        json={"skipped": skipped},
        headers=_auth(token),
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


def _row(rows: list[dict], occurrence_date: str) -> dict:
    """One occurrence row from a read, by date."""
    return next(row for row in rows if row["date"] == occurrence_date)


def _skipped_dates(rows: list[dict]) -> set[str]:
    """The dates the read marks excused."""
    return {row["date"] for row in rows if row["skipped"]}


# --- the Occurrences read (ADR-0026) ---------------------------------------

async def test_the_read_lists_every_unpaid_occurrence_newest_first(
    client: AsyncClient,
) -> None:
    """A daily cost missed for ten days reads eleven rows — the ten past
    Occurrences (due today or earlier, today first) and the next incoming
    one at the top — each row exactly its own date and the skipped state:
    the button-derived state (`next_skip_action`) is gone. Nothing is
    skipped yet."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Read Coffee", start_date=_days(-9)
    )

    rows = await _cost_occurrences(client, token, cost_id)

    # Newest first: the live future row on top, today under it, down to the
    # oldest (the start date, nine days ago).
    assert [row["date"] for row in rows] == [_days(d) for d in range(1, -10, -1)]
    assert all(row["skipped"] is False for row in rows)
    assert set(rows[0]) == {"date", "skipped"}


async def test_paid_occurrences_never_appear_in_the_read(
    client: AsyncClient,
) -> None:
    """Paid history lives in the ledger: once links cover the whole Backlog,
    the read shows only the next incoming Occurrence — a Paid one is never
    offered to skip or un-skip."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S26 Read Wallet")
    cost_id = await _create_cost(
        client, token, name="S26 Paid Read", start_date=_days(-9)
    )
    for _ in range(10):
        await _link_expense(client, token, wallet_id, cost_id)

    rows = await _cost_occurrences(client, token, cost_id)

    assert rows == [{"date": _days(1), "skipped": False}]


# --- per-Occurrence skip and un-skip on the past group ----------------------

async def test_skipping_the_oldest_unpaid_occurrence_drops_the_badge(
    client: AsyncClient,
) -> None:
    """PUT with {"skipped": true} on one past row excuses exactly that
    Occurrence: the read greys it (skipped True, in place), the badge drops
    by one, and every other row is untouched — the response is the
    refreshed read, so the modal swaps it in."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Skip Coffee", start_date=_days(-9)
    )
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 10

    rows = await _set_cost_skipped(
        client, token, cost_id, _days(-9), True
    )

    assert _row(rows, _days(-9)) == {"date": _days(-9), "skipped": True}
    assert len(_skipped_dates(rows)) == 1
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 9


async def test_unskipping_restores_the_occurrence(
    client: AsyncClient,
) -> None:
    """PUT with {"skipped": false} on the excused row restores it to Unpaid:
    the row comes back live and the badge counts it again."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Unskip Coffee", start_date=_days(-9)
    )
    await _set_cost_skipped(client, token, cost_id, _days(-9), True)

    rows = await _set_cost_skipped(
        client, token, cost_id, _days(-9), False
    )

    assert _skipped_dates(rows) == set()
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 10


async def test_skipping_each_past_row_clears_the_backlog_in_any_order(
    client: AsyncClient,
) -> None:
    """The button's queue discipline is gone: past rows toggle independently,
    in any order — a scrambled sequence of one skip per past Occurrence
    clears the whole Backlog (badge 10 -> 0), today's row included, and the
    skipped rows stay on the read in date order below the live row. Un-skip
    of any one restores exactly that Occurrence (badge 1)."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Clear Coffee", start_date=_days(-9)
    )

    past = list(range(-9, 1))
    rows: list[dict] = []
    for day in (-4, -9, -1, -7, -2, -6, -3, -8, -5, 0):
        rows = await _set_cost_skipped(client, token, cost_id, _days(day), True)
    assert len(_skipped_dates(rows)) == 10

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    # Every excused row stays reachable: the ten greyed rows in date order
    # under the live row (the next incoming one, tomorrow).
    assert rows[0] == {"date": _days(1), "skipped": False}
    assert [row["date"] for row in rows[1:]] == [_days(d) for d in range(0, -10, -1)]
    assert all(row["skipped"] is True for row in rows[1:])

    # Un-skipping the oldest restores exactly it: badge 1, one live past row.
    rows = await _set_cost_skipped(client, token, cost_id, _days(-9), False)
    assert _row(rows, _days(-9))["skipped"] is False
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 1


async def test_the_writes_are_idempotent(
    client: AsyncClient,
) -> None:
    """PUT states a desired state, so a double tap cannot double-flip: two
    skips of the same row leave one excused row (a second un-skip fully
    restores it), and a skip write on a row the read shows live but whose
    period a stored skip already covers is a no-op. Un-skipping a row that
    is not excused changes nothing."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Idempotent Coffee", start_date=_days(-2)
    )

    rows = await _set_cost_skipped(client, token, cost_id, _days(-2), True)
    rows = await _set_cost_skipped(client, token, cost_id, _days(-2), True)
    assert len(_skipped_dates(rows)) == 1
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 2

    rows = await _set_cost_skipped(client, token, cost_id, _days(-2), False)
    rows = await _set_cost_skipped(client, token, cost_id, _days(-2), False)
    assert _skipped_dates(rows) == set()
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 3


# --- skipping the next incoming one in advance (ADR-0026) ------------------

async def test_skipping_the_live_row_surfaces_the_following_one(
    client: AsyncClient,
) -> None:
    """Nothing due yet: the read is one live row — the next incoming
    Occurrence. Skipping it greys it in place and surfaces the following
    one above it: the next due date, the picker, and the badge all step
    over the excused Occurrence, so the whole month can be excused by
    tapping the top row repeatedly in one sitting."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Future Rent", start_date=_days(5)
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(5)
    assert state["next_unpaid_occurrence_date"] == _days(5)
    assert await _cost_occurrences(client, token, cost_id) == [
        {"date": _days(5), "skipped": False}
    ]

    rows = await _set_cost_skipped(client, token, cost_id, _days(5), True)

    assert rows[0] == {"date": _days(6), "skipped": False}
    assert _row(rows, _days(5)) == {"date": _days(5), "skipped": True}
    state = await _cost_state(client, token, cost_id)
    assert state["next_due_date"] == _days(6)
    assert state["next_unpaid_occurrence_date"] == _days(6)
    assert state["backlog_count"] == 0


async def test_repeated_future_skips_excuse_a_whole_month_in_one_sitting(
    client: AsyncClient,
) -> None:
    """Five presses excuse five incoming Occurrences one at a time: each
    press greys the top row and reveals the following one above it, until
    the read is the five greyed rows in date order under the next live one.
    The badge stays 0 and the picker and next due date walk to the first
    unexcused Occurrence."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Month Coffee", start_date=_days(5)
    )

    for offset in range(5):
        rows = await _set_cost_skipped(
            client, token, cost_id, _days(5 + offset), True
        )
        # The press greys the target and surfaces the following one on top.
        assert rows[0] == {"date": _days(6 + offset), "skipped": False}
        assert _skipped_dates(rows) == {_days(d) for d in range(5, 6 + offset)}

    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(10)
    assert state["next_unpaid_occurrence_date"] == _days(10)
    # The five greyed future rows stay on the read, in date order under the
    # live row — each one reachable for an un-skip.
    assert rows[0] == {"date": _days(10), "skipped": False}
    assert [row["date"] for row in rows[1:]] == [_days(d) for d in range(9, 4, -1)]
    assert all(row["skipped"] is True for row in rows[1:])


async def test_unskipping_a_future_row_keeps_the_later_skips_reachable(
    client: AsyncClient,
) -> None:
    """Un-skip in any order: restoring an earlier future row (it becomes the
    live row again) must not hide the excused rows after it — every excused
    Occurrence stays reachable (ADR-0026)."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Reachable Coffee", start_date=_days(5)
    )
    for offset in range(3):
        await _set_cost_skipped(client, token, cost_id, _days(5 + offset), True)

    rows = await _set_cost_skipped(client, token, cost_id, _days(5), False)

    assert rows[0] == {"date": _days(5), "skipped": False}
    assert _skipped_dates(rows) == {_days(6), _days(7)}
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 0
    assert state["next_due_date"] == _days(5)
    assert state["next_unpaid_occurrence_date"] == _days(5)


# --- skips and links --------------------------------------------------------

async def test_a_link_never_pays_a_skipped_occurrence(
    client: AsyncClient,
) -> None:
    """A Skipped Occurrence is never offered to a link: after excusing the
    oldest, the next linked Expense pins the *second* Occurrence — the
    picker and the link walk step over the skipped one (un-skipping comes
    first)."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S26 Link Wallet")
    cost_id = await _create_cost(
        client, token, name="S26 Link Coffee", start_date=_days(-9)
    )
    await _set_cost_skipped(client, token, cost_id, _days(-9), True)

    state = await _cost_state(client, token, cost_id)
    assert state["next_unpaid_occurrence_date"] == _days(-8)

    pin = await _link_expense(client, token, wallet_id, cost_id)

    assert pin == _days(-8)
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 8


async def test_paying_a_skipped_one_still_requires_unskipping_first(
    client: AsyncClient,
) -> None:
    """A Skipped Occurrence can never be paid by a link (ADR-0016): excusing
    the two oldest rows makes the third the one a link pays; un-skipping the
    oldest restores it, and only then does a link pay it."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S26 Pay Wallet")
    cost_id = await _create_cost(
        client, token, name="S26 Pay Coffee", start_date=_days(-9)
    )
    await _set_cost_skipped(client, token, cost_id, _days(-9), True)
    await _set_cost_skipped(client, token, cost_id, _days(-8), True)

    pin = await _link_expense(client, token, wallet_id, cost_id)
    assert pin == _days(-7)
    # Paid rows leave the read: -7 is covered now, -9 and -8 stay greyed.
    rows = await _cost_occurrences(client, token, cost_id)
    assert _days(-7) not in [row["date"] for row in rows]
    assert _skipped_dates(rows) == {_days(-9), _days(-8)}

    rows = await _set_cost_skipped(client, token, cost_id, _days(-9), False)
    assert _row(rows, _days(-9))["skipped"] is False
    assert (await _cost_state(client, token, cost_id))["next_unpaid_occurrence_date"] == _days(-9)

    pin = await _link_expense(client, token, wallet_id, cost_id)
    assert pin == _days(-9)
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 7


async def test_skip_rejects_a_paid_occurrence(
    client: AsyncClient,
) -> None:
    """A Paid Occurrence can never be Skipped: a link covers the oldest row,
    and the skip write on it answers 422 — the read never offers paid rows
    in the first place."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S26 Paid Skip Wallet")
    cost_id = await _create_cost(
        client, token, name="S26 Paid Skip Coffee", start_date=_days(-9)
    )
    await _link_expense(client, token, wallet_id, cost_id)

    response = await client.put(
        f"/recurring-costs/{cost_id}/occurrences/{_days(-9)}",
        json={"skipped": True},
        headers=_auth(token),
    )

    assert response.status_code == 422
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 9


async def test_skip_rejects_a_date_that_is_not_an_occurrence(
    client: AsyncClient,
) -> None:
    """The write names one of the definition's Occurrences: a date the
    sequence never produces (before the start date, or no calendar day at
    all) answers 422."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Wrong Date", start_date=_days(-9)
    )

    for bad_date in (_days(-10), "2026-13-45", "not-a-date"):
        response = await client.put(
            f"/recurring-costs/{cost_id}/occurrences/{bad_date}",
            json={"skipped": True},
            headers=_auth(token),
        )
        assert response.status_code == 422, bad_date

    assert _skipped_dates(await _cost_occurrences(client, token, cost_id)) == set()
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 10


# --- a skip travels with its Occurrence (ADR-0016) -------------------------

async def test_the_skip_survives_a_start_date_edit_http(
    client: AsyncClient,
) -> None:
    """A monthly cost starting on today's day-of-month of last month: two
    Occurrences are due (last month's and today's). Excusing the oldest,
    then moving the start date a month earlier to the 1st — which keeps
    last month's Occurrence on the sequence — keeps that Occurrence
    excused: the badge goes 2 -> 1 -> 2 (the new earlier month is unpaid)."""
    token = await _login(client)
    day = min(_today().day, 28)
    cost_id = await _create_cost(
        client,
        token,
        name="S26 Edit Rent",
        start_date=_month_15_day(1, day),
        interval_unit="months",
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 2

    await _set_cost_skipped(client, token, cost_id, _month_15_day(1, day), True)
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
    # The excused Occurrence moved with its period to the new sequence's
    # same-month Occurrence: the read still greys it.
    rows = await _cost_occurrences(client, token, cost_id)
    assert _skipped_dates(rows) == {_month_15_day(1, 1)}


async def test_a_skipped_month_becomes_the_year_when_the_interval_turns_yearly(
    client: AsyncClient,
) -> None:
    """The original question made concrete: a monthly cost with an excused
    month, converted to a yearly payment period — the skip maps from the
    month to its year, so that year's Occurrence is excused: the badge
    reads 0. Un-skipping restores it (badge 1)."""
    token = await _login(client)
    cost_id = await _create_cost(
        client,
        token,
        name="S26 Yearly Gym",
        start_date=_month_15_day(3, 1),
        interval_unit="months",
    )
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 4

    await _set_cost_skipped(client, token, cost_id, _month_15_day(3, 1), True)
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
    start = date.fromisoformat(_month_15_day(3, 1))
    assert state["next_due_date"] == date(
        start.year + 1, start.month, start.day
    ).isoformat()

    await _set_cost_skipped(client, token, cost_id, _month_15_day(3, 1), False)
    state = await _cost_state(client, token, cost_id)
    assert state["backlog_count"] == 1


async def test_deleting_a_definition_drops_its_skips(
    client: AsyncClient,
) -> None:
    """Deleting a Recurring Cost cascades its skips away: the recreated
    definition starts clean — the read shows live rows only and the badge
    reads 1."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Delete Coffee", start_date=_days(0)
    )
    await _set_cost_skipped(client, token, cost_id, _days(0), True)
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 0

    response = await client.delete(f"/recurring-costs/{cost_id}", headers=_auth(token))
    assert response.status_code == 204

    cost_id = await _create_cost(
        client, token, name="S26 Delete Coffee", start_date=_days(0)
    )
    assert _skipped_dates(await _cost_occurrences(client, token, cost_id)) == set()
    assert (await _cost_state(client, token, cost_id))["backlog_count"] == 1


# --- the card button and its endpoint are gone (ADR-0026) ------------------

async def test_the_skip_toggle_endpoint_and_next_skip_action_are_gone(
    client: AsyncClient,
) -> None:
    """The card Skip/Un-skip button is gone: its endpoint answers 404 and
    the definitions' payloads carry no `next_skip_action` — the badge is
    the only Backlog signal (ADR-0025) and skip controls moved per row."""
    token = await _login(client)
    cost_id = await _create_cost(
        client, token, name="S26 Gone Coffee", start_date=_days(0)
    )
    income_id = await _create_income(
        client, token, name="S26 Gone Salary", start_date=_days(0)
    )

    for endpoint in (
        f"/recurring-costs/{cost_id}/skip-toggle",
        f"/recurring-incomes/{income_id}/skip-toggle",
    ):
        response = await client.post(endpoint, headers=_auth(token))
        assert response.status_code == 404

    assert "next_skip_action" not in await _cost_state(client, token, cost_id)
    assert "next_skip_action" not in await _income_state(client, token, income_id)


# --- the Incomes side mirrors the contract (ADR-0011) ----------------------

async def test_incomes_mirror_the_per_occurrence_contract(
    client: AsyncClient,
) -> None:
    """Recurring Incomes behave identically: the read lists the non-Paid
    rows newest first, one skip excuses exactly the target row (badge 10 ->
    9), a link never pays a skipped one, and every past row can be excused
    row by row until the badge reads 0."""
    token = await _login(client)
    wallet_id = await _create_wallet(client, token, "S26 Income Wallet")
    income_id = await _create_income(
        client, token, name="S26 Skip Salary", start_date=_days(-9)
    )

    rows = await _income_occurrences(client, token, income_id)
    assert [row["date"] for row in rows] == [_days(d) for d in range(1, -10, -1)]
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 10

    rows = await _set_income_skipped(client, token, income_id, _days(-9), True)
    assert _row(rows, _days(-9))["skipped"] is True
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 9
    assert state["next_unpaid_occurrence_date"] == _days(-8)

    pin = await _link_income(client, token, wallet_id, income_id)
    assert pin == _days(-8)

    # Excuse the rest of the Backlog row by row: badge 0, the read still
    # shows every greyed row under the live one.
    for day in range(-7, 1):
        rows = await _set_income_skipped(
            client, token, income_id, _days(day), True
        )
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 0
    assert rows[0] == {"date": _days(1), "skipped": False}
    assert len(_skipped_dates(rows)) == 9

    # Un-skip restores exactly the oldest: badge 1, and a link now pays it.
    await _set_income_skipped(client, token, income_id, _days(-9), False)
    state = await _income_state(client, token, income_id)
    assert state["backlog_count"] == 1
    pin = await _link_income(client, token, wallet_id, income_id)
    assert pin == _days(-9)
    assert (await _income_state(client, token, income_id))["backlog_count"] == 0


# --- scoping (ADR-0003) ----------------------------------------------------

async def test_the_occurrence_reads_and_writes_are_scoped_to_the_account(
    client: AsyncClient, database_url: str
) -> None:
    """A foreign Recurring Cost's occurrence read and skip write answer 403
    — foreign data is indistinguishable from absent data (ADR-0003)."""
    token = await _login(client)
    account_id = insert_foreign_account(
        database_url, "recurring-skip-scope@budjetame.dev"
    )
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

        read = await client.get(
            f"/recurring-costs/{cost_id}/occurrences", headers=_auth(token)
        )
        assert read.status_code == 403

        write = await client.put(
            f"/recurring-costs/{cost_id}/occurrences/2030-01-01",
            json={"skipped": True},
            headers=_auth(token),
        )
        assert write.status_code == 403
    finally:
        delete_account(database_url, account_id)
