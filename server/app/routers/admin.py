import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_dashboard_user
from app.models import Course, CourseMembership, MembershipState, User, UserRole
from app.routers.auth import _form_with_csrf
from app.security import generate_token
from app.schemas import RoleChangeRequest
from app.services.accounts import AuthorizationError, approve_account, change_role
from app.services.access import AccessDenied, create_invitation

router = APIRouter(prefix="/admin")
templates = Jinja2Templates(directory="app/templates")


def _admin(user: User) -> User:
    if user.role is not UserRole.ADMIN or user.approved_at is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


def _target(db: DbSession, user_id: str) -> User:
    try:
        user = db.get(User, uuid.UUID(user_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="User not found") from exc
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/users", response_class=HTMLResponse)
def users_page(request: Request, course_id: uuid.UUID | None = None, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)) -> HTMLResponse:
    _admin(user)
    token = request.cookies.get("csrf_token") or generate_token()
    courses = db.scalars(select(Course).where(Course.is_confirmed.is_(True)).order_by(Course.title)).all()
    selected_course = None
    memberships = []
    if course_id is not None:
        selected_course = db.get(Course, course_id)
        if selected_course is None or not selected_course.is_confirmed:
            raise HTTPException(status_code=404, detail="Course not found")
        memberships = db.execute(select(CourseMembership, User).join(User, User.id == CourseMembership.user_id).where(CourseMembership.course_id == course_id).order_by(User.display_name)).all()
    response = templates.TemplateResponse(request, "admin/users.html", {"users": db.scalars(select(User).order_by(User.created_at)).all(), "courses": courses, "selected_course": selected_course, "memberships": memberships, "csrf_token": token, "roles": list(UserRole)})
    if request.cookies.get("csrf_token") != token:
        response.set_cookie("csrf_token", token, secure=True, samesite="lax")
    return response


@router.post("/users/{user_id}/approve")
async def approve_user(request: Request, user_id: str, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    _admin(user)
    is_json = request.headers.get("content-type", "").startswith("application/json")
    if not is_json:
        await _form_with_csrf(request)
    target = _target(db, user_id)
    try:
        approve_account(db, user, target)
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail="Administrator access required") from exc
    if is_json:
        return {"id": str(target.id), "status": "approved"}
    return RedirectResponse("/admin/users", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/users/{user_id}/role")
async def set_role(request: Request, user_id: str, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    _admin(user)
    is_json = request.headers.get("content-type", "").startswith("application/json")
    if is_json:
        try:
            payload = RoleChangeRequest.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="Invalid role") from exc
    else:
        try:
            payload = RoleChangeRequest.model_validate(await _form_with_csrf(request))
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail="Invalid role") from exc
    try:
        role = UserRole(payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid role") from exc
    target = _target(db, user_id)
    try:
        change_role(db, user, target, role)
    except AuthorizationError as exc:
        raise HTTPException(status_code=403, detail="Administrator access required") from exc
    if is_json:
        return {"id": str(target.id), "role": target.role.value}
    return RedirectResponse("/admin/users", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/courses/{course_id}/invitations", response_class=HTMLResponse)
async def create_course_invitation(request: Request, course_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    _admin(user)
    form = await _form_with_csrf(request)
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        _, raw = create_invitation(db, user, course, str(form.get("email", "")), UserRole(str(form.get("role", ""))))
    except (AccessDenied, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Could not create invitation") from exc
    return HTMLResponse(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reviewer invitation</title><link rel="stylesheet" href="/static/app.css"></head><body><main class="page"><p class="eyebrow">Invitation created</p><h1>{course.title}</h1><p>Send this one-time code privately to the reviewer. It will not be shown again.</p><output class="code">{raw}</output><p><a href="/admin/users?course_id={course.id}">Return to this course</a></p></main></body></html>')


@router.post("/memberships/{membership_id}/state")
async def set_membership_state(request: Request, membership_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    _admin(user)
    form = await _form_with_csrf(request)
    membership = db.get(CourseMembership, membership_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    try:
        membership.state = MembershipState(str(form.get("state", "")))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid membership state") from exc
    from app.security import utc_now
    membership.updated_at = utc_now()
    membership.approved_by_user_id = user.id if membership.state is MembershipState.APPROVED else None
    membership.approved_at = membership.updated_at if membership.state is MembershipState.APPROVED else None
    db.commit()
    return RedirectResponse(f"/admin/users?course_id={membership.course_id}", status_code=303)
