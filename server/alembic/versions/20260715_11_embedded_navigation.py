"""Add optional paired embedded navigation metadata.

Revision ID: 20260715_11
Revises: 20260713_10
"""
import sqlalchemy as sa
from alembic import op

revision = "20260715_11"
down_revision = "20260713_10"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_page_locations_embedded_navigation_pair"


def upgrade() -> None:
    op.add_column("page_locations", sa.Column("parent_activity_url", sa.Text(), nullable=True))
    op.add_column("page_locations", sa.Column("embedded_locator", sa.Text(), nullable=True))
    op.create_check_constraint(
        _CONSTRAINT,
        "page_locations",
        "(parent_activity_url IS NULL) = (embedded_locator IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "page_locations", type_="check")
    op.drop_column("page_locations", "embedded_locator")
    op.drop_column("page_locations", "parent_activity_url")
