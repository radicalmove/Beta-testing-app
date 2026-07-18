"""Create course identity and anchored comment records."""

from alembic import op
import sqlalchemy as sa


revision = "20260710_02"
down_revision = "20260710_01"
branch_labels = None
depends_on = None


comment_category = sa.Enum("content", "design", "assessment", "accessibility", "technical", "other", name="commentcategory")
comment_status = sa.Enum("open", "in_progress", "awaiting_sme", "resolved", "deferred", name="commentstatus")


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("moodle_course_id", sa.String(length=64), nullable=True),
        sa.Column("normalized_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("identity_title", sa.String(length=512), nullable=False),
        sa.Column("is_confirmed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("moodle_course_id"),
        sa.UniqueConstraint("normalized_url", "identity_title", name="uq_courses_temporary_identity"),
    )
    op.create_index("ix_courses_moodle_course_id", "courses", ["moodle_course_id"])
    op.create_table(
        "page_locations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("page_url", sa.Text(), nullable=False),
        sa.Column("selected_quote", sa.Text(), nullable=True),
        sa.Column("prefix", sa.Text(), nullable=True),
        sa.Column("suffix", sa.Text(), nullable=True),
        sa.Column("css_selector", sa.Text(), nullable=True),
        sa.Column("dom_selector", sa.Text(), nullable=True),
        sa.Column("relative_x", sa.Float(), nullable=True),
        sa.Column("relative_y", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_page_locations_course_page", "page_locations", ["course_id", "page_url"])
    op.create_table(
        "comments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=True),
        sa.Column("author_user_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("category", comment_category, nullable=False),
        sa.Column("status", comment_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["page_locations.id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comments_course_status", "comments", ["course_id", "status"])
    op.create_table(
        "comment_replies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("author_user_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comment_replies_comment_time", "comment_replies", ["comment_id", "created_at"])
    op.create_table(
        "comment_shares",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("shared_with_user_id", sa.Uuid(), nullable=False),
        sa.Column("shared_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["shared_with_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["shared_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "shared_with_user_id", name="uq_comment_shares_recipient"),
    )
    op.create_table(
        "comment_status_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comment_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("status", comment_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["comment_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comment_status_events_comment_time", "comment_status_events", ["comment_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_comment_status_events_comment_time", table_name="comment_status_events")
    op.drop_table("comment_status_events")
    op.drop_table("comment_shares")
    op.drop_index("ix_comment_replies_comment_time", table_name="comment_replies")
    op.drop_table("comment_replies")
    op.drop_index("ix_comments_course_status", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_page_locations_course_page", table_name="page_locations")
    op.drop_table("page_locations")
    op.drop_index("ix_courses_moodle_course_id", table_name="courses")
    op.drop_table("courses")
    comment_status.drop(op.get_bind(), checkfirst=True)
    comment_category.drop(op.get_bind(), checkfirst=True)
