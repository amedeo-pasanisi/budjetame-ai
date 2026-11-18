"""accounts: Assistant Settings — provider, model, encrypted Assistant Key

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-18

ADR-0035, issue #126: the three columns are set and removed together; the
key column holds base64(nonce || AES-GCM ciphertext) under the server's
BUDJETAME_ASSISTANT_KEY_SECRET.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("assistant_provider", sa.String(length=20), nullable=True),
    )
    op.add_column("accounts", sa.Column("assistant_model", sa.Text(), nullable=True))
    op.add_column(
        "accounts", sa.Column("assistant_key_encrypted", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("accounts", "assistant_key_encrypted")
    op.drop_column("accounts", "assistant_model")
    op.drop_column("accounts", "assistant_provider")
