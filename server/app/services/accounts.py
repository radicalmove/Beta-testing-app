import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from app.models import AuditEvent, CourseMembership, ExtensionLoginCode, MembershipState, Session, User, UserRole
from app.security import generate_token, hash_password, token_hash, utc_now, verify_password


class AuthenticationError(Exception):
    pass


class AccountNotApprovedError(AuthenticationError):
    pass


class AuthorizationError(Exception):
    pass


class AccountAlreadyExistsError(Exception):
    pass


@dataclass(frozen=True)
class ExtensionAccess:
    id: uuid.UUID
    email: str
    display_name: str
    role: UserRole
    course_id: uuid.UUID | None
    membership_id: uuid.UUID | None


def register_account(db: DbSession, *, email: str, password: str, display_name: str | None = None) -> User:
    name = (email.split("@", 1)[0] or "User") if display_name is None else display_name
    name = name.strip()
    if not name or len(name) > 100:
        raise ValueError("Display name must contain 1 to 100 characters")
    user = User(email=email.strip().lower(), display_name=name, password_hash=hash_password(password), created_at=utc_now())
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AccountAlreadyExistsError("An account with that email already exists") from exc
    db.refresh(user)
    return user


def authenticate_account(db: DbSession, *, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None or not verify_password(user.password_hash, password):
        raise AuthenticationError("Invalid email or password")
    _approved(user)
    return user


def approve_account(db: DbSession, actor: User, user: User) -> User:
    if actor.role is not UserRole.ADMIN or actor.approved_at is None:
        raise AuthorizationError("Only approved administrators can approve accounts")
    if user.approved_at is None:
        user.approved_at = utc_now()
        db.add(AuditEvent(actor_user_id=actor.id, action="user.approved", entity_type="user", entity_id=str(user.id), details=None, created_at=utc_now()))
        db.commit()
        db.refresh(user)
    return user


def provision_bootstrap_admin(db: DbSession, *, email: str, password: str, display_name: str = "Administrator") -> User | None:
    """Provision exactly one admin from deployment secrets, never from a web request."""
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": 661315270689})
    elif db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    if db.scalar(select(User).where(User.role == UserRole.ADMIN)) is not None:
        db.commit()
        return None
    display_name = display_name.strip()
    if not display_name or len(display_name) > 100:
        raise ValueError("Display name must contain 1 to 100 characters")
    instant = utc_now()
    user = User(email=email.strip().lower(), display_name=display_name, password_hash=hash_password(password), role=UserRole.ADMIN, approved_at=instant, created_at=instant)
    db.add(user)
    db.flush()
    db.add_all([
        AuditEvent(actor_user_id=None, action="user.approved", entity_type="user", entity_id=str(user.id), details="bootstrap", created_at=instant),
        AuditEvent(actor_user_id=None, action="user.role_changed", entity_type="user", entity_id=str(user.id), details=f"{UserRole.BETA_TESTER.value}->{UserRole.ADMIN.value}:bootstrap", created_at=instant),
    ])
    db.commit()
    db.refresh(user)
    return user


def _now(value):
    return value or utc_now()


def _is_expired(expires_at: datetime, instant: datetime) -> bool:
    """Compare timestamps safely on SQLite, which does not retain tz offsets."""
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=UTC)
    return expires_at <= instant


def _approved(user: User) -> None:
    if user.approved_at is None:
        raise AccountNotApprovedError("Account approval is required")


def _create_session(db: DbSession, user: User, kind: str, now=None, ttl=timedelta(hours=8)) -> str:
    _approved(user)
    issued_at = _now(now)
    token = generate_token()
    db.add(Session(user_id=user.id, token_hash=token_hash(token), kind=kind, expires_at=issued_at + ttl, created_at=issued_at))
    db.commit()
    return token


def create_dashboard_session(db: DbSession, user: User, *, now=None, ttl=timedelta(hours=8)) -> str:
    return _create_session(db, user, "dashboard", now, ttl)


