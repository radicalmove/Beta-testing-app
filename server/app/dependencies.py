from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.models import User, UserRole
from app.services.accounts import AuthenticationError, ExtensionAccess, verify_dashboard_session, verify_extension_access


def current_extension_user(request: Request, db: DbSession = Depends(get_session)) -> ExtensionAccess:
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    try:
        return verify_extension_access(db, token)
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required") from exc


current_api_user = current_extension_user


def require_course_access(user: ExtensionAccess, course_id) -> None:
    if user.course_id is not None and user.course_id != course_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")


def current_dashboard_user(request: Request, db: DbSession = Depends(get_session)) -> User:
    try:
        return verify_dashboard_session(db, request.cookies.get("dashboard_session", ""))
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required") from exc


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    def dependency(user: User = Depends(current_extension_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return dependency
