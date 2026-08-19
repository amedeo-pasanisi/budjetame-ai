"""transactions recurring-income link

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-21

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # An Income may pin a Recurring Income, paying exactly one Occurrence —
    # the oldest Unpaid one at link time (issue #61, ADR-0010/0011). The
    # mirror of the Recurring Cost link (migration 0010): `occurrence_date`
    # is the shared pin column, set once at link time and untouched by later
    # edits to the Transaction's date. Unlinking or deleting the Income frees
    # the Occurrence (the row is nulled); deleting the Recurring Income
    # severs the link via ON DELETE SET NULL, the Income surviving as an
    # ordinary one. A Transaction is one type, so the two links can never
    # coexist: Expenses carry only recurring_cost_id, Incomes only
    # recurring_income_id, Transfers neither.
    op.add_column(
        "transactions", sa.Column("recurring_income_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_transactions_recurring_income_id"),
        "transactions",
        "recurring_incomes",
        ["recurring_income_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_transactions_recurring_income_id"),
        "transactions",
        ["recurring_income_id"],
    )
    # Exactly one linked Income covers exactly one Occurrence (ADR-0010):
    # the partial unique index makes the invariant hold at the database
    # level, even under a concurrent double-link race — the same guard the
    # cost link has, mirrored (ADR-0011).
    op.create_index(
        "uq_transactions_income_occurrence",
        "transactions",
        ["recurring_income_id", "occurrence_date"],
        unique=True,
        postgresql_where=sa.text(
            "recurring_income_id IS NOT NULL AND occurrence_date IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_transactions_income_occurrence", table_name="transactions")
    op.drop_index(op.f("ix_transactions_recurring_income_id"), table_name="transactions")
    op.drop_constraint(
        op.f("fk_transactions_recurring_income_id"),
        "transactions",
        type_="foreignkey",
    )
    op.drop_column("transactions", "recurring_income_id")
