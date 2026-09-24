"""Backup endpoint (issue #112): GET /backup/export returns a complete multi-
sheet backup workbook of the Account's whole data state.

The route queries every entity type scoped to the Account, resolves foreign-
key references to names, and passes the resolved data to the pure builder.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_account
from app.dates import ROME, to_rome_day
from app.deps import get_session
from app.models import (
    Account,
    Category,
    RecurringCost,
    RecurringIncome,
    RecurringSkip,
    Transaction,
    TransactionType,
    Wallet,
)
from app.services.backup import (
    BackupCategory,
    BackupRecurringDefinition,
    BackupSkip,
    BackupTransaction,
    BackupWallet,
    build_backup_workbook,
)

router = APIRouter(prefix="/backup", tags=["backup"])

BACKUP_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/export")
def export_backup(
    account: Account = Depends(get_current_account),
    session: Session = Depends(get_session),
) -> Response:
    """The Account's complete data as a multi-sheet .xlsx backup workbook
    (issue #112, ADR-0030). Every entity type is included: Transactions
    (including Opening Balances), Wallets, Categories, Recurring Costs,
    Recurring Incomes, and Skips. Entities are keyed by name; database ids
    are carried for reference. The origin marker is the Account's email."""
    account_id = account.id

    # --- Resolve Wallet id → name for reference lookups ---
    wallets_list = session.scalars(
        select(Wallet).where(Wallet.account_id == account_id)
    ).all()
    wallet_names: dict[int, str] = {w.id: w.name for w in wallets_list}
    wallet_types: dict[int, str] = {w.id: w.type for w in wallets_list}

    # --- Resolve Category id → name ---
    categories_list = session.scalars(
        select(Category).where(Category.account_id == account_id)
    ).all()
    category_names: dict[int, str] = {c.id: c.name for c in categories_list}

    # --- Resolve Recurring Cost id → name ---
    recurring_costs_list = session.scalars(
        select(RecurringCost).where(RecurringCost.account_id == account_id)
    ).all()
    recurring_cost_names: dict[int, str] = {rc.id: rc.name for rc in recurring_costs_list}

    # --- Resolve Recurring Income id → name ---
    recurring_incomes_list = session.scalars(
        select(RecurringIncome).where(RecurringIncome.account_id == account_id)
    ).all()
    recurring_income_names: dict[int, str] = {ri.id: ri.name for ri in recurring_incomes_list}

    # --- Build BackupTransaction rows ---
    transactions = session.scalars(
        select(Transaction)
        .where(Transaction.account_id == account_id)
        .order_by(Transaction.date.asc(), Transaction.id.asc())
    ).all()

    backup_transactions = [
        BackupTransaction(
            date=to_rome_day(t.date),
            type=t.type,
            amount=t.amount,
            wallet=wallet_names.get(t.wallet_id) if t.wallet_id else None,
            source_wallet=wallet_names.get(t.source_wallet_id) if t.source_wallet_id else None,
            destination_wallet=wallet_names.get(t.destination_wallet_id) if t.destination_wallet_id else None,
            category=category_names.get(t.category_id) if t.category_id else None,
            description=t.description,
            latitude=t.latitude,
            longitude=t.longitude,
            recurring_cost=recurring_cost_names.get(t.recurring_cost_id) if t.recurring_cost_id else None,
            recurring_income=recurring_income_names.get(t.recurring_income_id) if t.recurring_income_id else None,
            occurrence_date=t.occurrence_date.isoformat() if t.occurrence_date else None,
            id=t.id,
        )
        for t in transactions
    ]

    # --- Build BackupWallet rows ---
    backup_wallets = [
        BackupWallet(
            name=w.name,
            type=w.type,
            frozen=w.frozen,
            id=w.id,
        )
        for w in wallets_list
    ]

    # --- Build BackupCategory rows ---
    backup_categories = [
        BackupCategory(
            name=c.name,
            type=c.type,
            icon=c.icon,
            color=c.color,
            id=c.id,
        )
        for c in categories_list
    ]

    # --- Build BackupRecurringDefinition rows for Costs ---
    backup_costs = [
        BackupRecurringDefinition(
            name=rc.name,
            amount=rc.amount,
            interval_value=rc.interval_value,
            interval_unit=rc.interval_unit,
            start_date=rc.start_date.isoformat(),
            frozen=rc.frozen,
            freeze_date=rc.freeze_date.isoformat() if rc.freeze_date else None,
            id=rc.id,
        )
        for rc in recurring_costs_list
    ]

    # --- Build BackupRecurringDefinition rows for Incomes ---
    backup_incomes = [
        BackupRecurringDefinition(
            name=ri.name,
            amount=ri.amount,
            interval_value=ri.interval_value,
            interval_unit=ri.interval_unit,
            start_date=ri.start_date.isoformat(),
            frozen=ri.frozen,
            freeze_date=ri.freeze_date.isoformat() if ri.freeze_date else None,
            id=ri.id,
        )
        for ri in recurring_incomes_list
    ]

    # --- Build BackupSkip rows ---
    skips = session.scalars(
        select(RecurringSkip)
        .where(
            (RecurringSkip.recurring_cost_id.in_(
                select(RecurringCost.id).where(RecurringCost.account_id == account_id)
            ))
            | (RecurringSkip.recurring_income_id.in_(
                select(RecurringIncome.id).where(RecurringIncome.account_id == account_id)
            ))
        )
    ).all()

    backup_skips = [
        BackupSkip(
            definition_name=(
                (recurring_cost_names.get(s.recurring_cost_id) or "")
                if s.recurring_cost_id
                else (recurring_income_names.get(s.recurring_income_id) or "")
                if s.recurring_income_id
                else ""
            ),
            definition_type="cost" if s.recurring_cost_id else "income",
            occurrence_date=s.occurrence_date.isoformat(),
            id=s.id,
        )
        for s in skips
    ]

    filename = f"budjetame-backup-{datetime.now(ROME).strftime('%Y-%m-%d')}.xlsx"

    return Response(
        content=build_backup_workbook(
            transactions=backup_transactions,
            wallets=backup_wallets,
            categories=backup_categories,
            recurring_costs=backup_costs,
            recurring_incomes=backup_incomes,
            skips=backup_skips,
            origin=account.email,
        ),
        media_type=BACKUP_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )