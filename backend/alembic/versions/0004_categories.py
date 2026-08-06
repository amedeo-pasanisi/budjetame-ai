"""categories table and transactions.category_id

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-06

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("icon", sa.String(length=16), nullable=True),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(op.f("ix_categories_account_id"), "categories", ["account_id"])
    # Names are unique per (Account, Type), case-insensitively.
    op.create_index(
        "uq_categories_account_name_type_lower",
        "categories",
        ["account_id", "type", sa.text("lower(name)")],
        unique=True,
    )

    # Deleting a Category leaves its Transactions uncategorized (SET NULL);
    # Transactions are never deleted.
    op.add_column(
        "transactions",
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_transactions_category_id"), "transactions", ["category_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_transactions_category_id"), table_name="transactions")
    op.drop_column("transactions", "category_id")
    op.drop_index("uq_categories_account_name_type_lower", table_name="categories")
    op.drop_index(op.f("ix_categories_account_id"), table_name="categories")
    op.drop_table("categories")
