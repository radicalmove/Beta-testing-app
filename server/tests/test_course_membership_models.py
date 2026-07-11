from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    Course,
    CourseMembership,
    DeviceCredential,
    MembershipState,
    ReconnectCredential,
    ReviewerInvitation,
    Session,
    User,
    UserRole,
)
from app.security import utc_now


def make_user(db_session, email: str) -> User:
    user = User(
        email=email,
        display_name=email.split("@", 1)[0],
        password_hash="not-used-by-extension",
        role=UserRole.BETA_TESTER,
        approved_at=utc_now(),
        created_at=utc_now(),
    )
    db_session.add(user)
    db_session.flush()
    return user


def make_course(db_session, moodle_id: str) -> Course:
    course = Course(
        moodle_course_id=moodle_id,
        normalized_url=f"https://my.uconline.ac.nz/course/view.php?id={moodle_id}",
        moodle_origin="https://my.uconline.ac.nz",
        title=f"Course {moodle_id}",
        identity_title=f"Course {moodle_id}",
        is_confirmed=True,
        created_at=utc_now(),
        confirmed_at=utc_now(),
    )
    db_session.add(course)
    db_session.flush()
    return course


def test_membership_is_unique_per_user_and_course(db_session):
    user = make_user(db_session, "reviewer@example.test")
    course = make_course(db_session, "896")
    db_session.add(
        CourseMembership(
            user_id=user.id,
            course_id=course.id,
            role=UserRole.SME,
            state=MembershipState.PENDING,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
    )
    db_session.commit()

    db_session.add(
        CourseMembership(
            user_id=user.id,
            course_id=course.id,
            role=UserRole.BETA_TESTER,
            state=MembershipState.APPROVED,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_invitation_records_course_email_role_and_single_redemption(db_session):
    creator = make_user(db_session, "admin@example.test")
    course = make_course(db_session, "897")
    invitation = ReviewerInvitation(
        course_id=course.id,
        created_by_user_id=creator.id,
        email_hash="a" * 64,
        code_hash="$argon2id$example",
        allowed_role=UserRole.BETA_TESTER,
        expires_at=utc_now() + timedelta(days=30),
        created_at=utc_now(),
    )
    db_session.add(invitation)
    db_session.commit()

    assert invitation.course_id == course.id
    assert invitation.allowed_role is UserRole.BETA_TESTER
    assert invitation.redeemed_at is None
    assert invitation.revoked_at is None


def test_confirmed_course_has_exact_moodle_origin(db_session):
    course = make_course(db_session, "898")
    db_session.commit()

    assert course.moodle_origin == "https://my.uconline.ac.nz"


def test_extension_session_and_device_are_bound_to_membership(db_session):
    user = make_user(db_session, "bound@example.test")
    course = make_course(db_session, "899")
    membership = CourseMembership(
        user_id=user.id,
        course_id=course.id,
        role=UserRole.BETA_TESTER,
        state=MembershipState.APPROVED,
        approved_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    db_session.add(membership)
    db_session.flush()
    session = Session(
        user_id=user.id,
        membership_id=membership.id,
        token_hash="b" * 64,
        kind="extension",
        expires_at=utc_now() + timedelta(hours=8),
        created_at=utc_now(),
    )
    device = DeviceCredential(
        membership_id=membership.id,
        family_id="family-1",
        credential_hash="c" * 64,
        expires_at=utc_now() + timedelta(days=90),
        created_at=utc_now(),
    )
    reconnect = ReconnectCredential(
        membership_id=membership.id,
        code_hash="$argon2id$reconnect",
        created_at=utc_now(),
    )
    db_session.add_all([session, device, reconnect])
    db_session.commit()

    assert session.membership_id == membership.id
    assert device.membership_id == membership.id
    assert reconnect.membership_id == membership.id
