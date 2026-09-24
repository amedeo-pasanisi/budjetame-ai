"""accounts: add language column (en/it)

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-22

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("language", sa.String(length=5), nullable=False, server_default="en"),
    )


def downgrade() -> None:
    op.drop_column("accounts", "language")