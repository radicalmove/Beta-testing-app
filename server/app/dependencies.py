from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.models import User, UserRole
from app.services.accounts import AuthenticationError, verify_dashboard_session, verify_extension_session


def current_extension_user(request: Request, db: DbSession = Depends(get_session)) -> User:
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    try:
        return verify_extension_session(db, token)
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required") from exc


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
