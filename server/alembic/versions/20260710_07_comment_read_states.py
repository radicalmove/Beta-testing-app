"""Add per-viewer thread read state.

Revision ID: 20260710_07
Revises: 20260710_06
"""
import sqlalchemy as sa
from alembic import op

revision = "20260710_07"
down_revision = "20260710_06"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table("comment_read_states", sa.Column("user_id", sa.Uuid(), nullable=False), sa.Column("comment_id", sa.Uuid(), nullable=False), sa.Column("read_at", sa.DateTime(timezone=True), nullable=False), sa.ForeignKeyConstraint(["user_id"], ["users.id"]), sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]), sa.PrimaryKeyConstraint("user_id", "comment_id"))

def downgrade() -> None:
    op.drop_table("comment_read_states")
