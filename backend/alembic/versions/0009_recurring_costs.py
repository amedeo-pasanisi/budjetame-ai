"""recurring_costs table

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-19

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A Recurring Cost is a definition, not money: it never touches Wallet
    # Balances. Occurrences are derived from start_date + interval (ADR-0010);
    # the due-date override is a day-of-month for month intervals and a
    # month+day for year intervals, both null for day/week intervals (the
    # service enforces the per-unit combination).
    op.create_table(
        "recurring_costs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("interval_value", sa.Integer(), nullable=False),
        sa.Column("interval_unit", sa.String(length=10), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_day", sa.Integer(), nullable=True),
        sa.Column("due_month", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        op.f("ix_recurring_costs_account_id"), "recurring_costs", ["account_id"]
    )
    # Names are unique per Account, case-insensitively.
    op.create_index(
        "uq_recurring_costs_account_name_lower",
        "recurring_costs",
        ["account_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        op.f("ix_recurring_costs_wallet_id"), "recurring_costs", ["wallet_id"]
    )
    op.create_index(
        op.f("ix_recurring_costs_category_id"), "recurring_costs", ["category_id"]
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_recurring_costs_category_id"), table_name="recurring_costs"
    )
    op.drop_index(op.f("ix_recurring_costs_wallet_id"), table_name="recurring_costs")
    op.drop_index(
        "uq_recurring_costs_account_name_lower", table_name="recurring_costs"
    )
    op.drop_index(op.f("ix_recurring_costs_account_id"), table_name="recurring_costs")
    op.drop_table("recurring_costs")
