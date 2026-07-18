from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import AuditEvent, User, UserRole
from app.services.accounts import provision_bootstrap_admin


def test_bootstrap_admin_requires_deployment_secret_and_is_audited():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    user = provision_bootstrap_admin(session, email="admin@example.test", password="long enough password")

    assert user is not None and user.role is UserRole.ADMIN and user.approved_at is not None
    assert {event.action for event in session.query(AuditEvent).all()} == {"user.approved", "user.role_changed"}
    assert provision_bootstrap_admin(session, email="second@example.test", password="long enough password") is None


def test_concurrent_bootstrap_provisioning_creates_exactly_one_admin(tmp_path):
    engine = create_engine(
        f"sqlite+pysqlite:///{tmp_path / 'bootstrap.db'}",
        connect_args={"check_same_thread": False, "timeout": 5},
    )
    Base.metadata.create_all(engine)
    starts = Barrier(2)

    sessions = sessionmaker(bind=engine)

    def provision(index):
        session = sessions()
        try:
            starts.wait(timeout=1)
            return provision_bootstrap_admin(
                session, email=f"admin-{index}@example.test", password="long enough password"
            )
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        users = list(executor.map(provision, range(2)))

    check = sessionmaker(bind=engine)()
    try:
        assert sum(user is not None for user in users) == 1
        assert check.query(AuditEvent).count() == 2
        assert check.query(User).filter_by(role=UserRole.ADMIN).count() == 1
    finally:
        check.close()
