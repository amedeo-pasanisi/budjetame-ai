"""T10 — Dashboard summary.

The Dashboard shows Net Worth — the algebraic sum of all Wallet balances,
Contact and frozen (always €0) Wallets included — and the current month's
Income vs Expenses. Month bucketing happens in Europe/Rome, the app's single
fixed timezone; Opening Balance Transactions never count toward the
statistics and Transfers are neither Income nor Expense by construction.
All assertions go through the API seam (spec testing decision #1).

Tests share one Postgres database and one seeded Account, so assertions are
delta-based: each test reads the summary before creating its data and asserts
the *change* it caused, plus the summary's shape.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import create_db_engine
from app.models import Account, Transaction, TransactionType, Wallet, WalletType

from conftest import SEED_EMAIL, SEED_PASSWORD, delete_account, insert_foreign_account

ROME = ZoneInfo("Europe/Rome")

DECIMAL = {"net_worth", "income", "expenses"}


async def _login(client: AsyncClient, email: str = SEED_EMAIL, password: str = SEED_PASSWORD) -> str:
    response = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_wallet(
    client: AsyncClient, token: str, name: str, type: str, opening_balance: str = "0.00"
) -> int:
    response = await client.post(
        "/wallets",
        json={"name": name, "type": type, "opening_balance": opening_balance},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _summary(client: AsyncClient, token: str, month: str | None = None) -> dict:
    query = f"?month={month}" if month is not None else ""
    response = await client.get(f"/dashboard/summary{query}", headers=_auth(token))
    assert response.status_code == 200
    return response.json()


def _current_month() -> str:
    """The month the endpoint buckets in: today's Europe/Rome calendar month."""
    return datetime.now(ROME).strftime("%Y-%m")


def _last_day_of_current_month() -> str:
    """The last calendar day of the current Europe/Rome month, as YYYY-MM-DD."""
    return _last_day(_current_month())


def _first_day_of_next_month() -> str:
    """The first calendar day of the next Europe/Rome month, as YYYY-MM-DD."""
    last = date.fromisoformat(_last_day_of_current_month())
    return (last + timedelta(days=1)).isoformat()


def _previous_month() -> str:
    """The Europe/Rome month before the current one, as YYYY-MM."""
    year, month = (int(part) for part in _current_month().split("-"))
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _mid_previous_month() -> str:
    """A safe calendar day (the 15th) of the previous month, as YYYY-MM-DD."""
    return _day_in(_previous_month())


async def _create_category(
    client: AsyncClient, token: str, name: str, type: str
) -> int:
    response = await client.post(
        "/categories",
        json={"name": name, "type": type, "color": "#ef4444"},
        headers=_auth(token),
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_expense(
    client: AsyncClient,
    token: str,
    wallet_id: int,
    amount: str,
    date: str,
    category_id: int | None = None,
) -> None:
    body: dict = {
        "type": "expense",
        "amount": amount,
        "date": date,
        "wallet_id": wallet_id,
    }
    if category_id is not None:
        body["category_id"] = category_id
    response = await client.post("/transactions", json=body, headers=_auth(token))
    assert response.status_code == 201


async def test_dashboard_requires_authentication(client: AsyncClient) -> None:
    assert (await client.get("/dashboard/summary")).status_code == 401


async def test_net_worth_is_the_sum_of_all_wallet_balances_including_contacts(
    client: AsyncClient,
) -> None:
    """Net Worth is the algebraic sum of every Wallet balance: the Checking
    (€100) and the Cash (€50) hold money, and the Transfer of €30 to the Contact
    Wallet 'Marco' leaves him at +€30 — a receivable that counts toward Net
    Worth, so the total stays €150 (spec US21, US25)."""
    token = await _login(client)
    before = await _summary(client, token)
    checking = await _create_wallet(client, token, "NW Checking", "checking", "100.00")
    await _create_wallet(client, token, "NW Cash", "cash", "50.00")
    marco = await _create_wallet(client, token, "NW Marco", "contact", "0.00")
    await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "30.00",
            "date": _last_day_of_current_month(),
            "source_wallet_id": checking,
            "destination_wallet_id": marco,
        },
        headers=_auth(token),
    )

    after = await _summary(client, token)

    # €100 + €50 + the €30 receivable — the Transfer never changes Net Worth.
    assert Decimal(after["net_worth"]) == Decimal(before["net_worth"]) + Decimal("150.00")
    # Neither the Transfer nor the Opening Balances count toward the month's
    # income/expense statistics.
    assert after["income"] == before["income"]
    assert after["expenses"] == before["expenses"]


