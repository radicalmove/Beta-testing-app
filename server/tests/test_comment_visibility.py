from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import User, UserRole
from app.services.accounts import create_extension_login_code, exchange_extension_login_code
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
    session.add(user)
    session.commit()
    user_id = str(user.id)
    code = create_extension_login_code(session, user, "https://abcdefghijklmnop.chromiumapp.org/")
    token = exchange_extension_login_code(session, code, "https://abcdefghijklmnop.chromiumapp.org/")
    session.close()
    return {"Authorization": f"Bearer {token}"}, user_id


def make_comment(client, headers, course_id, body):
    response = client.post("/api/comments", headers=headers, json={
        "course_id": course_id, "page_url": "https://moodle.example/mod/page/view.php?id=9", "page_title": "Unit 1",
        "body": body, "anchor_type": "text_highlight", "selected_quote": "selected", "css_selector": "#content",
    })
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.parametrize("viewer", ["beta_one", "beta_two", "sme_one", "sme_two", "lead"])
def test_course_thread_visibility_is_role_safe_and_shares_are_per_user(client, viewer):
    beta_one, _ = headers_for(client, "beta-one@example.test", UserRole.BETA_TESTER)
    beta_two, _ = headers_for(client, "beta-two@example.test", UserRole.BETA_TESTER)
    sme_one, sme_one_id = headers_for(client, "sme-one@example.test", UserRole.SME)
    sme_two, _ = headers_for(client, "sme-two@example.test", UserRole.SME)
    lead, _ = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    course_id = str(course.id)
    session.close()

    beta_one_thread = make_comment(client, beta_one, course_id, "Beta one")
    beta_two_thread = make_comment(client, beta_two, course_id, "Beta two")
    sme_thread = make_comment(client, sme_one, course_id, "SME discussion")
    assert client.post(f"/api/comments/{beta_one_thread}/replies", headers=lead, json={"body": "LD answer"}).status_code == 201
    assert client.post(f"/api/comments/{beta_one_thread}/share", headers=lead, json={"user_id": sme_one_id}).status_code == 201
    assert client.post(f"/api/comments/{beta_one_thread}/replies", headers=sme_one, json={"body": "SME-side note"}).status_code == 201

    headers_by_viewer = {"beta_one": beta_one, "beta_two": beta_two, "sme_one": sme_one, "sme_two": sme_two, "lead": lead}
    expected_by_viewer = {
        "beta_one": {beta_one_thread}, "beta_two": {beta_two_thread}, "sme_one": {beta_one_thread, sme_thread},
        "sme_two": {sme_thread}, "lead": {beta_one_thread, beta_two_thread, sme_thread},
    }
    response = client.get("/api/comments", headers=headers_by_viewer[viewer], params={"course_id": course_id})
    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == expected_by_viewer[viewer]

    beta_detail = client.get(f"/api/comments/{beta_one_thread}", headers=beta_one)
    assert beta_detail.status_code == 200
    assert [reply["body"] for reply in beta_detail.json()["replies"]] == ["LD answer"]
    assert client.get(f"/api/comments/{beta_one_thread}", headers=sme_two).status_code == 404
    assert client.post(f"/api/comments/{beta_one_thread}/replies", headers=sme_two, json={"body": "leak"}).status_code == 404
