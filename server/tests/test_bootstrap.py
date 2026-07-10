from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import AuditEvent, UserRole
from app.services.accounts import provision_bootstrap_admin


def test_bootstrap_admin_requires_deployment_secret_and_is_audited():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    user = provision_bootstrap_admin(session, email="admin@example.test", password="long enough password")

    assert user is not None and user.role is UserRole.ADMIN and user.approved_at is not None
    assert {event.action for event in session.query(AuditEvent).all()} == {"user.approved", "user.role_changed"}
    assert provision_bootstrap_admin(session, email="second@example.test", password="long enough password") is None
