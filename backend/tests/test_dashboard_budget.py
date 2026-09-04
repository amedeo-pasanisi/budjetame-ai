"""Dashboard Budget card — issue #65, through the HTTP seam.

GET /dashboard/budget returns the current Europe/Rome month's Budget:
monthly_spendable, daily_allowance, spendable_today. Deliberately no month
parameter: the Budget is current-month-only by product decision (the summary
endpoint stays month-parameterized and untouched). Everything is derived,
nothing stored (ADR-0001): Monthly Spendable sums the Recurring Income
Occurrences due in the month minus the Recurring Cost Occurrences due in it —
counted by due date whether paid or not, day-clamping included —
and Spendable Today is the allowance accrued from the 1st through today minus
the Discretionary Expenses dated in that span: linked Expenses never drain,
one-off Incomes never fill, Transfers and Opening Balances never touch it,
and an Expense dated later in the month doesn't drain until its date arrives.

Tests share one Postgres database and one seeded Account, so assertions are
delta-based: each test reads the budget before creating its data and asserts
the *change* it caused, plus the budget's shape. Hand-worked expectations
use month-independent constructions (occurrences due on the 1st or the
clamped last day), so they hold no matter when the suite runs. The pure
arithmetic itself (flooring, accrual, the remainder) is pinned with fixed
months in test_budget.py; here the expected values are recomputed from the
spec's integer rule, not from the module's code.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import (
    Account,
    RecurringCost,
    Transaction,
    TransactionType,
    Wallet,
    WalletType,
)

from conftest import (
    SEED_EMAIL,
    SEED_PASSWORD,
    delete_account,
    insert_foreign_account,
)

ROME = ZoneInfo("Europe/Rome")


async def _login(
    client: AsyncClient, email: str = SEED_EMAIL, password: str = SEED_PASSWORD
) -> str:
    response = await client.post(
        "/auth/login", json={"email": email, "password": password}
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


async def _budget(client: AsyncClient, token: str) -> dict:
    response = await client.get("/dashboard/budget", headers=_auth(token))
    assert response.status_code == 200
    return response.json()


def _current_month() -> str:
    """The month the endpoint buckets in: today's Europe/Rome calendar month."""
    return datetime.now(ROME).strftime("%Y-%m")


def _today() -> str:
    """Today's Europe/Rome calendar day, as YYYY-MM-DD."""
    return datetime.now(ROME).strftime("%Y-%m-%d")


def _days_in_current_month() -> int:
    year, month = (int(part) for part in _current_month().split("-"))
    if month == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, month + 1, 1)
    return (first_next - timedelta(days=1)).day


def _first_day_of_current_month() -> str:
    return f"{_current_month()}-01"


def _last_day_of_current_month() -> str:
    return f"{_current_month()}-{_days_in_current_month():02d}"


def _first_day_of_next_month() -> str:
    last = date.fromisoformat(_last_day_of_current_month())
    return (last + timedelta(days=1)).isoformat()


def _previous_month() -> str:
    """The Europe/Rome month before the current one, as YYYY-MM."""
    year, month = (int(part) for part in _current_month().split("-"))
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _mid_previous_month() -> str:
    """A safe calendar day (the 15th) of the previous month."""
    return f"{_previous_month()}-15"


def _last_month_holding_day(day: int) -> str:
    """The most recent month before the current one that can hold `day`,
    as YYYY-MM-DD on `day` itself. A month lacking a 31st always follows a
    31-day month, so at most two months back are ever needed — a valid
    anchor for clamp-exercising constructions no matter when the suite
    runs."""
    year, month = (int(part) for part in _current_month().split("-"))
    for back in (1, 2, 3):
        total = month - 1 - back
        y = year + total // 12
        m = total % 12 + 1
        last = _days_in_month(y, m)
        if day <= last:
            return f"{y}-{m:02d}-{day:02d}"
    raise AssertionError("no month can hold the day")


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, month + 1, 1)
    return (first_next - timedelta(days=1)).day


