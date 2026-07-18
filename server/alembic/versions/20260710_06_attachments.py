"""Add protected screenshot attachment metadata.

Revision ID: 20260710_06
Revises: 20260710_05
"""

import sqlalchemy as sa
from alembic import op


revision = "20260710_06"
down_revision = "20260710_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("uploader_user_id", sa.Uuid(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("object_name", sa.String(length=64), nullable=False),
        sa.Column("media_type", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["uploader_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_name"),
    )
    op.create_index("ix_attachments_comment_time", "attachments", ["comment_id", "created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_attachments_comment_time", table_name="attachments")
    op.drop_table("attachments")
