import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.models import Course, CourseMembership, DeviceCredential, MembershipState, ReconnectCredential, ReviewerInvitation, Session, User, UserRole
from app.security import generate_token, hash_password, token_hash, utc_now, verify_password


class AccessDenied(Exception):
    pass


@dataclass(frozen=True)
class AccessResult:
    membership: CourseMembership
    session_token: str | None
    device_credential: str | None
    reconnect_code: str


def _email(value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or len(normalized) > 320:
        raise AccessDenied("Unable to verify reviewer access")
    return normalized


def _email_hash(value: str) -> str:
    return hashlib.sha256(_email(value).encode()).hexdigest()


def _code() -> str:
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    raw = "".join(secrets.choice(alphabet) for _ in range(20))
    return "-".join(raw[index:index + 5] for index in range(0, 20, 5))


def _normalize_code(value: str) -> str:
    return "".join(character for character in value.upper() if character not in " -")


def create_invitation(db: DbSession, actor: User, course: Course, email: str, role: UserRole, *, ttl=timedelta(days=30)) -> tuple[ReviewerInvitation, str]:
    if actor.role not in {UserRole.LD_DCD, UserRole.ADMIN} or actor.approved_at is None:
        raise AccessDenied("Invitation access denied")
    if role is UserRole.ADMIN or (role is UserRole.LD_DCD and actor.role is not UserRole.ADMIN):
        raise AccessDenied("Invitation role denied")
    if not course.is_confirmed or not course.moodle_origin or not course.moodle_course_id:
        raise AccessDenied("Course is not enabled for review")
    raw = _code()
    invitation = ReviewerInvitation(course_id=course.id, created_by_user_id=actor.id, email_hash=_email_hash(email), code_hash=hash_password(_normalize_code(raw)), allowed_role=role, expires_at=utc_now() + ttl, created_at=utc_now())
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return invitation, raw


def _issue_access(db: DbSession, membership: CourseMembership) -> tuple[str, str]:
    session_token = generate_token()
    device = generate_token()
    now = utc_now()
    db.add(Session(user_id=membership.user_id, membership_id=membership.id, token_hash=token_hash(session_token), kind="extension", expires_at=now + timedelta(hours=8), created_at=now))
    db.add(DeviceCredential(membership_id=membership.id, family_id=secrets.token_hex(16), credential_hash=token_hash(device), expires_at=now + timedelta(days=90), created_at=now))
    return session_token, device


def redeem_invitation(db: DbSession, *, course_id: uuid.UUID, display_name: str, email: str, role: UserRole, invitation_code: str) -> AccessResult:
    now = utc_now()
    normalized_email = _email(email)
    invitations = db.scalars(select(ReviewerInvitation).where(ReviewerInvitation.course_id == course_id, ReviewerInvitation.email_hash == _email_hash(normalized_email), ReviewerInvitation.allowed_role == role, ReviewerInvitation.redeemed_at.is_(None), ReviewerInvitation.revoked_at.is_(None), ReviewerInvitation.expires_at > now)).all()
    invitation = next((candidate for candidate in invitations if verify_password(candidate.code_hash, _normalize_code(invitation_code))), None)
    if invitation is None:
        raise AccessDenied("Unable to verify reviewer access")
    user = db.scalar(select(User).where(User.email == normalized_email))
    if user is None:
        name = display_name.strip()
        if not name or len(name) > 100:
            raise AccessDenied("Unable to verify reviewer access")
        user = User(email=normalized_email, display_name=name, password_hash=hash_password(generate_token()), role=UserRole.BETA_TESTER, approved_at=now, created_at=now)
        db.add(user)
        db.flush()
    if db.scalar(select(CourseMembership).where(CourseMembership.user_id == user.id, CourseMembership.course_id == course_id)) is not None:
        raise AccessDenied("Unable to verify reviewer access")
    state = MembershipState.APPROVED if role is UserRole.BETA_TESTER else MembershipState.PENDING
    membership = CourseMembership(user_id=user.id, course_id=course_id, role=role, state=state, approved_at=now if state is MembershipState.APPROVED else None, created_at=now, updated_at=now)
    db.add(membership)
    db.flush()
    reconnect = _code()
    db.add(ReconnectCredential(membership_id=membership.id, code_hash=hash_password(_normalize_code(reconnect)), created_at=now))
    invitation.redeemed_by_user_id = user.id
    invitation.redeemed_at = now
    session_token, device = (None, None) if state is MembershipState.PENDING else _issue_access(db, membership)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AccessDenied("Unable to verify reviewer access") from exc
    db.refresh(membership)
    return AccessResult(membership, session_token, device, reconnect)


def resume_membership(db: DbSession, *, course_id: uuid.UUID, email: str, reconnect_code: str) -> AccessResult:
    user = db.scalar(select(User).where(User.email == _email(email)))
    membership = None if user is None else db.scalar(select(CourseMembership).where(CourseMembership.user_id == user.id, CourseMembership.course_id == course_id))
    credential = None if membership is None else db.scalar(select(ReconnectCredential).where(ReconnectCredential.membership_id == membership.id, ReconnectCredential.revoked_at.is_(None)))
    if membership is None or membership.state is not MembershipState.APPROVED or credential is None or not verify_password(credential.code_hash, _normalize_code(reconnect_code)):
        raise AccessDenied("Unable to verify reviewer access")
    session_token, device = _issue_access(db, membership)
    db.commit()
    return AccessResult(membership, session_token, device, reconnect_code="")


def renew_device(db: DbSession, *, course_id: uuid.UUID, device_credential: str) -> AccessResult:
    now = utc_now()
    current = db.scalar(select(DeviceCredential).where(DeviceCredential.credential_hash == token_hash(device_credential), DeviceCredential.rotated_at.is_(None), DeviceCredential.revoked_at.is_(None), DeviceCredential.expires_at > now))
    membership = None if current is None else db.get(CourseMembership, current.membership_id)
    if current is None or membership is None or membership.course_id != course_id or membership.state is not MembershipState.APPROVED:
        raise AccessDenied("Unable to verify reviewer access")
    current.rotated_at = now
    session_token = generate_token()
    replacement = generate_token()
    db.add(Session(user_id=membership.user_id, membership_id=membership.id, token_hash=token_hash(session_token), kind="extension", expires_at=now + timedelta(hours=8), created_at=now))
    db.add(DeviceCredential(membership_id=membership.id, family_id=current.family_id, credential_hash=token_hash(replacement), expires_at=now + timedelta(days=90), created_at=now))
    db.commit()
    return AccessResult(membership, session_token, replacement, reconnect_code="")
