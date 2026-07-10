from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession

from app.models import AuditEvent, ExtensionLoginCode, Session, User, UserRole
from app.security import generate_token, hash_password, token_hash, utc_now


class AuthenticationError(Exception):
    pass


class AccountNotApprovedError(AuthenticationError):
    pass


class AuthorizationError(Exception):
    pass


def register_account(db: DbSession, *, email: str, password: str) -> User:
    user = User(email=email.strip().lower(), password_hash=hash_password(password), created_at=utc_now())
    db.add(user)
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
