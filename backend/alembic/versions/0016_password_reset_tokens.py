"""password_reset_tokens table

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-26

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Password reset (issue #83): one row per issued reset link. Only the
    # sha256 of the raw token is stored (the email carries the raw token), so
    # a database leak cannot be replayed; expiry is enforced at use time, and
    # consuming the token deletes the row (single-use). Deleting the Account
    # cascades its tokens away.
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        op.f("ix_password_reset_tokens_account_id"),
        "password_reset_tokens",
        ["account_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_password_reset_tokens_account_id"), table_name="password_reset_tokens"
    )
    op.drop_table("password_reset_tokens")
