"""transactions: transfer legs (source/destination wallets)

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-08

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A Transfer references Source and Destination Wallets instead of the single
    # `wallet_id` of Expense/Income/Opening Balance rows, so `wallet_id` becomes
    # nullable and the two legs are added (spec decision #6).
    op.alter_column(
        "transactions",
        "wallet_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.add_column(
        "transactions",
        sa.Column(
            "source_wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "destination_wallet_id",
            sa.Integer(),
            sa.ForeignKey("wallets.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_transactions_source_wallet_id"), "transactions", ["source_wallet_id"]
    )
    op.create_index(
        op.f("ix_transactions_destination_wallet_id"),
        "transactions",
        ["destination_wallet_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_transactions_destination_wallet_id"), table_name="transactions"
    )
    op.drop_index(op.f("ix_transactions_source_wallet_id"), table_name="transactions")
    op.drop_column("transactions", "destination_wallet_id")
    op.drop_column("transactions", "source_wallet_id")
    op.alter_column(
        "transactions",
        "wallet_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
