"""drop wallet and category from recurring definitions

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-22

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A Recurring Cost / Recurring Income is a definition, not money: it
    # never touches Wallet Balances and never carries a Category. The Wallet
    # and Category of a linked Transaction are chosen at Transaction creation
    # time, so the definition's copies were redundant.
    for table in ("recurring_costs", "recurring_incomes"):
        op.drop_index(op.f(f"ix_{table}_wallet_id"), table_name=table)
        op.drop_index(op.f(f"ix_{table}_category_id"), table_name=table)
        op.drop_column(table, "wallet_id")
        op.drop_column(table, "category_id")


def downgrade() -> None:
    for table in ("recurring_costs", "recurring_incomes"):
        op.add_column(
            table,
            sa.Column(
                "wallet_id",
                sa.Integer(),
                sa.ForeignKey("wallets.id", ondelete="CASCADE"),
                nullable=False,
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "category_id",
                sa.Integer(),
                sa.ForeignKey("categories.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
        op.create_index(
            op.f(f"ix_{table}_wallet_id"), table, ["wallet_id"]
        )
        op.create_index(
            op.f(f"ix_{table}_category_id"), table, ["category_id"]
        )
