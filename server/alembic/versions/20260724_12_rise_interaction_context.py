"""Add Rise interaction context to page locations."""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260724_12"
down_revision: str | None = "20260715_11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("page_locations", sa.Column("interaction_context", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("page_locations", "interaction_context")
