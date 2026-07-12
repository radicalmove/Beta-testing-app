import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, String, Text, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UserRole(str, enum.Enum):
    BETA_TESTER = "beta_tester"
    SME = "sme"
    LD_DCD = "ld_dcd"
    ADMIN = "admin"


class MembershipState(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVOKED = "revoked"


class CommentCategory(str, enum.Enum):
    LANGUAGE_GRAMMAR = "language_grammar"
    LEARNING_DESIGN_CONTENT_FLOW = "learning_design_content_flow"
    ASSESSMENT = "assessment"
    ACCESSIBILITY = "accessibility"
    TECHNICAL_LINK_MEDIA_INTERACTION = "technical_link_media_interaction"
    GENERAL = "general"


class AnchorType(str, enum.Enum):
    TEXT_HIGHLIGHT = "text_highlight"
    VISUAL_PIN = "visual_pin"


class CommentStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    AWAITING_SME = "awaiting_sme"
    RESOLVED = "resolved"
    DEFERRED = "deferred"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False, default="User")
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda roles: [role.value for role in roles]),
        nullable=False,
        default=UserRole.BETA_TESTER,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("length(trim(display_name)) BETWEEN 1 AND 100", name="ck_users_display_name_length"),
        Index("ix_users_email", "email"),
        Index("ix_users_role", "role"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    membership_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("course_memberships.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_sessions_token_hash", "token_hash"), Index("ix_sessions_expires_at", "expires_at"))


class ExtensionLoginCode(Base):
    __tablename__ = "extension_login_codes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_extension_login_codes_code_hash", "code_hash"), Index("ix_extension_login_codes_expires_at", "expires_at"))


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_audit_events_entity_time", "entity_type", "entity_id", "created_at"),)


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    moodle_course_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    normalized_url: Mapped[str] = mapped_column(Text, nullable=False)
    moodle_origin: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    identity_title: Mapped[str] = mapped_column(String(512), nullable=False)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        UniqueConstraint("normalized_url", "identity_title", name="uq_courses_temporary_identity"),
        Index("ix_courses_moodle_course_id", "moodle_course_id"),
    )


class CourseMembership(Base):
    __tablename__ = "course_memberships"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda roles: [role.value for role in roles]), nullable=False
    )
    state: Mapped[MembershipState] = mapped_column(
        Enum(MembershipState, values_callable=lambda states: [state.value for state in states]), nullable=False
    )
    approved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_course_memberships_user_course"),
        Index("ix_course_memberships_course_state", "course_id", "state"),
    )


class ReviewerInvitation(Base):
    __tablename__ = "reviewer_invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False)
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    email_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    code_hash: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    allowed_role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda roles: [role.value for role in roles]), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_reviewer_invitations_course_email", "course_id", "email_hash"),
        Index("ix_reviewer_invitations_expires_at", "expires_at"),
    )


class ReconnectCredential(Base):
    __tablename__ = "reconnect_credentials"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    membership_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("course_memberships.id"), nullable=False, unique=True)
    code_hash: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DeviceCredential(Base):
    __tablename__ = "device_credentials"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    membership_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("course_memberships.id"), nullable=False)
    family_id: Mapped[str] = mapped_column(String(64), nullable=False)
    credential_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_device_credentials_family", "family_id"),
        Index("ix_device_credentials_expires_at", "expires_at"),
    )


class PageLocation(Base):
    __tablename__ = "page_locations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False)
    page_url: Mapped[str] = mapped_column(Text, nullable=False)
    page_title: Mapped[str] = mapped_column(String(512), nullable=False)
    anchor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    selected_quote: Mapped[str | None] = mapped_column(Text)
    prefix: Mapped[str | None] = mapped_column(Text)
    suffix: Mapped[str | None] = mapped_column(Text)
    css_selector: Mapped[str | None] = mapped_column(Text)
    dom_selector: Mapped[str | None] = mapped_column(Text)
    relative_x: Mapped[float | None] = mapped_column(Float)
    relative_y: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("anchor_type IN ('text_highlight', 'visual_pin')", name="ck_page_locations_anchor_type"),
        Index("ix_page_locations_course_page", "course_id", "page_url"),
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id"), nullable=False)
    location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("page_locations.id"))
    author_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    author_role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, values_callable=lambda roles: [role.value for role in roles]),
        nullable=False,
        default=UserRole.BETA_TESTER,
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[CommentCategory] = mapped_column(Enum(CommentCategory, values_callable=lambda items: [item.value for item in items]), nullable=False)
    status: Mapped[CommentStatus] = mapped_column(Enum(CommentStatus, values_callable=lambda items: [item.value for item in items]), nullable=False, default=CommentStatus.OPEN)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_comments_course_status", "course_id", "status"),)


class CommentReply(Base):
    __tablename__ = "comment_replies"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_comment_replies_comment_time", "comment_id", "created_at"),)


class CommentShare(Base):
    __tablename__ = "comment_shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), nullable=False)
    shared_with_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    shared_by_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (UniqueConstraint("comment_id", "shared_with_user_id", name="uq_comment_shares_recipient"),)


class CommentStatusEvent(Base):
    __tablename__ = "comment_status_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[CommentStatus] = mapped_column(Enum(CommentStatus, values_callable=lambda items: [item.value for item in items]), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_comment_status_events_comment_time", "comment_id", "created_at"),)


class CommentReadState(Base):
    __tablename__ = "comment_read_states"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"), nullable=False)
    uploader_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    media_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (Index("ix_attachments_comment_time", "comment_id", "created_at"),)
