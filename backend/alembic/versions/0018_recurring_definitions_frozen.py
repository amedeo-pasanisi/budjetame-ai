"""recurring definitions: frozen flag and freeze_date

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-14

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | None = None
depends_on: str | None = None

TABLES = ["recurring_costs", "recurring_incomes"]


def upgrade() -> None:
    for table in TABLES:
        op.add_column(
            table,
            sa.Column(
                "frozen",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
        op.add_column(
            table,
            sa.Column(
                "freeze_date",
                sa.Date(),
                nullable=True,
            ),
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "freeze_date")
        op.drop_column(table, "frozen")