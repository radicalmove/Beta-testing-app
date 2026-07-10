import uuid

from sqlalchemy.orm import Session as DbSession

from app.models import AnchorType, Comment, CommentCategory, CommentStatus, CommentStatusEvent, PageLocation, User, UserRole
from app.security import utc_now


class AuthorizationError(Exception):
    pass


def create_comment(db: DbSession, author: User, *, course_id: uuid.UUID, page_url: str, page_title: str, body: str, category: str, anchor_type: str, selected_quote: str | None = None, prefix: str | None = None, suffix: str | None = None, css_selector: str | None = None, dom_selector: str | None = None, relative_x: float | None = None, relative_y: float | None = None) -> Comment:
    if not body.strip():
        raise ValueError("body is required")
    if not page_title.strip():
        raise ValueError("page_title is required")
    if not page_url.strip():
        raise ValueError("page_url is required")
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
    location = PageLocation(course_id=course_id, page_url=page_url.strip(), page_title=page_title.strip(), anchor_type=AnchorType(anchor_type), selected_quote=selected_quote, prefix=prefix, suffix=suffix, css_selector=css_selector, dom_selector=dom_selector, relative_x=relative_x, relative_y=relative_y, created_at=instant)
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
