import uuid
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session as DbSession

from app.models import AnchorType, Comment, CommentCategory, CommentReadState, CommentReply, CommentShare, CommentStatus, CommentStatusEvent, PageLocation, User, UserRole
from app.security import utc_now


class AuthorizationError(Exception):
    pass


STATUS_TRANSITIONS = {
    CommentStatus.OPEN: (CommentStatus.IN_PROGRESS, CommentStatus.DEFERRED),
    CommentStatus.IN_PROGRESS: (CommentStatus.AWAITING_SME, CommentStatus.RESOLVED, CommentStatus.DEFERRED),
    CommentStatus.AWAITING_SME: (CommentStatus.IN_PROGRESS, CommentStatus.RESOLVED, CommentStatus.DEFERRED),
    CommentStatus.RESOLVED: (),
    CommentStatus.DEFERRED: (),
}


def allowed_status_choices(current: CommentStatus) -> tuple[CommentStatus, ...]:
    """Render the current value plus exactly the transitions accepted by the service."""
    return (current, *STATUS_TRANSITIONS[current])


def _visibility_clause(user: User):
    if user.role in {UserRole.LD_DCD, UserRole.ADMIN}:
        return True
    if user.role is UserRole.BETA_TESTER:
        return Comment.author_user_id == user.id
    if user.role is UserRole.SME:
        shared_with_user = select(CommentShare.id).where(
            CommentShare.comment_id == Comment.id,
            CommentShare.shared_with_user_id == user.id,
        ).exists()
        return or_(Comment.author_user_id == user.id, Comment.author_role == UserRole.SME, shared_with_user)
    return False


@dataclass(frozen=True)
class DashboardComment:
    comment: Comment
    location: PageLocation | None
    author_display: str
    latest_reply_at: datetime | None
    latest_reply_author: str | None
    read_at: datetime | None

    @property
    def unread(self) -> bool:
        return self.latest_reply_at is not None and (self.read_at is None or self.latest_reply_at > self.read_at)


@dataclass(frozen=True)
class PageComment:
    comment: Comment
    location: PageLocation
    author: User
    replies: tuple[tuple[CommentReply, User], ...]
    status_events: tuple[tuple[CommentStatusEvent, User], ...]


def comment_capabilities(viewer: User, comment: Comment) -> dict[str, bool]:
    is_author = viewer.id == comment.author_user_id
    is_lead = viewer.role is UserRole.LD_DCD
    is_admin = viewer.role is UserRole.ADMIN
    if comment.author_role is UserRole.BETA_TESTER:
        can_reply = is_author or is_lead
    else:
        can_reply = viewer.role is not UserRole.BETA_TESTER or is_author
    return {
        "can_reply": can_reply,
        "can_change_status": is_lead,
        "can_share_with_sme": is_lead,
        "can_delete": is_author or is_lead or is_admin,
    }


def normalized_page_url(value: str) -> str:
    clean = value.strip()
    if value != clean:
        raise ValueError("page_url must not contain leading or trailing whitespace")
    if len(clean) > 4096:
        raise ValueError("page_url must be at most 4096 characters")
    parsed = urlsplit(clean)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("page_url must be an absolute http or https URL")
    return clean


def _reply_visible_to(viewer: User, comment: Comment, reply_author: User) -> bool:
    if viewer.role is UserRole.BETA_TESTER:
        return reply_author.id == viewer.id or reply_author.role is UserRole.LD_DCD
    return True


