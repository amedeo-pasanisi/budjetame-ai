"""transactions recurring-cost link

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-19

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # An Expense may pin a Recurring Cost, paying exactly one Occurrence —
    # the oldest Unpaid one at link time (issue #57, ADR-0010). The pin is
    # stored, never recomputed: `occurrence_date` is the paid Occurrence's
    # own date, set once at link time and untouched by later edits to the
    # Transaction's date. Unlinking or deleting the Expense frees the
    # Occurrence (the row is nulled); deleting the Recurring Cost severs the
    # link via ON DELETE SET NULL, the Expense surviving as an ordinary one.
    op.add_column(
        "transactions", sa.Column("recurring_cost_id", sa.Integer(), nullable=True)
    )
    op.add_column(
        "transactions", sa.Column("occurrence_date", sa.Date(), nullable=True)
    )
    op.create_foreign_key(
        op.f("fk_transactions_recurring_cost_id"),
        "transactions",
        "recurring_costs",
        ["recurring_cost_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_transactions_recurring_cost_id"),
        "transactions",
        ["recurring_cost_id"],
    )
    # Exactly one linked Expense covers exactly one Occurrence (ADR-0010):
    # the partial unique index makes the invariant hold at the database
    # level, even under a concurrent double-link race.
    op.create_index(
        "uq_transactions_cost_occurrence",
        "transactions",
        ["recurring_cost_id", "occurrence_date"],
        unique=True,
        postgresql_where=sa.text(
            "recurring_cost_id IS NOT NULL AND occurrence_date IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_transactions_cost_occurrence", table_name="transactions")
    op.drop_index(op.f("ix_transactions_recurring_cost_id"), table_name="transactions")
    op.drop_constraint(
        op.f("fk_transactions_recurring_cost_id"),
        "transactions",
        type_="foreignkey",
    )
    op.drop_column("transactions", "occurrence_date")
    op.drop_column("transactions", "recurring_cost_id")
