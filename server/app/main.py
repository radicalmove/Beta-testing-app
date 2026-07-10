from fastapi import Depends, FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.dependencies import current_dashboard_user
from app import models  # noqa: F401 -- ensure model metadata is available to migrations.
from app.models import User, UserRole
from app.routers import admin, attachments, auth, comments, courses


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(courses.router)
    app.include_router(comments.router)
    app.include_router(attachments.router)

    @app.get("/", response_class=HTMLResponse)
    def landing(user: User = Depends(current_dashboard_user)) -> Response:
        if user.role is UserRole.ADMIN:
            return RedirectResponse("/admin/users", status_code=303)
        return HTMLResponse(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Moodle Course Review</title>"
            "<link rel=\"stylesheet\" href=\"/static/app.css\"></head><body><main class=\"page\">"
            "<p class=\"eyebrow\">Moodle Course Review</p><h1>You are signed in</h1>"
            "<p>Your review workspace will be available here soon.</p></main></body></html>"
        )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
