import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.dates import current_rome_month
from app.deps import get_session
from app.models import Account
from app.schemas import CategoryExpense, DashboardSummary
from app.services import dashboard as dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# A zero-padded calendar month, e.g. "2026-08" (what <input type="month"> sends).
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _month_or_422(month: str) -> str:
    """A `YYYY-MM` reference month, or 422 (US27)."""
    if _MONTH_PATTERN.fullmatch(month) is None:
        raise HTTPException(status_code=422, detail="month must be YYYY-MM")
    return month


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    month: str | None = None,
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> DashboardSummary:
    """The Dashboard overview: Net Worth plus the reference month's Income and
    Expense totals and its expense pie. The month defaults to the current one,
    bucketed in Europe/Rome, the app's single fixed timezone; `?month=YYYY-MM`
    selects another one and the whole summary reflects it (US27, T11). Opening
    Balance Transactions are excluded from the statistics (CONTEXT.md)."""
    month = _month_or_422(month) if month is not None else current_rome_month()
    income, expenses = dashboard_service.month_income_expenses(
        session, account.id, month
    )
    slices = dashboard_service.expenses_by_category(session, account.id, month)
    return DashboardSummary(
        net_worth=dashboard_service.net_worth(session, account.id),
        month=month,
        income=income,
        expenses=expenses,
        expenses_by_category=[CategoryExpense(**slice_) for slice_ in slices],
    )
