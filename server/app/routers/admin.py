import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_dashboard_user
from app.models import User, UserRole
from app.routers.auth import _form_with_csrf
from app.security import generate_token
from app.schemas import RoleChangeRequest
from app.services.accounts import AuthorizationError, approve_account, change_role

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
def users_page(request: Request, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)) -> HTMLResponse:
    _admin(user)
    token = request.cookies.get("csrf_token") or generate_token()
    response = templates.TemplateResponse(request, "admin/users.html", {"users": db.scalars(select(User).order_by(User.created_at)).all(), "csrf_token": token, "roles": list(UserRole)})
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
        payload = RoleChangeRequest.model_validate(await request.json())
    else:
        payload = RoleChangeRequest.model_validate(await _form_with_csrf(request))
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