async def _create_recurring_cost(
    client: AsyncClient, token: str, **overrides: object
) -> int:
    """A monthly cost started on the 15th of last month — exactly one
    Occurrence due in the current month (its 15th). Tests override what
    they exercise."""
    payload: dict[str, object] = {
        "name": f"Budget cost {uuid4().hex[:8]}",
        "amount": "500.00",
        "interval_value": 1,
        "interval_unit": "months",
        "start_date": _mid_previous_month(),
    }
    payload.update(overrides)
    response = await client.post(
        "/recurring-costs", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_recurring_income(
    client: AsyncClient, token: str, **overrides: object
) -> int:
    """A monthly income started on the 1st of this month — exactly one
    Occurrence due in the current month (k=0, on the 1st)."""
    payload: dict[str, object] = {
        "name": f"Budget income {uuid4().hex[:8]}",
        "amount": "3000.00",
        "interval_value": 1,
        "interval_unit": "months",
        "start_date": _first_day_of_current_month(),
    }
    payload.update(overrides)
    response = await client.post(
        "/recurring-incomes", json=payload, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_expense(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    amount: str,
    date: str,
    recurring_cost_id: int | None = None,
) -> int:
    body: dict = {
        "type": "expense",
        "amount": amount,
        "date": date,
        "wallet_id": wallet_id,
    }
    if recurring_cost_id is not None:
        body["recurring_cost_id"] = recurring_cost_id
    response = await client.post("/transactions", json=body, headers=_auth(token))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _floor_divide(amount_cents: int, days: int) -> Decimal:
    """The spec's floor rule as pure integer arithmetic: amount ÷ days,
    floored to the cent (ADR-0012) — an independent formulation from the
    module's Decimal quantize."""
    return (Decimal(amount_cents // days) / 100).quantize(Decimal("0.01"))


def _accrued(amount_cents: int, days: int, today: date) -> Decimal:
    """The spec's accrual rule: one floored Daily Allowance per calendar day
    from the 1st through today, plus the whole-cent remainder on the last
    day only (ADR-0012), as integer arithmetic."""
    daily_cents = amount_cents // days
    accrued_cents = daily_cents * today.day
    if today.day == days:
        accrued_cents += amount_cents - daily_cents * days
    return (Decimal(accrued_cents) / 100).quantize(Decimal("0.01"))


# --- shape and empty state ------------------------------------------------

async def test_dashboard_budget_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/dashboard/budget")).status_code == 401


async def test_dashboard_budget_shape_and_empty_state_for_a_fresh_account(
    client: AsyncClient, database_url: str
) -> None:
    """A fresh Account — no Wallets, no Transactions, no Recurring
    definitions — sees an all-zero Budget: nothing due, nothing to spend.
    The shared seeded Account's data never leaks in (ADR-0003)."""
    email = "fresh-budget@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")

        budget = await _budget(client, token)

        assert budget["month"] == _current_month()
        assert budget["monthly_spendable"] == "0.00"
        assert budget["daily_allowance"] == "0.00"
        assert budget["spendable_today"] == "0.00"
    finally:
        delete_account(database_url, account_id)


async def test_monthly_spendable_sums_the_occurrences_due_in_the_month(
    client: AsyncClient, database_url: str
) -> None:
    """The Monthly Spendable is the Recurring Income Occurrences due in the
    month minus the Recurring Cost Occurrences due in it, counted by due
    date whether paid or not: an income due on the 1st and a cost due on
    the 15th both count, and a cost with no payment at all still counts
    (the spec's due-date rule)."""
    email = "budget-sum@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        wallet = await _create_wallet(client, token, "Budget Sum Wallet")
        # One income Occurrence due this month (start = the 1st) and one
        # cost Occurrence due on the 15th of this month.
        await _create_recurring_income(
            client, token, name="Budget Sum Salary", amount="3000.00"
        )
        await _create_recurring_cost(
            client, token, name="Budget Sum Rent", amount="500.00"
        )

        budget = await _budget(client, token)

        days = _days_in_current_month()
        assert budget["monthly_spendable"] == "2500.00"
        assert budget["daily_allowance"] == str(_floor_divide(250000, days))
        assert budget["spendable_today"] == str(
            _accrued(250000, days, date.fromisoformat(_today()))
        )
    finally:
        delete_account(database_url, account_id)


# --- the due-date rule: paid or not, by due date, not payment date --------

async def test_an_occurrence_counts_in_its_due_month_not_the_payment_month(
    client: AsyncClient, database_url: str
) -> None:
    """A cost's Occurrence due on the 15th of this month counts in this
    month's Monthly Spendable even when its payment — the linked Expense —
    is dated in the next month: counted by due date whether paid or not, so
    a late-paid Occurrence lands in its due month, never the payment month
    (issue #65). The linked Expense itself doesn't drain Spendable Today
    either: it's linked, and its date hasn't arrived."""
    email = "budget-due-date@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        wallet = await _create_wallet(client, token, "Due Date Wallet")
        cost = await _create_recurring_cost(
            client, token, name="Due Date Rent", amount="500.00"
        )
        # The payment is recorded next month — late, from this month's
        # point of view. The link pays the oldest Unpaid Occurrence (last
        # month's), which is irrelevant to the Budget: the Occurrence due
        # on the 15th still counts here, unpaid or not.
        await _create_expense(
            client,
            token,
            wallet,
            "500.00",
            _first_day_of_next_month(),
            recurring_cost_id=cost,
        )

        budget = await _budget(client, token)

        assert budget["monthly_spendable"] == "-500.00"
        assert budget["daily_allowance"] == "0.00"
        assert budget["spendable_today"] == "0.00"
    finally:
        delete_account(database_url, account_id)


async def test_all_interval_units_count_by_occurrence_date(
    client: AsyncClient, database_url: str
) -> None:
    """Monthly Spendable sums one amount per Occurrence date per definition
    across every interval unit, with the 29–31 clamping: a daily cost
    occurring every day of the month, a weekly cost occurring every 7 days
    from the 1st, a monthly cost anchored on a past 31st (its occurrence
    this month clamps to the last day of shorter months), and a yearly
    income anchored in the current month — each construction puts exactly
    its expected Occurrences in the current month no matter when the suite
    runs, and the expected total is hand-worked integer arithmetic."""
    email = "budget-intervals@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        wallet = await _create_wallet(client, token, "Intervals Wallet")
        days = _days_in_current_month()
        # Daily: one occurrence on every day of the month (k = 0 .. days-1).
        await _create_recurring_cost(
            client,
            token,
            name="Intervals Daily",
            amount="1.00",
            interval_value=1,
            interval_unit="days",
            start_date=_first_day_of_current_month(),
        )
        # Weekly: on the 1st and every 7 days after.
        await _create_recurring_cost(
            client,
            token,
            name="Intervals Weekly",
            amount="2.00",
            interval_value=1,
            interval_unit="weeks",
            start_date=_first_day_of_current_month(),
        )
        # Monthly from a past 31st: the month's own occurrence is the 31st,
        # clamped to the last day of shorter months.
        await _create_recurring_cost(
            client,
            token,
            name="Intervals Clamped Month",
            amount="4.00",
            start_date=_last_month_holding_day(31),
        )
        # Yearly anchored in the current month: the k=0 Occurrence (the
        # 15th) is this month's.
        await _create_recurring_income(
            client,
            token,
            name="Intervals Yearly",
            amount="8.00",
            interval_unit="years",
            start_date=f"{_current_month()}-15",
        )

        budget = await _budget(client, token)

        weekly_count = (days - 1) // 7 + 1
        # incomes (8.00 × 1) − costs (1.00 × days + 2.00 × weekly + 4.00 × 1).
        expected_cents = 800 - (100 * days + 200 * weekly_count + 400)
        assert budget["monthly_spendable"] == str(
            (Decimal(expected_cents) / 100).quantize(Decimal("0.01"))
        )
    finally:
        delete_account(database_url, account_id)


async def test_dashboard_budget_is_scoped_to_the_account(
    client: AsyncClient, database_url: str
) -> None:
    """A foreign Account's Recurring definitions and Expenses never leak
    into this Account's Budget (ADR-0003: every query is scoped by Account
    id)."""
    token = await _login(client)
    before = await _budget(client, token)
    account_id = insert_foreign_account(database_url, "budget-neighbor@budjetame.dev")
    try:
        engine = create_db_engine(database_url)
        with Session(engine) as session:
            wallet = Wallet(
                account_id=account_id,
                name="Their Money",
                type=WalletType.CHECKING.value,
            )
            session.add(wallet)
            session.commit()
            session.add(
                RecurringCost(
                    account_id=account_id,
                    name="Their Rent",
                    amount="500.00",
                    interval_value=1,
                    interval_unit="months",
                    start_date=date(2030, 1, 1),
                )
            )
            session.add(
                Transaction(
                    account_id=account_id,
                    wallet_id=wallet.id,
                    type=TransactionType.EXPENSE.value,
                    amount="99.00",
                )
            )
            session.commit()
        engine.dispose()

        after = await _budget(client, token)

        assert after == before
    finally:
        delete_account(database_url, account_id)


# --- what drains Spendable Today: Discretionary Expenses only -------------

async def test_spendable_today_drains_only_discretionary_expenses(
    client: AsyncClient,
) -> None:
    """Only Discretionary Expenses drain Spendable Today: a linked Expense
    (paying a Recurring Cost) never drains, a one-off Income never fills,
    and Transfers, Opening Balances, and Contact Wallet movements never
    touch it — the month's Budget frame is blind to them (issue #65).
    Monthly Spendable, by contrast, still counts the cost's Occurrence
    whether or not a linked Expense pays it."""
    token = await _login(client)
    before = await _budget(client, token)
    wallet = await _create_wallet(client, token, "Drain Wallet")
    cost = await _create_recurring_cost(client, token, name="Drain Rent")
    # The linked Expense pays the cost: Spendable Today must not move, but
    # the cost's Occurrence still counts in the Monthly Spendable.
    await _create_expense(
        client, token, wallet, "999.00", _today(), recurring_cost_id=cost
    )
    after_link = await _budget(client, token)
    assert Decimal(after_link["spendable_today"]) == Decimal(before["spendable_today"])
    assert Decimal(after_link["monthly_spendable"]) == Decimal(
        before["monthly_spendable"]
    ) + Decimal("-500.00")
    # An unlinked Expense dated today drains.
    await _create_expense(client, token, wallet, "100.00", _today())
    after_drain = await _budget(client, token)
    assert Decimal(after_drain["spendable_today"]) == Decimal(
        after_link["spendable_today"]
    ) + Decimal("-100.00")
    # A one-off Income, a Transfer, an Opening Balance, and a Contact
    # Wallet movement never fill or drain.
    await client.post(
        "/transactions",
        json={"type": "income", "amount": "999.00", "date": _today(), "wallet_id": wallet},
        headers=_auth(token),
    )
    savings = await _create_wallet(client, token, "Drain Savings")
    await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "999.00",
            "date": _today(),
            "source_wallet_id": wallet,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )
    await _create_wallet(client, token, "Drain OB", "checking")
    marco = await _create_wallet(client, token, "Drain Marco", "contact")
    await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "999.00",
            "date": _today(),
            "source_wallet_id": wallet,
            "destination_wallet_id": marco,
        },
        headers=_auth(token),
    )

    after_rest = await _budget(client, token)

    assert after_rest["spendable_today"] == after_drain["spendable_today"]
    assert after_rest["monthly_spendable"] == after_link["monthly_spendable"]


