"""accounts.password_hash nullable for Google-provisioned Accounts

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-26

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # ADR-0020: an Account can now be provisioned by a first Google sign-in
    # (issue #81) and has no password — the hash must be nullable. Password
    # Accounts are untouched; a Google-only Account simply carries NULL and
    # can never sign in with a password.
    op.alter_column("accounts", "password_hash", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    op.alter_column("accounts", "password_hash", existing_type=sa.String(255), nullable=False)
