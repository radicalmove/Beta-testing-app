from fastapi import FastAPI

from app.config import get_settings
from app import models  # noqa: F401 -- ensure model metadata is available to migrations.


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
