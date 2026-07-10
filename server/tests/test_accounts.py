from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, BrokenBarrierError

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as SqlAlchemySession, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Session
from app.security import verify_password
from app.services.accounts import (
    AccountNotApprovedError,
    AuthenticationError,
    create_dashboard_session,
    create_extension_login_code,
    exchange_extension_login_code,
    register_account,
    revoke_session,
    verify_dashboard_session,
    verify_extension_session,
)


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


def approved_user(db_session):
    user = register_account(db_session, email="tester@example.test", password="correct horse battery staple")
    user.approved_at = datetime.now(UTC)
    db_session.commit()
    return user


def test_registration_is_pending_and_password_is_argon2_hashed(db_session):
    user = register_account(db_session, email="Tester@Example.Test", password="correct horse battery staple")

    assert user.approved_at is None
    assert user.password_hash.startswith("$argon2")
    assert user.password_hash != "correct horse battery staple"
    assert verify_password(user.password_hash, "correct horse battery staple")


def test_dashboard_session_rejects_an_unapproved_account(db_session):
    user = register_account(db_session, email="pending@example.test", password="correct horse battery staple")

    with pytest.raises(AccountNotApprovedError):
        create_dashboard_session(db_session, user)


def test_dashboard_session_expires_and_can_be_revoked(db_session):
    user = approved_user(db_session)
    now = datetime(2026, 7, 10, tzinfo=UTC)
    token = create_dashboard_session(db_session, user, now=now, ttl=timedelta(minutes=5))

    assert db_session.query(Session).one().token_hash != token
    assert verify_dashboard_session(db_session, token, now=now + timedelta(minutes=4)).id == user.id
    with pytest.raises(AuthenticationError):
        verify_dashboard_session(db_session, token, now=now + timedelta(minutes=6))

    token = create_dashboard_session(db_session, user, now=now)
    revoke_session(db_session, token, now=now)
    with pytest.raises(AuthenticationError):
        verify_dashboard_session(db_session, token, now=now)


def test_extension_login_code_is_redirect_bound_single_use_expiring_and_revocable(db_session):
    user = approved_user(db_session)
    now = datetime(2026, 7, 10, tzinfo=UTC)
    redirect_uri = "https://abcdefghijklmnop.chromiumapp.org/"
    code = create_extension_login_code(db_session, user, redirect_uri, now=now, ttl=timedelta(minutes=2))

    with pytest.raises(AuthenticationError):
        exchange_extension_login_code(db_session, code, "https://wrong.chromiumapp.org/", now=now)
    token = exchange_extension_login_code(
        db_session, code, redirect_uri, now=now, session_ttl=timedelta(seconds=1)
    )
    with pytest.raises(AuthenticationError):
        exchange_extension_login_code(db_session, code, redirect_uri, now=now)
    assert verify_extension_session(db_session, token, now=now).id == user.id
    with pytest.raises(AuthenticationError):
        verify_extension_session(db_session, token, now=now + timedelta(seconds=2))

    expired = create_extension_login_code(db_session, user, redirect_uri, now=now, ttl=timedelta(seconds=1))
    with pytest.raises(AuthenticationError):
        exchange_extension_login_code(db_session, expired, redirect_uri, now=now + timedelta(seconds=2))

    revoked = create_extension_login_code(db_session, user, redirect_uri, now=now)
    revoke_session(db_session, revoked, now=now)
    with pytest.raises(AuthenticationError):
        exchange_extension_login_code(db_session, revoked, redirect_uri, now=now)

    replacement_code = create_extension_login_code(db_session, user, redirect_uri, now=now)
    replacement_token = exchange_extension_login_code(db_session, replacement_code, redirect_uri, now=now)
    revoke_session(db_session, replacement_token, now=now)
    with pytest.raises(AuthenticationError):
        verify_extension_session(db_session, replacement_token, now=now)


def test_concurrent_extension_code_exchanges_mint_exactly_one_api_session(tmp_path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'accounts.db'}"
    engine = create_engine(database_url, connect_args={"check_same_thread": False, "timeout": 5})
    Base.metadata.create_all(engine)
    initial_session = sessionmaker(bind=engine)()
    user = approved_user(initial_session)
    now = datetime(2026, 7, 10, tzinfo=UTC)
    code = create_extension_login_code(
        initial_session, user, "https://abcdefghijklmnop.chromiumapp.org/", now=now
    )
    initial_session.close()

    read_barrier = Barrier(2)

    class InterleavingSession(SqlAlchemySession):
        def get(self, entity, ident, **kwargs):
            if entity.__name__ == "User":
                try:
                    read_barrier.wait(timeout=0.2)
                except BrokenBarrierError:
                    pass
            return super().get(entity, ident, **kwargs)

    concurrent_sessions = sessionmaker(bind=engine, class_=InterleavingSession)

    def exchange():
        session = concurrent_sessions()
        try:
            return exchange_extension_login_code(
                session, code, "https://abcdefghijklmnop.chromiumapp.org/", now=now
            )
        except AuthenticationError:
            return None
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        tokens = list(executor.map(lambda _: exchange(), range(2)))

    assert sum(token is not None for token in tokens) == 1
    check = sessionmaker(bind=engine)()
    try:
        assert check.query(Session).filter_by(kind="extension").count() == 1
    finally:
        check.close()
