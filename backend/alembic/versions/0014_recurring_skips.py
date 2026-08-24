"""recurring_skips table

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-25

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A skip (ADR-0016) excuses one Occurrence of a Recurring Cost or
    # Recurring Income: the user marked it as not applying, so it never
    # enters the Backlog, never counts toward Monthly Spendable, and a link
    # can never pay it. The row stores the Occurrence's own date at skip
    # time; its effective period under the current unit — the date for
    # day/week intervals, the month for month intervals, the year for year
    # intervals (app.recurrence.period_of) — is what travels with the
    # Occurrence when the definition is edited, and a period holding no
    # Occurrence lies dormant. One table carries both sides (like the
    # Transaction link columns): exactly one of the two definition FKs is
    # set (the CHECK enforces it), and deleting a definition cascades its
    # skips away. Un-skipping deletes the row.
    op.create_table(
        "recurring_skips",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "recurring_cost_id",
            sa.Integer(),
            sa.ForeignKey("recurring_costs.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "recurring_income_id",
            sa.Integer(),
            sa.ForeignKey("recurring_incomes.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "num_nonnulls(recurring_cost_id, recurring_income_id) = 1",
            name="ck_recurring_skips_one_definition",
        ),
    )
    op.create_index(
        op.f("ix_recurring_skips_recurring_cost_id"),
        "recurring_skips",
        ["recurring_cost_id"],
    )
    op.create_index(
        op.f("ix_recurring_skips_recurring_income_id"),
        "recurring_skips",
        ["recurring_income_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_recurring_skips_recurring_income_id"), table_name="recurring_skips"
    )
    op.drop_index(
        op.f("ix_recurring_skips_recurring_cost_id"), table_name="recurring_skips"
    )
    op.drop_table("recurring_skips")
