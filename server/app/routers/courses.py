import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_extension_user, require_course_access
from app.models import Course, User, UserRole
from app.schemas import CourseConfirmRequest, CourseResolveRequest
from app.services.courses import confirm_course, resolve_course
from app.services.summary import SummaryAccessDenied, course_summary_for

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _course_json(course: Course) -> dict[str, object]:
    return {"id": str(course.id), "moodle_course_id": course.moodle_course_id, "course_url": course.normalized_url, "title": course.title, "is_confirmed": course.is_confirmed}


@router.post("/resolve", status_code=status.HTTP_201_CREATED)
def resolve(payload: CourseResolveRequest, user: User = Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict[str, object]:
    try:
        return _course_json(resolve_course(db, **payload.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{course_id}/confirm")
def confirm(course_id: uuid.UUID, payload: CourseConfirmRequest, user: User = Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict[str, object]:
    if user.role not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise HTTPException(status_code=403, detail="LD/DCD or administrator access required")
    source = db.get(Course, course_id)
    if source is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return _course_json(confirm_course(db, source, **payload.model_dump()))
    except ValueError as exc:
        status_code = status.HTTP_409_CONFLICT if source.is_confirmed else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.get("/{course_id}/summary")
def summary(course_id: uuid.UUID, user=Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict:
    require_course_access(user, course_id)
    if db.get(Course, course_id) is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        return course_summary_for(db, user, course_id)
    except SummaryAccessDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