def _verify_session(db: DbSession, token: str, kind: str, now=None) -> User:
    row = db.scalar(select(Session).where(Session.token_hash == token_hash(token), Session.kind == kind))
    instant = _now(now)
    if row is None or row.revoked_at is not None or _is_expired(row.expires_at, instant):
        raise AuthenticationError("Invalid or expired session")
    user = db.get(User, row.user_id)
    if user is None:
        raise AuthenticationError("Unknown session user")
    _approved(user)
    return user


def verify_dashboard_session(db: DbSession, token: str, *, now=None) -> User:
    return _verify_session(db, token, "dashboard", now)


def verify_extension_session(db: DbSession, token: str, *, now=None) -> User:
    return _verify_session(db, token, "extension", now)


def verify_extension_access(db: DbSession, token: str, *, now=None) -> ExtensionAccess:
    row = db.scalar(select(Session).where(Session.token_hash == token_hash(token), Session.kind == "extension"))
    instant = _now(now)
    if row is None or row.revoked_at is not None or _is_expired(row.expires_at, instant):
        raise AuthenticationError("Invalid or expired session")
    user = db.get(User, row.user_id)
    if user is None:
        raise AuthenticationError("Unknown session user")
    _approved(user)
    if row.membership_id is None:
        return ExtensionAccess(user.id, user.email, user.display_name, user.role, None, None)
    membership = db.get(CourseMembership, row.membership_id)
    if membership is None or membership.user_id != user.id or membership.state is not MembershipState.APPROVED:
        raise AuthenticationError("Course membership approval is required")
    return ExtensionAccess(user.id, user.email, user.display_name, membership.role, membership.course_id, membership.id)


def revoke_session(db: DbSession, token: str, *, now=None) -> None:
    hashed = token_hash(token)
    row = db.scalar(select(Session).where(Session.token_hash == hashed))
    if row is not None:
        row.revoked_at = _now(now)
        db.commit()
        return
    code = db.scalar(select(ExtensionLoginCode).where(ExtensionLoginCode.code_hash == hashed))
    if code is not None:
        code.revoked_at = _now(now)
        db.commit()


def create_extension_login_code(db: DbSession, user: User, redirect_uri: str, *, now=None, ttl=timedelta(minutes=5)) -> str:
    _approved(user)
    issued_at = _now(now)
    code = generate_token()
    db.add(ExtensionLoginCode(user_id=user.id, code_hash=token_hash(code), redirect_uri=redirect_uri, expires_at=issued_at + ttl, created_at=issued_at))
    db.commit()
    return code


def exchange_extension_login_code(db: DbSession, code: str, redirect_uri: str, *, now=None, session_ttl=timedelta(hours=8)) -> str:
    instant = _now(now)
    code_hash = token_hash(code)
    claim = db.execute(
        update(ExtensionLoginCode)
        .where(
            ExtensionLoginCode.code_hash == code_hash,
            ExtensionLoginCode.redirect_uri == redirect_uri,
            ExtensionLoginCode.used_at.is_(None),
            ExtensionLoginCode.revoked_at.is_(None),
            ExtensionLoginCode.expires_at > instant,
        )
        .values(used_at=instant)
    )
    if claim.rowcount != 1:
        raise AuthenticationError("Invalid, expired, used, or mismatched extension code")
    user_id = db.scalar(select(ExtensionLoginCode.user_id).where(ExtensionLoginCode.code_hash == code_hash))
    user = db.get(User, user_id)
    if user is None:
        raise AuthenticationError("Unknown code user")
    _approved(user)
    token = generate_token()
    db.add(Session(user_id=user.id, token_hash=token_hash(token), kind="extension", expires_at=instant + session_ttl, created_at=instant))
    db.commit()
    return token


def change_role(db: DbSession, actor: User, user: User, role: UserRole) -> User:
    if actor.role is not UserRole.ADMIN or actor.approved_at is None:
        raise AuthorizationError("Only approved administrators can change roles")
    old_role = user.role
    user.role = role
    db.add(AuditEvent(actor_user_id=actor.id, action="user.role_changed", entity_type="user", entity_id=str(user.id), details=f"{old_role.value}->{role.value}", created_at=utc_now()))
    db.commit()
    db.refresh(user)
    return user
