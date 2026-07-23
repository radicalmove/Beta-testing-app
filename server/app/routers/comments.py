import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.config import Settings, get_settings
from app.dependencies import current_api_user, require_course_access
from app.models import Comment, CommentReply, CommentStatusEvent, Course, CourseMembership, MembershipState, User, UserRole
from app.schemas import CommentCreateRequest, CommentReplyRequest, CommentShareRequest, CommentSmeRecipientsRequest, CommentStatusRequest, CommentUpdateRequest, RiseInteractionContext
from app.services.attachments import delete_attachment_objects
from app.services.comments import AuthorizationError, PageComment, comment_capabilities, course_role_for, create_comment, create_reply, delete_comment_thread, replace_sme_recipients, share_comment_with_user, sme_recipient_state, update_comment_body, update_comment_status, visible_comment_for, visible_comments_for, visible_page_comments_for

router = APIRouter(prefix="/api/comments", tags=["comments"])


def _reply_json(reply: CommentReply) -> dict[str, str]:
    return {"id": str(reply.id), "author_user_id": str(reply.author_user_id), "body": reply.body}


def _page_comment_json(projected: PageComment, viewer: User, db: DbSession) -> dict:
    comment, location, author = projected.comment, projected.location, projected.author
    interaction_context = None if location.interaction_context is None else RiseInteractionContext.model_validate(location.interaction_context).model_dump(mode="json")
    return {
        "id": str(comment.id), "body": comment.body, "category": comment.category.value,
        "status": comment.status.value, "author": {"display_name": author.display_name, "role": projected.author_role.value}, "page_url": location.page_url, "page_title": location.page_title,
        "parent_activity_url": location.parent_activity_url, "embedded_locator": location.embedded_locator, "interaction_context": interaction_context,
        "anchor_type": location.anchor_type.value if hasattr(location.anchor_type, "value") else location.anchor_type, "selected_quote": location.selected_quote,
        "prefix": location.prefix, "suffix": location.suffix, "css_selector": location.css_selector,
        "dom_selector": location.dom_selector, "relative_x": location.relative_x, "relative_y": location.relative_y,
        "replies": [
            {"id": str(reply.id), "body": reply.body, "author": {"display_name": reply_author.display_name, "role": reply_role.value}}
            for reply, reply_author, reply_role in projected.replies
        ],
        "status_history": [
            {"status": event.status.value, "created_at": event.created_at.isoformat(), "actor": actor.display_name}
            for event, actor in projected.status_events
        ],
        "capabilities": comment_capabilities(db, viewer, comment),
    }


def _sme_recipients_json(db: DbSession, comment: Comment) -> dict:
    available, selected = sme_recipient_state(db, comment)
    return {
        "available_recipients": [{"id": str(user.id), "display_name": user.display_name} for user in available],
        "selected_user_ids": [str(user_id) for user_id in selected],
    }


