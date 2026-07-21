import uuid
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session as DbSession

from app.models import AnchorType, Attachment, Comment, CommentCategory, CommentReadState, CommentReply, CommentShare, CommentStatus, CommentStatusEvent, CourseMembership, MembershipState, PageLocation, User, UserRole
from app.url_validation import canonical_https_url
from app.security import utc_now


class AuthorizationError(Exception):
    pass


STATUS_TRANSITIONS = {
    CommentStatus.OPEN: (CommentStatus.IN_PROGRESS, CommentStatus.DEFERRED),
    CommentStatus.IN_PROGRESS: (CommentStatus.AWAITING_SME, CommentStatus.RESOLVED, CommentStatus.DEFERRED),
    CommentStatus.AWAITING_SME: (CommentStatus.IN_PROGRESS, CommentStatus.RESOLVED, CommentStatus.DEFERRED),
    CommentStatus.RESOLVED: (CommentStatus.OPEN,),
    CommentStatus.DEFERRED: (),
}


def allowed_status_choices(current: CommentStatus) -> tuple[CommentStatus, ...]:
    """Render the current value plus exactly the transitions accepted by the service."""
    return (current, *STATUS_TRANSITIONS[current])


def _visibility_clause(user: User, role: UserRole | None = None):
    effective_role = role or user.role
    if effective_role in {UserRole.LD_DCD, UserRole.ADMIN}:
        return True
    if effective_role is UserRole.BETA_TESTER:
        return Comment.author_user_id == user.id
    if effective_role is UserRole.SME:
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
    author_role: UserRole
    replies: tuple[tuple[CommentReply, User, UserRole], ...]
    status_events: tuple[tuple[CommentStatusEvent, User], ...]


def course_role_for(db: DbSession, user: User, course_id: uuid.UUID) -> UserRole:
    """Use the approved course role; global roles are only a legacy fallback."""
    if user.role is UserRole.ADMIN:
        return UserRole.ADMIN
    membership_role = db.scalar(select(CourseMembership.role).where(
        CourseMembership.user_id == user.id,
        CourseMembership.course_id == course_id,
        CourseMembership.state == MembershipState.APPROVED,
    ))
    return membership_role or user.role


