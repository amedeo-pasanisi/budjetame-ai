from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.dates import current_rome_month
from app.deps import get_session
from app.models import Account
from app.schemas import DashboardSummary
from app.services import dashboard as dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> DashboardSummary:
    """The Dashboard overview (T10): Net Worth plus the current month's Income
    and Expense totals. The month is bucketed in Europe/Rome, the app's single
    fixed timezone; Opening Balance Transactions are excluded from the
    statistics (CONTEXT.md)."""
    month = current_rome_month()
    income, expenses = dashboard_service.month_income_expenses(
        session, account.id, month
    )
    return DashboardSummary(
        net_worth=dashboard_service.net_worth(session, account.id),
        month=month,
        income=income,
        expenses=expenses,
    )