async def test_net_worth_is_unaffected_by_frozen_wallets(client: AsyncClient) -> None:
    """A frozen Wallet contributes its true Balance to Net Worth — €0 by
    ADR-0002 — so freezing a €0 Wallet never changes the total (US25)."""
    token = await _login(client)
    before = await _summary(client, token)
    doomed = await _create_wallet(client, token, "Freeze NW Doomed", "checking", "50.00")
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "50.00",
            "date": _last_day_of_current_month(),
            "wallet_id": doomed,
        },
        headers=_auth(token),
    )
    # The doomed Wallet nets to €0, so Net Worth is unchanged by its creation.
    assert (await _summary(client, token))["net_worth"] == before["net_worth"]

    response = await client.delete(f"/wallets/{doomed}", headers=_auth(token))
    assert response.status_code == 204

    assert (await _summary(client, token))["net_worth"] == before["net_worth"]


async def test_month_summary_counts_income_and_expenses(client: AsyncClient) -> None:
    token = await _login(client)
    before = await _summary(client, token)
    wallet = await _create_wallet(client, token, "Month Wallet", "checking", "0.00")
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "30.50",
            "date": _last_day_of_current_month(),
            "wallet_id": wallet,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": "50.00",
            "date": _last_day_of_current_month(),
            "wallet_id": wallet,
        },
        headers=_auth(token),
    )

    after = await _summary(client, token)

    assert after["month"] == _current_month()
    assert Decimal(after["income"]) == Decimal(before["income"]) + Decimal("50.00")
    assert Decimal(after["expenses"]) == Decimal(before["expenses"]) + Decimal("30.50")


async def test_month_summary_excludes_opening_balance_transactions(
    client: AsyncClient,
) -> None:
    """An Opening Balance of €100 in the current month is real money (Net Worth
    +€100) but never income or spending (CONTEXT.md)."""
    token = await _login(client)
    before = await _summary(client, token)
    await _create_wallet(client, token, "OB Wallet", "checking", "100.00")

    after = await _summary(client, token)

    assert Decimal(after["net_worth"]) == Decimal(before["net_worth"]) + Decimal("100.00")
    assert after["income"] == before["income"]
    assert after["expenses"] == before["expenses"]


async def test_month_summary_excludes_transfers(client: AsyncClient) -> None:
    token = await _login(client)
    before = await _summary(client, token)
    checking = await _create_wallet(client, token, "Transfer Summary Checking", "checking", "100.00")
    savings = await _create_wallet(client, token, "Transfer Summary Savings", "checking", "0.00")
    await client.post(
        "/transactions",
        json={
            "type": "transfer",
            "amount": "30.00",
            "date": _last_day_of_current_month(),
            "source_wallet_id": checking,
            "destination_wallet_id": savings,
        },
        headers=_auth(token),
    )

    after = await _summary(client, token)

    assert after["income"] == before["income"]
    assert after["expenses"] == before["expenses"]


async def test_month_summary_buckets_in_europe_rome(client: AsyncClient) -> None:
    """A Transaction on the last day of the current month counts; one on the
    first day of the next month does not — the same boundaries the app uses
    for every report (CONTEXT.md: bucketing in Europe/Rome)."""
    token = await _login(client)
    before = await _summary(client, token)
    wallet = await _create_wallet(client, token, "Boundary Wallet", "checking", "0.00")
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "5.00",
            "date": _last_day_of_current_month(),
            "wallet_id": wallet,
        },
        headers=_auth(token),
    )
    await client.post(
        "/transactions",
        json={
            "type": "expense",
            "amount": "7.00",
            "date": _first_day_of_next_month(),
            "wallet_id": wallet,
        },
        headers=_auth(token),
    )

    after = await _summary(client, token)

    assert Decimal(after["expenses"]) == Decimal(before["expenses"]) + Decimal("5.00")