async def test_an_expense_later_in_the_month_does_not_drain_until_its_date(
    client: AsyncClient,
) -> None:
    """Spendable Today subtracts the Discretionary Expenses dated from the
    1st through today only: an unlinked Expense dated later in the month is
    real spending the day its date arrives, not before (issue #65)."""
    today = date.fromisoformat(_today())
    if today.day == _days_in_current_month():
        pytest.skip("today is the last day of the month: no later day exists")
    token = await _login(client)
    before = await _budget(client, token)
    wallet = await _create_wallet(client, token, "Future Drain Wallet")
    later = today + timedelta(days=1)
    await _create_expense(client, token, wallet, "50.00", later.isoformat())
    after_future = await _budget(client, token)
    assert after_future["spendable_today"] == before["spendable_today"]
    assert after_future["monthly_spendable"] == before["monthly_spendable"]
    # The same amount dated today does drain.
    await _create_expense(client, token, wallet, "50.00", _today())
    after_today = await _budget(client, token)
    assert Decimal(after_today["spendable_today"]) == Decimal(
        before["spendable_today"]
    ) + Decimal("-50.00")


async def test_spendable_today_is_sent_raw_and_can_be_negative(
    client: AsyncClient, database_url: str
) -> None:
    """Spendable Today is sent raw and possibly negative: with nothing due
    in the month (allowance 0) and €1000 already spent, the card reads
    −1000.00 — the frontend renders it as 0 until future accruals repay it
    (issue #63, story 12; CONTEXT.md)."""
    email = "budget-negative@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        wallet = await _create_wallet(client, token, "Negative Wallet")
        await _create_expense(client, token, wallet, "1000.00", _first_day_of_current_month())

        budget = await _budget(client, token)

        assert budget["monthly_spendable"] == "0.00"
        assert budget["daily_allowance"] == "0.00"
        assert budget["spendable_today"] == "-1000.00"
    finally:
        delete_account(database_url, account_id)


