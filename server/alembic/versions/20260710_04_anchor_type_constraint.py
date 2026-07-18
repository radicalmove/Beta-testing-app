"""Constrain page-location anchor types without changing applied revision history.

Revision ID: 20260710_04
Revises: 20260710_03
"""

from alembic import op


revision = "20260710_04"
down_revision = "20260710_03"
branch_labels = None
depends_on = None


_CONSTRAINT = "ck_page_locations_anchor_type"
_EXPRESSION = "anchor_type IN ('text_highlight', 'visual_pin')"


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("page_locations") as batch_op:
            batch_op.create_check_constraint(_CONSTRAINT, _EXPRESSION)
    else:
        op.create_check_constraint(_CONSTRAINT, "page_locations", _EXPRESSION)


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("page_locations") as batch_op:
            batch_op.drop_constraint(_CONSTRAINT, type_="check")
    else:
        op.drop_constraint(_CONSTRAINT, "page_locations", type_="check")