async def test_dashboard_summary_is_scoped_to_the_account(
    client: AsyncClient, database_url: str
) -> None:
    """A foreign Account's income never leaks into this Account's summary
    (ADR-0003: every query is scoped by Account id)."""
    token = await _login(client)
    before = await _summary(client, token)
    account_id = insert_foreign_account(database_url, "dashboard-neighbor@budjetame.dev")
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
                Transaction(
                    account_id=account_id,
                    wallet_id=wallet.id,
                    type=TransactionType.INCOME.value,
                    amount="999.00",
                )
            )
            session.commit()

        engine.dispose()
        after = await _summary(client, token)

        assert after["net_worth"] == before["net_worth"]
        assert after["income"] == before["income"]
    finally:
        delete_account(database_url, account_id)


async def test_dashboard_empty_state_for_a_fresh_account(
    client: AsyncClient, database_url: str
) -> None:
    """A brand-new Account — with no Wallets and no Transactions — sees an
    all-zero Dashboard: Net Worth €0.00, no income, no expenses, and the
    summary's shape (US25)."""
    email = "fresh-dashboard@budjetame.dev"
    account_id = insert_foreign_account(database_url, email)
    try:
        token = await _login(client, email=email, password="whatever")

        summary = await _summary(client, token)

        assert summary["month"] == _current_month()
        for key in sorted(DECIMAL):
            assert summary[key] == "0.00", key
        assert summary["expenses_by_category"] == []
    finally:
        delete_account(database_url, account_id)


# --- T11: reference month/year and the expense pie ---


async def test_summary_accepts_a_reference_month(client: AsyncClient) -> None:
    """The reference month is selectable: the summary for a past month shows
    that month's Income and Expenses and echoes it in `month`; without the
    parameter the view is the current month (US27)."""
    token = await _login(client)
    baseline_past = await _summary(client, token, month=_previous_month())
    wallet = await _create_wallet(client, token, "Ref Month Wallet", "checking", "0.00")
    await _create_expense(client, token, wallet, "12.34", _mid_previous_month())
    await client.post(
        "/transactions",
        json={
            "type": "income",
            "amount": "50.00",
            "date": _last_day_of_current_month(),
            "wallet_id": wallet,
        },
        headers=_auth(token),
    )

    past = await _summary(client, token, month=_previous_month())

    assert past["month"] == _previous_month()
    assert Decimal(past["expenses"]) == Decimal(baseline_past["expenses"]) + Decimal("12.34")
    assert past["income"] == baseline_past["income"]

    current = await _summary(client, token)
    assert current["month"] == _current_month()


async def test_summary_rejects_a_bad_month(client: AsyncClient) -> None:
    token = await _login(client)

    for month in ("banana", "2026-13", "2026-8", "2026-08-01"):
        response = await client.get(
            f"/dashboard/summary?month={month}", headers=_auth(token)
        )

        assert response.status_code == 422, month


async def test_pie_sums_expenses_per_category_for_the_reference_month(
    client: AsyncClient, database_url: str
) -> None:
    """The pie groups the reference month's expenses by Category; income,
    Opening Balances and Transfers never appear in it, so the slices always sum
    to the month's total expenses (US26). A fresh Account keeps the slice set
    exact — the suite shares one seeded Account."""
    account_id = insert_foreign_account(database_url, "pie-food@budjetame.dev")
    try:
        token = await _login(client, email="pie-food@budjetame.dev", password="whatever")
        wallet = await _create_wallet(client, token, "Pie Wallet", "checking", "0.00")
        food = await _create_category(client, token, "Pie Food", "expense")
        travel = await _create_category(client, token, "Pie Travel", "expense")
        bonus = await _create_category(client, token, "Pie Bonus", "income")
        day = _mid_previous_month()
        await _create_expense(client, token, wallet, "10.00", day, food)
        await _create_expense(client, token, wallet, "20.00", day, food)
        await _create_expense(client, token, wallet, "15.00", day, travel)
        await client.post(
            "/transactions",
            json={
                "type": "income",
                "amount": "100.00",
                "date": day,
                "wallet_id": wallet,
                "category_id": bonus,
            },
            headers=_auth(token),
        )
        # A Transfer and an Opening Balance are neither Expense nor Income:
        # they must not show up as slices.
        savings = await _create_wallet(client, token, "Pie Savings", "checking", "0.00")
        await client.post(
            "/transactions",
            json={
                "type": "transfer",
                "amount": "30.00",
                "date": day,
                "source_wallet_id": wallet,
                "destination_wallet_id": savings,
            },
            headers=_auth(token),
        )
        await _create_wallet(client, token, "Pie OB Wallet", "checking", "50.00")

        summary = await _summary(client, token, month=_previous_month())

        slices = {s["name"]: s for s in summary["expenses_by_category"]}
        assert set(slices) == {"Pie Food", "Pie Travel"}
        assert slices["Pie Food"]["category_id"] == food
        assert slices["Pie Food"]["amount"] == "30.00"
        assert slices["Pie Travel"]["amount"] == "15.00"
        assert slices["Pie Travel"]["color"] == "#ef4444"
        # The pie always sums to the month's total expenses.
        total = sum(
            (Decimal(s["amount"]) for s in summary["expenses_by_category"]),
            Decimal("0.00"),
        )
        assert total == Decimal(summary["expenses"]) == Decimal("45.00")
    finally:
        delete_account(database_url, account_id)


