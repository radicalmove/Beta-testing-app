import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_extension_user
from app.models import Comment, Course, User
from app.schemas import CommentCreateRequest, CommentStatusRequest
from app.services.comments import AuthorizationError, create_comment, update_comment_status

router = APIRouter(prefix="/api/comments", tags=["comments"])


def _comment_json(comment: Comment) -> dict[str, str]:
    return {"id": str(comment.id), "course_id": str(comment.course_id), "location_id": str(comment.location_id), "category": comment.category.value, "status": comment.status.value, "body": comment.body}


@router.post("", status_code=status.HTTP_201_CREATED)
def create(payload: CommentCreateRequest, user: User = Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    if db.get(Course, payload.course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return _comment_json(create_comment(db, user, **payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{comment_id}/status")
def set_status(comment_id: uuid.UUID, payload: CommentStatusRequest, user: User = Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict[str, str]:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    try:
        return _comment_json(update_comment_status(db, user, comment, payload.status))
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
