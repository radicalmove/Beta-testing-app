"""Cascade thread-owned rows when a comment is deleted.

Revision ID: 20260713_10
Revises: 20260712_09
"""
from alembic import op

revision = "20260713_10"
down_revision = "20260712_09"
branch_labels = None
depends_on = None

TABLES = ("comment_replies", "comment_shares", "comment_status_events", "comment_read_states", "attachments")


def _replace(ondelete: str | None) -> None:
    for table in TABLES:
        name = f"{table}_comment_id_fkey"
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, "comments", ["comment_id"], ["id"], ondelete=ondelete)


def upgrade() -> None:
    _replace("CASCADE")


def downgrade() -> None:
    _replace(None)