async def test_pie_includes_an_uncategorized_slice(
    client: AsyncClient, database_url: str
) -> None:
    """Expenses without a Category appear in an "Uncategorized" slice
    (category_id null, neutral color) so the pie still sums to the month's
    total expenses (US26)."""
    account_id = insert_foreign_account(database_url, "pie-uncat@budjetame.dev")
    try:
        token = await _login(client, email="pie-uncat@budjetame.dev", password="whatever")
        wallet = await _create_wallet(client, token, "Uncat Pie Wallet", "checking", "0.00")
        food = await _create_category(client, token, "Uncat Food", "expense")
        day = _mid_previous_month()
        await _create_expense(client, token, wallet, "7.00", day, food)
        await _create_expense(client, token, wallet, "3.00", day)

        summary = await _summary(client, token, month=_previous_month())

        slices = {s["name"]: s for s in summary["expenses_by_category"]}
        assert set(slices) == {"Uncat Food", "Uncategorized"}
        assert slices["Uncategorized"]["category_id"] is None
        assert slices["Uncategorized"]["amount"] == "3.00"
        # The Uncategorized slice carries no stored color — the frontend
        # renders a neutral one (spec decision #14: presentation stays there).
        assert slices["Uncategorized"]["color"] is None
        total = sum(
            (Decimal(s["amount"]) for s in summary["expenses_by_category"]),
            Decimal("0.00"),
        )
        assert total == Decimal(summary["expenses"]) == Decimal("10.00")
    finally:
        delete_account(database_url, account_id)


async def test_pie_groups_a_deleted_category_into_uncategorized(
    client: AsyncClient, database_url: str
) -> None:
    """Deleting a Category nulls it on its Transactions (spec decision #10);
    those expenses then group into the "Uncategorized" slice, so the pie still
    sums to the month's total expenses."""
    account_id = insert_foreign_account(database_url, "pie-doomed@budjetame.dev")
    try:
        token = await _login(client, email="pie-doomed@budjetame.dev", password="whatever")
        wallet = await _create_wallet(client, token, "Doomed Pie Wallet", "checking", "0.00")
        doomed = await _create_category(client, token, "Doomed", "expense")
        await _create_expense(client, token, wallet, "5.00", _mid_previous_month(), doomed)

        delete = await client.delete(f"/categories/{doomed}", headers=_auth(token))
        assert delete.status_code == 204

        summary = await _summary(client, token, month=_previous_month())

        slices = {s["name"]: s for s in summary["expenses_by_category"]}
        assert set(slices) == {"Uncategorized"}
        assert slices["Uncategorized"]["amount"] == "5.00"
        assert Decimal(summary["expenses"]) == Decimal("5.00")
    finally:
        delete_account(database_url, account_id)


# --- T12: expense trend chart ---


def _months_ago(count: int) -> str:
    """The Europe/Rome month `count` months before the current one, YYYY-MM."""
    year, month = (int(part) for part in _current_month().split("-"))
    total = year * 12 + (month - 1) - count
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _day_in(month: str) -> str:
    """The 15th of the given YYYY-MM month, a safe day for every month."""
    return f"{month}-15"


def _last_day(month: str) -> str:
    """The last calendar day of the given YYYY-MM month, as YYYY-MM-DD."""
    year, m = (int(part) for part in month.split("-"))
    if m == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, m + 1, 1)
    return (first_next - timedelta(days=1)).isoformat()


