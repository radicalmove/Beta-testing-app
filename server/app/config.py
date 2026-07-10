from functools import lru_cache

from pydantic import PositiveInt
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Moodle Course Review"
    database_url: str = "sqlite+pysqlite:///:memory:"
    log_level: str = "INFO"
    extension_redirect_uris: str = ""
    bootstrap_admin_email: str | None = None
    bootstrap_admin_display_name: str = "Administrator"
    bootstrap_admin_password: str | None = None
    dashboard_session_hours: int = 8
    attachment_storage_dir: str = "var/attachments"
    attachment_max_bytes: PositiveInt = 5 * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