def _comment_json(comment: Comment, db: DbSession | None = None, viewer: User | None = None) -> dict:
    result = {"id": str(comment.id), "course_id": str(comment.course_id), "location_id": str(comment.location_id), "author_user_id": str(comment.author_user_id), "category": comment.category.value, "status": comment.status.value, "body": comment.body}
    if db is not None and viewer is not None:
        replies = list(db.query(CommentReply).filter_by(comment_id=comment.id).order_by(CommentReply.created_at, CommentReply.id))
        if course_role_for(db, viewer, comment.course_id) is UserRole.BETA_TESTER:
            allowed = {viewer.id}
            allowed.update(
                membership.user_id
                for membership in db.query(CourseMembership).filter(
                    CourseMembership.course_id == comment.course_id,
                    CourseMembership.state == MembershipState.APPROVED,
                    CourseMembership.role.in_((UserRole.LD_DCD, UserRole.ADMIN)),
                )
            )
            # Legacy course-team accounts may not yet have a membership row. Keep
            # their global role as the migration fallback, but let an approved
            # course membership override it through ``course_role_for``.
            allowed.update(
                candidate.id
                for candidate in db.query(User).filter(User.role.in_((UserRole.LD_DCD, UserRole.ADMIN)))
                if course_role_for(db, candidate, comment.course_id) in {UserRole.LD_DCD, UserRole.ADMIN}
            )
            replies = [reply for reply in replies if reply.author_user_id in allowed]
        result["replies"] = [_reply_json(reply) for reply in replies]
        events = list(db.query(CommentStatusEvent).filter_by(comment_id=comment.id).order_by(CommentStatusEvent.created_at, CommentStatusEvent.id))
        result["status_history"] = [{"status": event.status.value, "created_at": event.created_at.isoformat()} for event in events]
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def create(payload: CommentCreateRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    require_course_access(user, payload.course_id)
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
    require_course_access(user, comment.course_id)
    try:
        return _comment_json(update_comment_status(db, user, comment, payload.status))
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("")
def list_comments(course_id: uuid.UUID, page_url: str | None = Query(default=None, min_length=1, max_length=4096), user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> list[dict]:
    require_course_access(user, course_id)
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return [_page_comment_json(comment, user, db) for comment in visible_page_comments_for(db, user, course_id, page_url)]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{comment_id}")
def get_comment(comment_id: uuid.UUID, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, comment.course_id)
    return _comment_json(comment, db, user)


@router.patch("/{comment_id}")
def edit_comment(comment_id: uuid.UUID, payload: CommentUpdateRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict:
    visible = visible_comment_for(db, user, comment_id)
    if visible is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, visible.course_id)
    try:
        comment = update_comment_body(db, user, comment_id, payload.body)
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return _comment_json(comment)


@router.get("/{comment_id}/sme-recipients")
def get_sme_recipients(comment_id: uuid.UUID, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, comment.course_id)
    if course_role_for(db, user, comment.course_id) not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise HTTPException(status_code=403, detail="Only an LD/DCD can ask SMEs")
    if comment.author_role is not UserRole.BETA_TESTER:
        raise HTTPException(status_code=422, detail="Only beta-tester feedback can be shared with SMEs")
    return _sme_recipients_json(db, comment)


@router.put("/{comment_id}/sme-recipients")
def put_sme_recipients(comment_id: uuid.UUID, payload: CommentSmeRecipientsRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict:
    visible = visible_comment_for(db, user, comment_id)
    if visible is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, visible.course_id)
    try:
        comment = replace_sme_recipients(db, user, comment_id, payload.user_ids)
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    return _sme_recipients_json(db, comment)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(comment_id: uuid.UUID, user: User = Depends(current_api_user), db: DbSession = Depends(get_session), settings: Settings = Depends(get_settings)) -> None:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, comment.course_id)
    try:
        object_names = delete_comment_thread(db, user, comment)
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    delete_attachment_objects(object_names, settings.attachment_storage_dir)


@router.post("/{comment_id}/replies", status_code=status.HTTP_201_CREATED)
def reply(comment_id: uuid.UUID, payload: CommentReplyRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, comment.course_id)
    try:
        return _reply_json(create_reply(db, user, comment, payload.body))
    except (AuthorizationError, ValueError) as exc:
        raise HTTPException(status_code=403 if isinstance(exc, AuthorizationError) else 422, detail=str(exc)) from exc


@router.post("/{comment_id}/share", status_code=status.HTTP_201_CREATED)
def share(comment_id: uuid.UUID, payload: CommentShareRequest, user: User = Depends(current_api_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    require_course_access(user, comment.course_id)
    recipient = db.get(User, payload.user_id)
    if recipient is None:
        raise HTTPException(status_code=404, detail="User not found")
    recipient_membership = db.query(CourseMembership).filter_by(
        user_id=recipient.id,
        course_id=comment.course_id,
        role=UserRole.SME,
        state=MembershipState.APPROVED,
    ).one_or_none()
    if getattr(user, "course_id", None) is not None and recipient_membership is None:
        raise HTTPException(status_code=422, detail="Threads can be shared only with an approved SME in this course")
    try:
        share_record = share_comment_with_user(db, user, comment, recipient)
        return {"id": str(share_record.id), "comment_id": str(share_record.comment_id), "shared_with_user_id": str(share_record.shared_with_user_id)}
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