async def _trend(
    client: AsyncClient, token: str, from_month: str, to_month: str
) -> dict:
    response = await client.get(
        f"/dashboard/expense-trend?from_month={from_month}&to_month={to_month}",
        headers=_auth(token),
    )
    assert response.status_code == 200
    return response.json()


async def test_expense_trend_requires_authentication(client: AsyncClient) -> None:
    response = await client.get(
        "/dashboard/expense-trend?from_month=2026-01&to_month=2026-02"
    )
    assert response.status_code == 401


async def test_expense_trend_buckets_by_month_and_zero_fills(
    client: AsyncClient, database_url: str
) -> None:
    """Monthly expenses are bucketed one bucket per month across the inclusive
    range — a month with no expenses is still a €0.00 bucket, so the chart is a
    true trend — and only Expense Transactions count: income and Transfers
    never appear, nor do expenses outside the range (US28)."""
    account_id = insert_foreign_account(database_url, "trend-bucket@budjetame.dev")
    try:
        token = await _login(client, email="trend-bucket@budjetame.dev", password="whatever")
        wallet = await _create_wallet(client, token, "Trend Wallet", "checking", "0.00")
        m4, m3, m2, m1 = _months_ago(4), _months_ago(3), _months_ago(2), _months_ago(1)
        await _create_expense(client, token, wallet, "10.00", _day_in(m3))
        await _create_expense(client, token, wallet, "20.00", _day_in(m1))
        await _create_expense(client, token, wallet, "7.00", _day_in(m4))  # outside the range
        # Non-expense money movements in the range must not count.
        await client.post(
            "/transactions",
            json={"type": "income", "amount": "99.00", "date": _day_in(m2), "wallet_id": wallet},
            headers=_auth(token),
        )
        savings = await _create_wallet(client, token, "Trend Savings", "checking", "0.00")
        await client.post(
            "/transactions",
            json={
                "type": "transfer",
                "amount": "50.00",
                "date": _day_in(m2),
                "source_wallet_id": wallet,
                "destination_wallet_id": savings,
            },
            headers=_auth(token),
        )

        trend = await _trend(client, token, m3, m1)

        assert trend["from_month"] == m3
        assert trend["to_month"] == m1
        assert [b["month"] for b in trend["months"]] == [m3, m2, m1]
        assert [b["expenses"] for b in trend["months"]] == ["10.00", "0.00", "20.00"]
    finally:
        delete_account(database_url, account_id)


async def test_expense_trend_buckets_europe_rome_month_boundaries(
    client: AsyncClient, database_url: str
) -> None:
    """A Transaction on the last day of a month lands in that month, and one on
    the first day of the next month lands in the next — the Europe/Rome
    boundaries (CONTEXT.md), so the trend never shifts a month."""
    account_id = insert_foreign_account(database_url, "trend-boundary@budjetame.dev")
    try:
        token = await _login(client, email="trend-boundary@budjetame.dev", password="whatever")
        wallet = await _create_wallet(client, token, "Boundary Trend Wallet", "checking", "0.00")
        m2, m1 = _months_ago(2), _months_ago(1)
        await _create_expense(client, token, wallet, "10.00", _last_day(m2))
        await _create_expense(client, token, wallet, "5.00", f"{m1}-01")

        trend = await _trend(client, token, m2, m1)

        assert [b["expenses"] for b in trend["months"]] == ["10.00", "5.00"]
    finally:
        delete_account(database_url, account_id)


async def test_expense_trend_rejects_bad_ranges(client: AsyncClient) -> None:
    token = await _login(client)
    m = _months_ago(1)

    bad_urls = [
        f"/dashboard/expense-trend?from_month=banana&to_month={m}",
        f"/dashboard/expense-trend?from_month=2026-13&to_month={m}",
        # from after to
        f"/dashboard/expense-trend?from_month={_months_ago(2)}&to_month={_months_ago(3)}",
        "/dashboard/expense-trend?from_month=2026-01",  # missing to_month
        "/dashboard/expense-trend?to_month=2026-01",  # missing from_month
    ]
    for url in bad_urls:
        response = await client.get(url, headers=_auth(token))
        assert response.status_code == 422, url
