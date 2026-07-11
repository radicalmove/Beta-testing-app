"""Add course-specific memberships and reviewer invitations.

Revision ID: 20260712_09
Revises: 20260710_08
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260712_09"
down_revision = "20260710_08"
branch_labels = None
depends_on = None

user_role = postgresql.ENUM("beta_tester", "sme", "ld_dcd", "admin", name="userrole", create_type=False)
membership_state = sa.Enum("pending", "approved", "rejected", "revoked", name="membershipstate")


def upgrade() -> None:
    op.add_column("courses", sa.Column("moodle_origin", sa.String(length=255), nullable=True))
    op.create_table(
        "course_memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("state", membership_state, nullable=False),
        sa.Column("approved_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "course_id", name="uq_course_memberships_user_course"),
    )
    op.create_index("ix_course_memberships_course_state", "course_memberships", ["course_id", "state"])
    op.add_column("sessions", sa.Column("membership_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_sessions_membership", "sessions", "course_memberships", ["membership_id"], ["id"])
    op.create_table(
        "reviewer_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("code_hash", sa.String(length=512), nullable=False),
        sa.Column("allowed_role", user_role, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("redeemed_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["redeemed_by_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index("ix_reviewer_invitations_course_email", "reviewer_invitations", ["course_id", "email_hash"])
    op.create_index("ix_reviewer_invitations_expires_at", "reviewer_invitations", ["expires_at"])
    op.create_table(
        "reconnect_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=512), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["course_memberships.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("membership_id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_table(
        "device_credentials",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("membership_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.String(length=64), nullable=False),
        sa.Column("credential_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["membership_id"], ["course_memberships.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("credential_hash"),
    )
    op.create_index("ix_device_credentials_family", "device_credentials", ["family_id"])
    op.create_index("ix_device_credentials_expires_at", "device_credentials", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_device_credentials_expires_at", table_name="device_credentials")
    op.drop_index("ix_device_credentials_family", table_name="device_credentials")
    op.drop_table("device_credentials")
    op.drop_table("reconnect_credentials")
    op.drop_index("ix_reviewer_invitations_expires_at", table_name="reviewer_invitations")
    op.drop_index("ix_reviewer_invitations_course_email", table_name="reviewer_invitations")
    op.drop_table("reviewer_invitations")
    op.drop_index("ix_course_memberships_course_state", table_name="course_memberships")
    op.drop_constraint("fk_sessions_membership", "sessions", type_="foreignkey")
    op.drop_column("sessions", "membership_id")
    op.drop_table("course_memberships")
    op.drop_column("courses", "moodle_origin")
