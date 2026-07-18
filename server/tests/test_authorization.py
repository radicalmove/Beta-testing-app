from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import AuditEvent, Course, CourseMembership, MembershipState, Session, UserRole
from app.security import token_hash, utc_now
from app.services.accounts import AuthenticationError, AuthorizationError, change_role, register_account, verify_extension_access


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


def test_bound_extension_session_uses_approved_course_membership_role(db_session):
    user = register_account(db_session, email="reviewer@example.test", password="correct horse battery staple")
    user.approved_at = utc_now()
    course = Course(moodle_course_id="896", normalized_url="https://my.uconline.ac.nz/course/view.php?id=896", moodle_origin="https://my.uconline.ac.nz", title="CRJU150", identity_title="CRJU150", is_confirmed=True, created_at=utc_now(), confirmed_at=utc_now())
    db_session.add(course)
    db_session.flush()
    membership = CourseMembership(user_id=user.id, course_id=course.id, role=UserRole.LD_DCD, state=MembershipState.APPROVED, approved_at=utc_now(), created_at=utc_now(), updated_at=utc_now())
    db_session.add(membership)
    db_session.flush()
    db_session.add(Session(user_id=user.id, membership_id=membership.id, token_hash=token_hash("bound-token"), kind="extension", expires_at=utc_now() + timedelta(hours=1), created_at=utc_now()))
    db_session.commit()

    access = verify_extension_access(db_session, "bound-token")

    assert access.id == user.id
    assert access.role is UserRole.LD_DCD
    assert access.course_id == course.id


def test_bound_extension_session_rejects_non_approved_membership(db_session):
    user = register_account(db_session, email="pending@example.test", password="correct horse battery staple")
    user.approved_at = utc_now()
    course = Course(moodle_course_id="897", normalized_url="https://my.uconline.ac.nz/course/view.php?id=897", moodle_origin="https://my.uconline.ac.nz", title="Pending", identity_title="Pending", is_confirmed=True, created_at=utc_now(), confirmed_at=utc_now())
    db_session.add(course)
    db_session.flush()
    membership = CourseMembership(user_id=user.id, course_id=course.id, role=UserRole.SME, state=MembershipState.PENDING, created_at=utc_now(), updated_at=utc_now())
    db_session.add(membership)
    db_session.flush()
    db_session.add(Session(user_id=user.id, membership_id=membership.id, token_hash=token_hash("pending-token"), kind="extension", expires_at=utc_now() + timedelta(hours=1), created_at=utc_now()))
    db_session.commit()

    with pytest.raises(AuthenticationError):
        verify_extension_access(db_session, "pending-token")
