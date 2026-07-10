from fastapi import Depends, FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.dependencies import current_dashboard_user
from app import models  # noqa: F401 -- ensure model metadata is available to migrations.
from app.models import User, UserRole
from app.routers import admin, attachments, auth, comments, courses, dashboard


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(courses.router)
    app.include_router(comments.router)
    app.include_router(attachments.router)
    app.include_router(dashboard.router)

    @app.get("/", response_class=HTMLResponse)
    def landing(user: User = Depends(current_dashboard_user)) -> Response:
        if user.role is UserRole.ADMIN:
            return RedirectResponse("/admin/users", status_code=303)
        return RedirectResponse("/dashboard", status_code=303)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
