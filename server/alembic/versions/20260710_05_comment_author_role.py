"""Snapshot comment author roles for immutable discussion audiences.

Revision ID: 20260710_05
Revises: 20260710_04
"""

import sqlalchemy as sa
from alembic import op


revision = "20260710_05"
down_revision = "20260710_04"
branch_labels = None
depends_on = None


_ROLE_VALUES = ("beta_tester", "sme", "ld_dcd", "admin")


def upgrade() -> None:
    # Legacy comments have no immutable audience. Backfill to the most restrictive
    # audience so a later role promotion cannot disclose historical beta feedback.
    author_role = sa.Enum(*_ROLE_VALUES, name="userrole", create_type=False)
    with op.batch_alter_table("comments") as batch_op:
        batch_op.add_column(sa.Column("author_role", author_role, nullable=True))
    op.execute("UPDATE comments SET author_role = 'beta_tester' WHERE author_role IS NULL")
    with op.batch_alter_table("comments") as batch_op:
        batch_op.alter_column("author_role", nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("comments") as batch_op:
        batch_op.drop_column("author_role")
