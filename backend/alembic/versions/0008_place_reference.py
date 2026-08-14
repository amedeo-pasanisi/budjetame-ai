"""transactions: optional Place reference (name + provider id)

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-14

"""

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # A Geographic Location may carry a Place (ADR-0005): the name the user
    # picked by search plus the provider's opaque reference id (e.g. a Google
    # place_id). Both are nullable; there is no cross-field constraint — the
    # frontend invariant is "written together, cleared together", and only a
    # name-search pick ever produces a Place.
    op.add_column("transactions", sa.Column("place_name", sa.Text(), nullable=True))
    op.add_column("transactions", sa.Column("place_id", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "place_id")
    op.drop_column("transactions", "place_name")
