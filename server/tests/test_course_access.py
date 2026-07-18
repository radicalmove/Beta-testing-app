from datetime import timedelta

import pytest

from app.models import Course, MembershipState, User, UserRole
from app.security import utc_now
from app.services.access import AccessDenied, create_invitation, redeem_invitation, renew_device, resume_membership


def user(db_session, email: str, role=UserRole.BETA_TESTER) -> User:
    value = User(email=email, display_name=email.split("@", 1)[0], password_hash="unused", role=role, approved_at=utc_now(), created_at=utc_now())
    db_session.add(value)
    db_session.flush()
    return value


def course(db_session) -> Course:
    value = Course(moodle_course_id="896", normalized_url="https://my.uconline.ac.nz/course/view.php?id=896", moodle_origin="https://my.uconline.ac.nz", title="CRJU150", identity_title="CRJU150", is_confirmed=True, confirmed_at=utc_now(), created_at=utc_now())
    db_session.add(value)
    db_session.flush()
    return value


def test_beta_invitation_redeems_once_and_returns_credentials(db_session):
    admin = user(db_session, "admin@example.test", UserRole.ADMIN)
    target_course = course(db_session)
    invitation, raw_invite = create_invitation(db_session, admin, target_course, "new@example.test", UserRole.BETA_TESTER)

    result = redeem_invitation(db_session, course_id=target_course.id, display_name="New Reviewer", email="new@example.test", role=UserRole.BETA_TESTER, invitation_code=raw_invite)

    assert result.membership.state is MembershipState.APPROVED
    assert result.session_token
    assert result.device_credential
    assert result.reconnect_code
    assert invitation.redeemed_at is not None
    with pytest.raises(AccessDenied):
        redeem_invitation(db_session, course_id=target_course.id, display_name="Again", email="new@example.test", role=UserRole.BETA_TESTER, invitation_code=raw_invite)


def test_invitation_is_bound_to_email_course_and_role(db_session):
    admin = user(db_session, "admin2@example.test", UserRole.ADMIN)
    target_course = course(db_session)
    _, raw_invite = create_invitation(db_session, admin, target_course, "right@example.test", UserRole.SME)

    with pytest.raises(AccessDenied):
        redeem_invitation(db_session, course_id=target_course.id, display_name="Wrong", email="wrong@example.test", role=UserRole.SME, invitation_code=raw_invite)
    with pytest.raises(AccessDenied):
        redeem_invitation(db_session, course_id=target_course.id, display_name="Wrong", email="right@example.test", role=UserRole.BETA_TESTER, invitation_code=raw_invite)


def test_sme_redeems_pending_and_cannot_resume_until_approved(db_session):
    admin = user(db_session, "admin3@example.test", UserRole.ADMIN)
    target_course = course(db_session)
    _, raw_invite = create_invitation(db_session, admin, target_course, "sme@example.test", UserRole.SME)
    result = redeem_invitation(db_session, course_id=target_course.id, display_name="SME", email="sme@example.test", role=UserRole.SME, invitation_code=raw_invite)

    assert result.membership.state is MembershipState.PENDING
    assert result.session_token is None
    with pytest.raises(AccessDenied):
        resume_membership(db_session, course_id=target_course.id, email="sme@example.test", reconnect_code=result.reconnect_code)


def test_device_credential_rotates_and_old_value_cannot_be_reused(db_session):
    admin = user(db_session, "admin4@example.test", UserRole.ADMIN)
    target_course = course(db_session)
    _, raw_invite = create_invitation(db_session, admin, target_course, "device@example.test", UserRole.BETA_TESTER)
    joined = redeem_invitation(db_session, course_id=target_course.id, display_name="Device", email="device@example.test", role=UserRole.BETA_TESTER, invitation_code=raw_invite)

    renewed = renew_device(db_session, course_id=target_course.id, device_credential=joined.device_credential)

    assert renewed.session_token
    assert renewed.device_credential != joined.device_credential
    with pytest.raises(AccessDenied):
        renew_device(db_session, course_id=target_course.id, device_credential=joined.device_credential)
