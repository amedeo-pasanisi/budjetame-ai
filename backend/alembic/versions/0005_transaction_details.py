"""transactions: description and geographic coordinates

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-06

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "transactions", sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=True)
    )
    op.add_column(
        "transactions", sa.Column("longitude", sa.Numeric(precision=9, scale=6), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("transactions", "longitude")
    op.drop_column("transactions", "latitude")
    op.drop_column("transactions", "description")
