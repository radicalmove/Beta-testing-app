from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Comment, User, UserRole
from app.services.accounts import create_extension_login_code, exchange_extension_login_code
from app.services.comments import share_comment_with_user
from app.services.courses import resolve_course


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


def headers_for(client, email, role):
    session = client.db_factory()
    user = User(email=email, password_hash="hash", role=role, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    session.add(user); session.commit()
    code = create_extension_login_code(session, user, "https://abcdefghijklmnop.chromiumapp.org/")
    token = exchange_extension_login_code(session, code, "https://abcdefghijklmnop.chromiumapp.org/")
    session.close()
    return {"Authorization": f"Bearer {token}"}


def test_replies_status_history_and_unauthorized_transitions(client):
    beta = headers_for(client, "beta@example.test", UserRole.BETA_TESTER)
    lead = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    sme = headers_for(client, "sme@example.test", UserRole.SME)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    session.close()
    created = client.post("/api/comments", headers=beta, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/9", "page_title": "Unit 1", "body": "Fix",
        "anchor_type": "text_highlight", "selected_quote": "Fix", "css_selector": "#content",
    })
    comment_id = created.json()["id"]

    assert client.post(f"/api/comments/{comment_id}/replies", headers=beta, json={"body": "more detail"}).status_code == 201
    assert client.post(f"/api/comments/{comment_id}/status", headers=sme, json={"status": "in_progress"}).status_code == 404
    for status in ["in_progress", "awaiting_sme", "resolved"]:
        assert client.post(f"/api/comments/{comment_id}/status", headers=lead, json={"status": status}).status_code == 200
    assert client.post(f"/api/comments/{comment_id}/status", headers=lead, json={"status": "deferred"}).status_code == 422

    detail = client.get(f"/api/comments/{comment_id}", headers=lead)
    assert detail.status_code == 200
    assert detail.json()["status"] == "resolved"
    assert [event["status"] for event in detail.json()["status_history"]] == ["open", "in_progress", "awaiting_sme", "resolved"]
    assert [reply["body"] for reply in detail.json()["replies"]] == ["more detail"]


def test_only_ld_dcd_can_change_a_beta_thread_status(client):
    beta = headers_for(client, "beta@example.test", UserRole.BETA_TESTER)
    lead = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    admin = headers_for(client, "admin@example.test", UserRole.ADMIN)
    sme = headers_for(client, "sme@example.test", UserRole.SME)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    session.close()
    created = client.post("/api/comments", headers=beta, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/9", "page_title": "Unit 1", "body": "Fix",
        "anchor_type": "text_highlight", "selected_quote": "Fix", "css_selector": "#content",
    })
    comment_id = created.json()["id"]
    session = client.db_factory()
    lead_user = session.query(User).filter_by(email="lead@example.test").one()
    sme_user = session.query(User).filter_by(email="sme@example.test").one()
    share_comment_with_user(session, lead_user, session.get(Comment, UUID(comment_id)), sme_user)
    session.close()

    for headers in (beta, admin, sme):
        assert client.post(f"/api/comments/{comment_id}/status", headers=headers, json={"status": "in_progress"}).status_code == 403
    assert client.post(f"/api/comments/{comment_id}/status", headers=lead, json={"status": "in_progress"}).status_code == 200


def test_only_ld_dcd_can_share_a_beta_thread_with_an_sme(client):
    beta = headers_for(client, "beta@example.test", UserRole.BETA_TESTER)
    lead = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    admin = headers_for(client, "admin@example.test", UserRole.ADMIN)
    sme = headers_for(client, "sme@example.test", UserRole.SME)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    sme_user = session.query(User).filter_by(email="sme@example.test").one()
    session.close()
    created = client.post("/api/comments", headers=beta, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/9", "page_title": "Unit 1", "body": "Fix",
        "anchor_type": "text_highlight", "selected_quote": "Fix", "css_selector": "#content",
    })
    comment_id = created.json()["id"]

    assert client.post(f"/api/comments/{comment_id}/share", headers=admin, json={"user_id": str(sme_user.id)}).status_code == 403
    assert client.post(f"/api/comments/{comment_id}/share", headers=lead, json={"user_id": str(sme_user.id)}).status_code == 201