async def test_a_negative_month_floors_the_daily_allowance_at_zero(
    client: AsyncClient, database_url: str
) -> None:
    """A month whose due costs exceed its due incomes is a negative Monthly
    Spendable: the Daily Allowance floors at 0, so the card never suggests
    spending a negative amount (issue #63, story 14), and Spendable Today
    still drains by what was actually spent."""
    email = "budget-negative-month@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        wallet = await _create_wallet(client, token, "Negative Month Wallet")
        await _create_recurring_income(
            client, token, name="Neg Month Salary", amount="1000.00"
        )
        await _create_recurring_cost(
            client, token, name="Neg Month Rent", amount="2000.00"
        )

        budget = await _budget(client, token)

        assert budget["monthly_spendable"] == "-1000.00"
        assert budget["daily_allowance"] == "0.00"
        assert budget["spendable_today"] == "0.00"
        # Spending still drains, going further below zero.
        await _create_expense(client, token, wallet, "25.00", _today())
        assert (await _budget(client, token))["spendable_today"] == "-25.00"
    finally:
        delete_account(database_url, account_id)


# --- Skipped Occurrences never count (ADR-0016) ---------------------------

async def test_a_skipped_cost_occurrence_never_counts_in_monthly_spendable(
    client: AsyncClient, database_url: str
) -> None:
    """Monthly Spendable counts Occurrences by due date, paid or not — but
    a Skipped Occurrence never counts (ADR-0016): the user does not have to
    pay it, so the Budget must not pretend the money leaves. Excusing this
    month's Occurrence (per-date write, ADR-0026) restores the month
    exactly."""
    email = "budget-skip-cost@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        await _create_wallet(client, token, "Skip Cost Wallet")
        # One Occurrence due this month: k=0 on the 1st, due the 1st.
        cost = await _create_recurring_cost(
            client,
            token,
            name="Skip Cost Rent",
            amount="500.00",
            start_date=_first_day_of_current_month(),
        )
        after_create = await _budget(client, token)
        assert after_create["monthly_spendable"] == "-500.00"

        response = await client.put(
            f"/recurring-costs/{cost}/occurrences/{_first_day_of_current_month()}",
            json={"skipped": True},
            headers=_auth(token),
        )
        assert response.status_code == 200
        assert {"date": _first_day_of_current_month(), "skipped": True} in response.json()

        after_skip = await _budget(client, token)
        assert after_skip["monthly_spendable"] == "0.00"
        assert after_skip["daily_allowance"] == "0.00"
        assert after_skip["spendable_today"] == "0.00"
    finally:
        delete_account(database_url, account_id)


