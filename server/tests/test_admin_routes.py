from datetime import UTC, datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import AuditEvent, User, UserRole
from app.services.accounts import register_account


@pytest.fixture
def client():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    app = create_app()

    def session_override():
        session = factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_session] = session_override
    with TestClient(app, base_url="https://testserver") as test_client:
        test_client.db_factory = factory
        yield test_client


def test_admin_can_approve_and_change_a_role_with_auditing(client):
    session = client.db_factory()
    admin = register_account(session, email="admin@example.test", password="long enough password")
    admin.role, admin.approved_at = UserRole.ADMIN, datetime.now(UTC)
    member = register_account(session, email="member@example.test", password="long enough password")
    session.commit()
    member_id = str(member.id)
    session.close()
    client.post("/auth/login", json={"email": "admin@example.test", "password": "long enough password"})

    approved = client.post(f"/admin/users/{member_id}/approve", json={})
    changed = client.post(f"/admin/users/{member_id}/role", json={"role": "sme"})

    assert approved.status_code == 200
    assert changed.status_code == 200
    check = client.db_factory()
    member = check.get(User, uuid.UUID(member_id))
    assert member.approved_at is not None and member.role is UserRole.SME
    assert {event.action for event in check.query(AuditEvent).all()} == {"user.approved", "user.role_changed"}
    check.close()


def test_admin_browser_mutations_require_csrf(client):
    session = client.db_factory()
    admin = register_account(session, email="admin@example.test", password="long enough password")
    admin.role, admin.approved_at = UserRole.ADMIN, datetime.now(UTC)
    member = register_account(session, email="member@example.test", password="long enough password")
    session.commit()
    member_id = str(member.id)
    session.close()
    client.post("/auth/login", json={"email": "admin@example.test", "password": "long enough password"})

    assert client.post(f"/admin/users/{member_id}/approve", data={}).status_code == 403


@pytest.mark.parametrize("payload", [{}, {"role": None}, {"role": "not-a-role"}])
def test_admin_role_changes_reject_malformed_json_with_validation_response(client, payload):
    session = client.db_factory()
    admin = register_account(session, email="admin@example.test", password="long enough password")
    admin.role, admin.approved_at = UserRole.ADMIN, datetime.now(UTC)
    member = register_account(session, email="member@example.test", password="long enough password")
    session.commit()
    member_id = str(member.id)
    session.close()
    client.post("/auth/login", json={"email": "admin@example.test", "password": "long enough password"})

    response = client.post(f"/admin/users/{member_id}/role", json=payload)

    assert response.status_code == 422
