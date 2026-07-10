import uuid
from urllib.parse import urlsplit

from sqlalchemy import or_, select
from sqlalchemy.orm import Session as DbSession, aliased

from app.models import AnchorType, Comment, CommentCategory, CommentReply, CommentShare, CommentStatus, CommentStatusEvent, PageLocation, User, UserRole
from app.security import utc_now


class AuthorizationError(Exception):
    pass


def visible_comments_for(db: DbSession, user: User, course_id: uuid.UUID) -> list[Comment]:
    """Return exactly the course threads this user is allowed to discover."""
    query = select(Comment).where(Comment.course_id == course_id)
    if user.role in {UserRole.LD_DCD, UserRole.ADMIN}:
        return list(db.scalars(query.order_by(Comment.created_at)))
    if user.role is UserRole.BETA_TESTER:
        query = query.where(Comment.author_user_id == user.id)
    elif user.role is UserRole.SME:
        author = aliased(User)
        query = query.join(author, Comment.author_user_id == author.id).outerjoin(CommentShare, CommentShare.comment_id == Comment.id).where(
            or_(author.role == UserRole.SME, CommentShare.shared_with_user_id == user.id)
        )
    else:
        query = query.where(False)
    return list(db.scalars(query.order_by(Comment.created_at)))


def visible_comment_for(db: DbSession, user: User, comment_id: uuid.UUID) -> Comment | None:
    comment = db.get(Comment, comment_id)
    if comment is None:
        return None
    return next((item for item in visible_comments_for(db, user, comment.course_id) if item.id == comment_id), None)


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
    comment = Comment(course_id=course_id, location_id=location.id, author_user_id=author.id, body=body.strip(), category=CommentCategory(category), status=CommentStatus.OPEN, created_at=instant, updated_at=instant)
    db.add(comment)
    db.flush()
    db.add(CommentStatusEvent(comment_id=comment.id, actor_user_id=author.id, status=CommentStatus.OPEN, created_at=instant))
    db.commit()
    db.refresh(comment)
    return comment


def update_comment_status(db: DbSession, actor: User, comment: Comment, status: str) -> Comment:
    if actor.id != comment.author_user_id and actor.role not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only the author or an LD/DCD or administrator can change comment status")
    new_status = CommentStatus(status)
    instant = utc_now()
    comment.status, comment.updated_at = new_status, instant
    db.add(CommentStatusEvent(comment_id=comment.id, actor_user_id=actor.id, status=new_status, created_at=instant))
    db.commit()
    db.refresh(comment)
    return comment


def create_reply(db: DbSession, actor: User, comment: Comment, body: str) -> CommentReply:
    if not body.strip():
        raise ValueError("body is required")
    if actor.role is UserRole.BETA_TESTER and actor.id != comment.author_user_id:
        raise AuthorizationError("Beta testers can reply only to their own threads")
    reply = CommentReply(comment_id=comment.id, author_user_id=actor.id, body=body.strip(), created_at=utc_now())
    db.add(reply)
    db.commit()
    db.refresh(reply)
    return reply


def share_comment_with_user(db: DbSession, actor: User, comment: Comment, shared_with: User) -> CommentShare:
    if actor.role not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise AuthorizationError("Only an LD/DCD or administrator can share a thread")
    if shared_with.role is not UserRole.SME:
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