async def test_a_skipped_income_occurrence_never_counts_in_monthly_spendable(
    client: AsyncClient, database_url: str
) -> None:
    """The income mirror: an income the user will not receive never fills
    the month. Excusing today's Occurrence (per-date write, ADR-0026)
    drops the Monthly Spendable by the full amount."""
    email = "budget-skip-income@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")
        await _create_wallet(client, token, "Skip Income Wallet")
        income = await _create_recurring_income(
            client, token, name="Skip Income Salary", amount="3000.00"
        )
        after_create = await _budget(client, token)
        assert after_create["monthly_spendable"] == "3000.00"

        # The monthly income's only Occurrence due in this month is k=0,
        # on the 1st.
        response = await client.put(
            f"/recurring-incomes/{income}/occurrences/{_first_day_of_current_month()}",
            json={"skipped": True},
            headers=_auth(token),
        )
        assert response.status_code == 200
        assert {
            "date": _first_day_of_current_month(),
            "skipped": True,
        } in response.json()

        after_skip = await _budget(client, token)
        assert after_skip["monthly_spendable"] == "0.00"
        assert after_skip["daily_allowance"] == "0.00"
        assert after_skip["spendable_today"] == "0.00"
    finally:
        delete_account(database_url, account_id)


# --- retroactive recompute: edits and deletes reshape the month -----------

