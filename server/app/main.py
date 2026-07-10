from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app import models  # noqa: F401 -- ensure model metadata is available to migrations.
from app.routers import admin, auth


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.mount("/static", StaticFiles(directory="app/static"), name="static")
    app.include_router(auth.router)
    app.include_router(admin.router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
