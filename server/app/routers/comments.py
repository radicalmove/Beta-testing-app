import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_api_user
from app.models import Comment, CommentReply, CommentStatusEvent, Course, User, UserRole
from app.schemas import CommentCreateRequest, CommentReplyRequest, CommentShareRequest, CommentStatusRequest
from app.services.comments import AuthorizationError, PageComment, create_comment, create_reply, share_comment_with_user, update_comment_status, visible_comment_for, visible_comments_for, visible_page_comments_for

router = APIRouter(prefix="/api/comments", tags=["comments"])


def _reply_json(reply: CommentReply) -> dict[str, str]:
    return {"id": str(reply.id), "author_user_id": str(reply.author_user_id), "body": reply.body}


def _page_comment_json(projected: PageComment) -> dict:
    comment, location, author = projected.comment, projected.location, projected.author
    return {
        "id": str(comment.id), "body": comment.body, "category": comment.category.value,
        "status": comment.status.value, "author_user_id": str(author.id), "author_role": author.role.value,
        "author_email": author.email, "page_url": location.page_url, "page_title": location.page_title,
        "anchor_type": location.anchor_type.value if hasattr(location.anchor_type, "value") else location.anchor_type, "selected_quote": location.selected_quote,
        "prefix": location.prefix, "suffix": location.suffix, "css_selector": location.css_selector,
        "dom_selector": location.dom_selector, "relative_x": location.relative_x, "relative_y": location.relative_y,
        "replies": [
            {"id": str(reply.id), "body": reply.body, "author_user_id": str(reply_author.id), "author_role": reply_author.role.value, "author_email": reply_author.email}
            for reply, reply_author in projected.replies
        ],
        "status_history": [
            {"status": event.status.value, "actor_user_id": str(actor.id), "actor_role": actor.role.value}
            for event, actor in projected.status_events
        ],
    }


def _comment_json(comment: Comment, db: DbSession | None = None, viewer: User | None = None) -> dict:
    result = {"id": str(comment.id), "course_id": str(comment.course_id), "location_id": str(comment.location_id), "author_user_id": str(comment.author_user_id), "category": comment.category.value, "status": comment.status.value, "body": comment.body}
    if db is not None and viewer is not None:
        replies = list(db.query(CommentReply).filter_by(comment_id=comment.id).order_by(CommentReply.created_at))
        if viewer.role is UserRole.BETA_TESTER:
            allowed = {viewer.id}
            allowed.update(user.id for user in db.query(User).filter(User.role == UserRole.LD_DCD))
            replies = [reply for reply in replies if reply.author_user_id in allowed]
        result["replies"] = [_reply_json(reply) for reply in replies]
        events = list(db.query(CommentStatusEvent).filter_by(comment_id=comment.id).order_by(CommentStatusEvent.created_at))
        result["status_history"] = [{"status": event.status.value, "actor_user_id": str(event.actor_user_id)} for event in events]
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def create(payload: CommentCreateRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    if db.get(Course, payload.course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return _comment_json(create_comment(db, user, **payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{comment_id}/status")
def set_status(comment_id: uuid.UUID, payload: CommentStatusRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    try:
        return _comment_json(update_comment_status(db, user, comment, payload.status))
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("")
def list_comments(course_id: uuid.UUID, page_url: str | None = Query(default=None, min_length=1, max_length=4096), user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> list[dict]:
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    if page_url is None:
        return [_comment_json(comment) for comment in visible_comments_for(db, user, course_id)]
    try:
        return [_page_comment_json(comment) for comment in visible_page_comments_for(db, user, course_id, page_url)]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{comment_id}")
def get_comment(comment_id: uuid.UUID, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return _comment_json(comment, db, user)


@router.post("/{comment_id}/replies", status_code=status.HTTP_201_CREATED)
def reply(comment_id: uuid.UUID, payload: CommentReplyRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    try:
        return _reply_json(create_reply(db, user, comment, payload.body))
    except (AuthorizationError, ValueError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, AuthorizationError) else 422, detail=str(exc)) from exc


@router.post("/{comment_id}/share", status_code=status.HTTP_201_CREATED)
def share(comment_id: uuid.UUID, payload: CommentShareRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    recipient = db.get(User, payload.user_id)
    if recipient is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        share_record = share_comment_with_user(db, user, comment, recipient)
        return {"id": str(share_record.id), "comment_id": str(share_record.comment_id), "shared_with_user_id": str(share_record.shared_with_user_id)}
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
