"""One-time deployment bootstrap: run after migrations, before public registration."""

from app.config import get_settings
from app.db import SessionLocal
from app.services.accounts import provision_bootstrap_admin


def main() -> None:
    settings = get_settings()
    if not settings.bootstrap_admin_email or not settings.bootstrap_admin_password:
        raise SystemExit("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to provision the first admin.")
    session = SessionLocal()
    try:
        user = provision_bootstrap_admin(session, email=settings.bootstrap_admin_email, password=settings.bootstrap_admin_password)
    finally:
        session.close()
    if user is None:
        print("An administrator already exists; bootstrap skipped.")
    else:
        print(f"Provisioned administrator {user.email}.")


if __name__ == "__main__":
    main()