async def test_editing_a_recurring_definition_recomputes_the_month(
    client: AsyncClient,
) -> None:
    """Editing a Recurring definition mid-month recomputes the Budget
    retroactively from the 1st: changing the amount moves the Monthly
    Spendable, and moving the start date out of the month removes the
    Occurrence entirely — nothing is stored, everything is derived on read
    (ADR-0001)."""
    token = await _login(client)
    before = await _budget(client, token)
    wallet = await _create_wallet(client, token, "Edit Def Wallet")
    cost = await _create_recurring_cost(client, token, name="Edit Def Rent")
    after_create = await _budget(client, token)
    assert Decimal(after_create["monthly_spendable"]) == Decimal(
        before["monthly_spendable"]
    ) + Decimal("-500.00")

    response = await client.patch(
        f"/recurring-costs/{cost}",
        json={"amount": "700.00"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    after_amount = await _budget(client, token)
    assert Decimal(after_amount["monthly_spendable"]) == Decimal(
        before["monthly_spendable"]
    ) + Decimal("-700.00")

    # Moving the start date to next month removes every Occurrence due this
    # month: the Budget forgets the cost.
    response = await client.patch(
        f"/recurring-costs/{cost}",
        json={"start_date": _first_day_of_next_month()},
        headers=_auth(token),
    )
    assert response.status_code == 200
    after_move = await _budget(client, token)
    assert after_move["monthly_spendable"] == before["monthly_spendable"]

    # Deleting the definition changes nothing further — it was already gone
    # from the month — and its linked expenses (none here) would survive as
    # ordinary ones.
    response = await client.delete(f"/recurring-costs/{cost}", headers=_auth(token))
    assert response.status_code == 204
    assert (await _budget(client, token))["monthly_spendable"] == before["monthly_spendable"]


async def test_editing_or_deleting_a_transaction_recomputes_the_month(
    client: AsyncClient,
) -> None:
    """Editing or deleting a Transaction mid-month recomputes Spendable
    Today retroactively from the 1st: the drain follows the Expense's
    amount, and deleting it restores the month exactly (ADR-0001)."""
    token = await _login(client)
    before = await _budget(client, token)
    wallet = await _create_wallet(client, token, "Edit Tx Wallet")
    expense = await _create_expense(client, token, wallet, "100.00", _today())
    after_create = await _budget(client, token)
    assert Decimal(after_create["spendable_today"]) == Decimal(
        before["spendable_today"]
    ) + Decimal("-100.00")

    response = await client.patch(
        f"/transactions/{expense}",
        json={"amount": "150.00"},
        headers=_auth(token),
    )
    assert response.status_code == 200
    after_amount = await _budget(client, token)
    assert Decimal(after_amount["spendable_today"]) == Decimal(
        before["spendable_today"]
    ) + Decimal("-150.00")

    response = await client.delete(f"/transactions/{expense}", headers=_auth(token))
    assert response.status_code == 200
    assert (await _budget(client, token))["spendable_today"] == before["spendable_today"]