def dashboard_comments_for(db: DbSession, user: User) -> list[DashboardComment]:
    """Project all visible dashboard data without loading reply or user records."""
    author = aliased(User)
    reply_author = aliased(User)
    eligible_reply = and_(
        CommentReply.comment_id == Comment.id,
        CommentReply.author_user_id != user.id,
        or_(
            and_(Comment.author_role == UserRole.BETA_TESTER, or_(CommentReply.author_user_id == Comment.author_user_id, reply_author.role == UserRole.LD_DCD)),
            and_(Comment.author_role != UserRole.BETA_TESTER, or_(CommentReply.author_user_id == Comment.author_user_id, reply_author.role.in_((UserRole.SME, UserRole.LD_DCD)))),
        ),
    )
    latest_at = (
        select(CommentReply.created_at)
        .join(reply_author, reply_author.id == CommentReply.author_user_id)
        .where(eligible_reply)
        .order_by(CommentReply.created_at.desc(), CommentReply.id.desc())
        .limit(1)
        .correlate(Comment)
        .scalar_subquery()
    )
    latest_author = (
        select(reply_author.email)
        .select_from(CommentReply)
        .join(reply_author, reply_author.id == CommentReply.author_user_id)
        .where(eligible_reply)
        .order_by(CommentReply.created_at.desc(), CommentReply.id.desc())
        .limit(1)
        .correlate(Comment)
        .scalar_subquery()
    )
    rows = db.execute(
        select(Comment, PageLocation, author.email, latest_at, latest_author, CommentReadState.read_at)
        .join(author, author.id == Comment.author_user_id)
        .outerjoin(PageLocation, PageLocation.id == Comment.location_id)
        .outerjoin(CommentReadState, and_(CommentReadState.comment_id == Comment.id, CommentReadState.user_id == user.id))
        .where(_visibility_clause(user))
        .order_by(Comment.created_at)
    ).all()
    return [DashboardComment(comment, location, author_display, reply_at, reply_by, read_at) for comment, location, author_display, reply_at, reply_by, read_at in rows]


def visible_comments_for(db: DbSession, user: User, course_id: uuid.UUID) -> list[Comment]:
    """Return exactly the course threads this user is allowed to discover."""
    query = select(Comment).where(Comment.course_id == course_id)
    query = query.where(_visibility_clause(user))
    return list(db.scalars(query.order_by(Comment.created_at)))


def visible_page_comments_for(db: DbSession, user: User, course_id: uuid.UUID, page_url: str) -> list[PageComment]:
    """Load one exact page's visible threads and conversation data in bounded queries."""
    normalized = normalized_page_url(page_url)
    author = aliased(User)
    rows = db.execute(
        select(Comment, PageLocation, author)
        .join(PageLocation, PageLocation.id == Comment.location_id)
        .join(author, author.id == Comment.author_user_id)
        .where(Comment.course_id == course_id, PageLocation.page_url == normalized, _visibility_clause(user))
        .order_by(Comment.created_at)
    ).all()
    if not rows:
        return []
    comments = [row[0] for row in rows]
    comments_by_id = {comment.id: comment for comment in comments}
    comment_ids = [comment.id for comment in comments]
    reply_author = aliased(User)
    reply_rows = db.execute(
        select(CommentReply, reply_author)
        .join(reply_author, reply_author.id == CommentReply.author_user_id)
        .where(CommentReply.comment_id.in_(comment_ids))
        .order_by(CommentReply.created_at, CommentReply.id)
    ).all()
    event_actor = aliased(User)
    event_rows = db.execute(
        select(CommentStatusEvent, event_actor)
        .join(event_actor, event_actor.id == CommentStatusEvent.actor_user_id)
        .where(CommentStatusEvent.comment_id.in_(comment_ids))
        .order_by(CommentStatusEvent.created_at, CommentStatusEvent.id)
    ).all()
    replies_by_comment: dict[uuid.UUID, list[tuple[CommentReply, User]]] = {comment_id: [] for comment_id in comment_ids}
    for reply, reply_by in reply_rows:
        if _reply_visible_to(user, comments_by_id[reply.comment_id], reply_by):
            replies_by_comment[reply.comment_id].append((reply, reply_by))
    events_by_comment: dict[uuid.UUID, list[tuple[CommentStatusEvent, User]]] = {comment_id: [] for comment_id in comment_ids}
    for event, actor in event_rows:
        events_by_comment[event.comment_id].append((event, actor))
    return [PageComment(comment, location, thread_author, tuple(replies_by_comment[comment.id]), tuple(events_by_comment[comment.id])) for comment, location, thread_author in rows]


def visible_comment_for(db: DbSession, user: User, comment_id: uuid.UUID) -> Comment | None:
    return db.scalar(select(Comment).where(Comment.id == comment_id, _visibility_clause(user)))


