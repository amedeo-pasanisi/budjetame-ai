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


async def _summary(client: AsyncClient, token: str) -> dict:
    response = await client.get("/dashboard/summary", headers=_auth(token))
    assert response.status_code == 200
    return response.json()


def _current_month() -> str:
    """The month the endpoint buckets in: today's Europe/Rome calendar month."""
    return datetime.now(ROME).strftime("%Y-%m")


def _last_day_of_current_month() -> str:
    """The last calendar day of the current Europe/Rome month, as YYYY-MM-DD."""
    year, month = (int(part) for part in _current_month().split("-"))
    if month == 12:
        first_next = date(year + 1, 1, 1)
    else:
        first_next = date(year, month + 1, 1)
    return (first_next - timedelta(days=1)).isoformat()


def _first_day_of_next_month() -> str:
    """The first calendar day of the next Europe/Rome month, as YYYY-MM-DD."""
    last = date.fromisoformat(_last_day_of_current_month())
    return (last + timedelta(days=1)).isoformat()


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
    finally:
        delete_account(database_url, account_id)
