"""wallets.frozen flag (ADR-0002)

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-08

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A frozen (deleted) Wallet stays in the database; the UI hides it and every
    # write against it is rejected. The flag defaults to false so existing rows
    # are active Wallets (ADR-0002).
    op.add_column(
        "wallets",
        sa.Column(
            "frozen",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("wallets", "frozen")