def create_comment(db: DbSession, author: User, *, course_id: uuid.UUID, page_url: str, page_title: str, body: str, category: str = "general", anchor_type: str = "", selected_quote: str | None = None, prefix: str | None = None, suffix: str | None = None, css_selector: str | None = None, dom_selector: str | None = None, relative_x: float | None = None, relative_y: float | None = None) -> Comment:
    if not body.strip():
        raise ValueError("body is required")
    if not page_title.strip():
        raise ValueError("page_title is required")
    if not page_url.strip():
        raise ValueError("page_url is required")
    parsed_url = urlsplit(page_url.strip())
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise ValueError("page_url must be an absolute http or https URL")
    if (relative_x is None) != (relative_y is None):
        raise ValueError("relative_x and relative_y must be supplied together")
    if (relative_x is not None and not 0 <= relative_x <= 1) or (relative_y is not None and not 0 <= relative_y <= 1):
        raise ValueError("relative coordinates must be between 0 and 1")
    has_quote = bool(selected_quote and selected_quote.strip())
    has_context = bool((prefix and prefix.strip()) or (suffix and suffix.strip()))
    has_selector = bool((css_selector and css_selector.strip()) or (dom_selector and dom_selector.strip()))
    if anchor_type == AnchorType.TEXT_HIGHLIGHT.value:
        if not has_quote or not (has_context or has_selector):
            raise ValueError("text_highlight requires a selected_quote and context or selector")
    elif anchor_type == AnchorType.VISUAL_PIN.value:
        if not has_selector or relative_x is None or relative_y is None:
            raise ValueError("visual_pin requires a selector and paired coordinates")
    else:
        raise ValueError("Invalid anchor type")
    instant = utc_now()
    location = PageLocation(course_id=course_id, page_url=page_url.strip(), page_title=page_title.strip(), anchor_type=anchor_type, selected_quote=selected_quote, prefix=prefix, suffix=suffix, css_selector=css_selector, dom_selector=dom_selector, relative_x=relative_x, relative_y=relative_y, created_at=instant)
    db.add(location)
    db.flush()
    comment = Comment(course_id=course_id, location_id=location.id, author_user_id=author.id, author_role=author.role, body=body.strip(), category=CommentCategory(category), status=CommentStatus.OPEN, created_at=instant, updated_at=instant)
    db.add(comment)
    db.flush()
    db.add(CommentStatusEvent(comment_id=comment.id, actor_user_id=author.id, status=CommentStatus.OPEN, created_at=instant))
    db.commit()
    db.refresh(comment)
    return comment


def update_comment_status(db: DbSession, actor: User, comment: Comment, status: str) -> Comment:
    if actor.role is not UserRole.LD_DCD:
        raise AuthorizationError("Only an LD/DCD can change comment status")
    new_status = CommentStatus(status)
    if new_status not in STATUS_TRANSITIONS[comment.status]:
        raise ValueError(f"Invalid status transition: {comment.status.value} -> {new_status.value}")
    instant = utc_now()
    comment.status, comment.updated_at = new_status, instant
    db.add(CommentStatusEvent(comment_id=comment.id, actor_user_id=actor.id, status=new_status, created_at=instant))
    db.commit()
    db.refresh(comment)
    return comment


def create_reply(db: DbSession, actor: User, comment: Comment, body: str) -> CommentReply:
    if not body.strip():
        raise ValueError("body is required")
    if comment.author_role is UserRole.BETA_TESTER:
        if actor.id != comment.author_user_id and actor.role is not UserRole.LD_DCD:
            raise AuthorizationError("Only the beta author or an LD/DCD can reply to a beta thread")
    elif actor.role is UserRole.BETA_TESTER and actor.id != comment.author_user_id:
        raise AuthorizationError("Beta testers can reply only to their own threads")
    reply = CommentReply(comment_id=comment.id, author_user_id=actor.id, body=body.strip(), created_at=utc_now())
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def share_comment_with_user(db: DbSession, actor: User, comment: Comment, shared_with: User) -> CommentShare:
    if actor.role is not UserRole.LD_DCD:
        raise AuthorizationError("Only an LD/DCD can share a thread")
    if shared_with.role is not UserRole.SME or shared_with.approved_at is None:
        raise ValueError("Threads can be shared only with an SME account")
    share = CommentShare(comment_id=comment.id, shared_with_user_id=shared_with.id, shared_by_user_id=actor.id, created_at=utc_now())
    db.add(share)
    try:
        db.commit()
    except Exception:
        db.rollback()
        existing = db.scalar(select(CommentShare).where(CommentShare.comment_id == comment.id, CommentShare.shared_with_user_id == shared_with.id))
        if existing is not None:
            return existing
        raise
    db.refresh(share)
    return share
