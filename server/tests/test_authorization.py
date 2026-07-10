from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import AuditEvent, UserRole
from app.services.accounts import AuthorizationError, change_role, register_account


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_only_an_admin_can_change_roles_and_the_change_is_audited(db_session):
    admin = register_account(db_session, email="admin@example.test", password="correct horse battery staple")
    admin.role = UserRole.ADMIN
    admin.approved_at = datetime.now(UTC)
    member = register_account(db_session, email="member@example.test", password="correct horse battery staple")
    db_session.commit()

    with pytest.raises(AuthorizationError):
        change_role(db_session, member, admin, UserRole.SME)

    change_role(db_session, admin, member, UserRole.SME)

    assert member.role is UserRole.SME
    event = db_session.query(AuditEvent).one()
    assert event.action == "user.role_changed"
    assert event.entity_type == "user"
    assert event.entity_id == str(member.id)