def comment_capabilities(db: DbSession, viewer: User, comment: Comment) -> dict:
    viewer_role = course_role_for(db, viewer, comment.course_id)
    is_author = viewer.id == comment.author_user_id
    is_lead = viewer_role is UserRole.LD_DCD
    is_admin = viewer_role is UserRole.ADMIN
    is_assigned_sme = viewer_role is UserRole.SME and db.scalar(select(CommentShare.id).where(
        CommentShare.comment_id == comment.id,
        CommentShare.shared_with_user_id == viewer.id,
    ).limit(1)) is not None
    if comment.author_role is UserRole.BETA_TESTER:
        can_reply = is_author or is_lead or is_admin or is_assigned_sme
    else:
        can_reply = viewer_role is not UserRole.BETA_TESTER or is_author
    return {
        "can_reply": can_reply,
        "can_change_status": is_lead or is_admin,
        "can_share_with_sme": (is_lead or is_admin) and comment.author_role is UserRole.BETA_TESTER,
        "can_delete": is_author or is_lead or is_admin,
        "can_edit": is_author,
        "allowed_statuses": [item.value for item in allowed_status_choices(comment.status)] if is_lead or is_admin else [comment.status.value],
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


def _reply_visible_to(db: DbSession, viewer: User, comment: Comment, reply_author: User) -> bool:
    viewer_role = course_role_for(db, viewer, comment.course_id)
    reply_role = course_role_for(db, reply_author, comment.course_id)
    if viewer_role is UserRole.BETA_TESTER:
        return reply_author.id == viewer.id or reply_role in {UserRole.LD_DCD, UserRole.ADMIN}
    return True


def dashboard_comments_for(db: DbSession, user: User) -> list[DashboardComment]:
    """Project all visible dashboard data without loading reply or user records."""
    author = aliased(User)
    reply_author = aliased(User)
    eligible_reply = and_(
        CommentReply.comment_id == Comment.id,
        CommentReply.author_user_id != user.id,
        or_(
            and_(Comment.author_role == UserRole.BETA_TESTER, or_(CommentReply.author_user_id == Comment.author_user_id, reply_author.role.in_((UserRole.LD_DCD, UserRole.ADMIN)))),
            and_(Comment.author_role != UserRole.BETA_TESTER, or_(CommentReply.author_user_id == Comment.author_user_id, reply_author.role.in_((UserRole.SME, UserRole.LD_DCD, UserRole.ADMIN)))),
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
        .order_by(Comment.created_at, Comment.id)
    ).all()
    return [DashboardComment(comment, location, author_display, reply_at, reply_by, read_at) for comment, location, author_display, reply_at, reply_by, read_at in rows]


def visible_comments_for(db: DbSession, user: User, course_id: uuid.UUID) -> list[Comment]:
    """Return exactly the course threads this user is allowed to discover."""
    query = select(Comment).where(Comment.course_id == course_id)
    query = query.where(_visibility_clause(user, course_role_for(db, user, course_id)))
    return list(db.scalars(query.order_by(Comment.created_at, Comment.id)))


def visible_page_comments_for(db: DbSession, user: User, course_id: uuid.UUID, page_url: str | None = None) -> list[PageComment]:
    """Load visible course threads, optionally restricted to one exact page."""
    normalized = normalized_page_url(page_url) if page_url is not None else None
    author = aliased(User)
    query = (
        select(Comment, PageLocation, author)
        .join(PageLocation, PageLocation.id == Comment.location_id)
        .join(author, author.id == Comment.author_user_id)
        .where(Comment.course_id == course_id, _visibility_clause(user, course_role_for(db, user, course_id)))
        .order_by(Comment.created_at, Comment.id)
    )
    if normalized is not None:
        query = query.where(PageLocation.page_url == normalized)
    rows = db.execute(query).all()
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
    replies_by_comment: dict[uuid.UUID, list[tuple[CommentReply, User, UserRole]]] = {comment_id: [] for comment_id in comment_ids}
    for reply, reply_by in reply_rows:
        reply_role = course_role_for(db, reply_by, comments_by_id[reply.comment_id].course_id)
        if _reply_visible_to(db, user, comments_by_id[reply.comment_id], reply_by):
            replies_by_comment[reply.comment_id].append((reply, reply_by, reply_role))
    events_by_comment: dict[uuid.UUID, list[tuple[CommentStatusEvent, User]]] = {comment_id: [] for comment_id in comment_ids}
    for event, actor in event_rows:
        events_by_comment[event.comment_id].append((event, actor))
    return [PageComment(comment, location, thread_author, course_role_for(db, thread_author, comment.course_id), tuple(replies_by_comment[comment.id]), tuple(events_by_comment[comment.id])) for comment, location, thread_author in rows]


def visible_comment_for(db: DbSession, user: User, comment_id: uuid.UUID) -> Comment | None:
    comment = db.get(Comment, comment_id)
    if comment is None:
        return None
    allowed = db.scalar(select(Comment.id).where(
        Comment.id == comment_id,
        _visibility_clause(user, course_role_for(db, user, comment.course_id)),
    ))
    return comment if allowed is not None else None


def delete_comment_thread(db: DbSession, actor: User, comment: Comment) -> tuple[str, ...]:
    comment = db.scalar(select(Comment).where(Comment.id == comment.id).with_for_update())
    if comment is None:
        return ()
    if actor.id != comment.author_user_id and course_role_for(db, actor, comment.course_id) not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only the author or an LD/DCD can delete this thread")
    location_id = comment.location_id
    attachments = list(db.scalars(select(Attachment).where(Attachment.comment_id == comment.id)))
    object_names = tuple(item.object_name for item in attachments)
    for model in (CommentReply, CommentStatusEvent, CommentShare, CommentReadState, Attachment):
        db.execute(delete(model).where(model.comment_id == comment.id))
    db.delete(comment)
    db.flush()
    if location_id is not None and db.scalar(select(Comment.id).where(Comment.location_id == location_id).limit(1)) is None:
        location = db.get(PageLocation, location_id)
        if location is not None:
            db.delete(location)
    db.commit()
    return object_names


def update_comment_body(db: DbSession, actor: User, comment_id: uuid.UUID, body: str) -> Comment | None:
    comment = db.scalar(select(Comment).where(Comment.id == comment_id).with_for_update())
    if comment is None:
        return None
    if actor.id != comment.author_user_id:
        raise AuthorizationError("Only the author can edit this observation")
    comment.body = body.strip()
    comment.updated_at = utc_now()
    db.commit()
    db.refresh(comment)
    return comment


def sme_recipient_state(db: DbSession, comment: Comment) -> tuple[list[User], list[uuid.UUID]]:
    available = list(db.scalars(
        select(User).join(CourseMembership, CourseMembership.user_id == User.id).where(
            CourseMembership.course_id == comment.course_id,
            CourseMembership.role == UserRole.SME,
            CourseMembership.state == MembershipState.APPROVED,
        ).order_by(User.display_name, User.email, User.id)
    ))
    selected = list(db.scalars(select(CommentShare.shared_with_user_id).where(CommentShare.comment_id == comment.id).order_by(CommentShare.created_at, CommentShare.id)))
    return available, selected


def replace_sme_recipients(db: DbSession, actor: User, comment_id: uuid.UUID, user_ids: list[uuid.UUID]) -> Comment | None:
    comment = db.scalar(select(Comment).where(Comment.id == comment_id).with_for_update())
    if comment is None:
        return None
    if course_role_for(db, actor, comment.course_id) not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only an LD/DCD can ask SMEs")
    if comment.author_role is not UserRole.BETA_TESTER:
        raise ValueError("Only beta-tester feedback can be shared with SMEs")
    valid = set(db.scalars(select(CourseMembership.user_id).where(
        CourseMembership.course_id == comment.course_id,
        CourseMembership.role == UserRole.SME,
        CourseMembership.state == MembershipState.APPROVED,
        CourseMembership.user_id.in_(user_ids),
    ))) if user_ids else set()
    if valid != set(user_ids):
        raise ValueError("Recipients must be approved SMEs in this course")
    db.execute(delete(CommentShare).where(CommentShare.comment_id == comment.id))
    instant = utc_now()
    for user_id in user_ids:
        db.add(CommentShare(comment_id=comment.id, shared_with_user_id=user_id, shared_by_user_id=actor.id, created_at=instant))
    db.commit()
    return comment


def create_comment(db: DbSession, author: User, *, course_id: uuid.UUID, page_url: str, page_title: str, body: str, category: str = "general", anchor_type: str = "", selected_quote: str | None = None, prefix: str | None = None, suffix: str | None = None, css_selector: str | None = None, dom_selector: str | None = None, relative_x: float | None = None, relative_y: float | None = None, parent_activity_url: str | None = None, embedded_locator: str | None = None) -> Comment:
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
    if (parent_activity_url is None) != (embedded_locator is None):
        raise ValueError("parent_activity_url and embedded_locator must be supplied together")
    if parent_activity_url is not None:
        canonical_https_url(parent_activity_url, "parent_activity_url", max_length=4096)
        if not embedded_locator or len(embedded_locator) > 2048 or embedded_locator != embedded_locator.strip() or any(ord(character) <= 32 or ord(character) == 127 or character == "\\" for character in embedded_locator) or not embedded_locator.startswith(("#", "/")) or embedded_locator.startswith("//"):
            raise ValueError("embedded_locator must be a safe Rise hash or root-relative route")
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
    location = PageLocation(course_id=course_id, page_url=page_url.strip(), page_title=page_title.strip(), anchor_type=anchor_type, selected_quote=selected_quote, prefix=prefix, suffix=suffix, css_selector=css_selector, dom_selector=dom_selector, relative_x=relative_x, relative_y=relative_y, parent_activity_url=parent_activity_url, embedded_locator=embedded_locator, created_at=instant)
    db.add(location)
    db.flush()
    comment = Comment(course_id=course_id, location_id=location.id, author_user_id=author.id, author_role=course_role_for(db, author, course_id), body=body.strip(), category=CommentCategory(category), status=CommentStatus.OPEN, created_at=instant, updated_at=instant)
    db.add(comment)
    db.flush()
    db.add(CommentStatusEvent(comment_id=comment.id, actor_user_id=author.id, status=CommentStatus.OPEN, created_at=instant))
    db.commit()
    db.refresh(comment)
    return comment


def update_comment_status(db: DbSession, actor: User, comment: Comment, status: str) -> Comment:
    comment = db.scalar(select(Comment).where(Comment.id == comment.id).with_for_update())
    if comment is None:
        raise ValueError("Comment no longer exists")
    if course_role_for(db, actor, comment.course_id) not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only an LD/DCD can change comment status")
    new_status = CommentStatus(status)
    if new_status is comment.status:
        return comment
    if new_status is CommentStatus.RESOLVED and comment.status is not CommentStatus.RESOLVED:
        pass
    elif new_status not in STATUS_TRANSITIONS[comment.status]:
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
    actor_role = course_role_for(db, actor, comment.course_id)
    if comment.author_role is UserRole.BETA_TESTER:
        assigned_sme = actor_role is UserRole.SME and db.scalar(select(CommentShare.id).where(
            CommentShare.comment_id == comment.id,
            CommentShare.shared_with_user_id == actor.id,
        ).limit(1)) is not None
        if actor.id != comment.author_user_id and actor_role not in {UserRole.LD_DCD, UserRole.ADMIN} and not assigned_sme:
            raise AuthorizationError("Only the beta author, an LD/DCD, or an administrator can reply to a beta thread")
    elif actor_role is UserRole.BETA_TESTER and actor.id != comment.author_user_id:
        raise AuthorizationError("Beta testers can reply only to their own threads")
    reply = CommentReply(comment_id=comment.id, author_user_id=actor.id, body=body.strip(), created_at=utc_now())
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def share_comment_with_user(db: DbSession, actor: User, comment: Comment, shared_with: User) -> CommentShare:
    if course_role_for(db, actor, comment.course_id) not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only an LD/DCD can share a thread")
    if comment.author_role is not UserRole.BETA_TESTER:
        raise ValueError("Only beta-tester feedback can be shared with SMEs")
    membership = db.scalar(select(CourseMembership).where(
        CourseMembership.course_id == comment.course_id,
        CourseMembership.user_id == shared_with.id,
        CourseMembership.role == UserRole.SME,
        CourseMembership.state == MembershipState.APPROVED,
    ))
    if membership is None:
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
