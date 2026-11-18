"""draft_transactions: the Assistant's stored, unapproved Drafts (ADR-0036)

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-18

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Its own table, never a flag on transactions (ADR-0036): no derived
    # read can sum a Draft by mistake. Every reference is ON DELETE SET
    # NULL so a deleted Wallet, a merged Category or a Restore leaves the
    # Draft in place with that field missing.
    op.create_table(
        "draft_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=20), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column(
            "wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "source_wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "destination_wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recurring_cost_id",
            sa.Integer(),
            sa.ForeignKey("recurring_costs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recurring_income_id",
            sa.Integer(),
            sa.ForeignKey("recurring_incomes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    for column in (
        "account_id",
        "wallet_id",
        "source_wallet_id",
        "destination_wallet_id",
        "category_id",
        "recurring_cost_id",
        "recurring_income_id",
    ):
        op.create_index(
            f"ix_draft_transactions_{column}", "draft_transactions", [column]
        )


def downgrade() -> None:
    op.drop_table("draft_transactions")
