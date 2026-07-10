import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import CommentReply, User, UserRole
from app.services.accounts import change_role
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
    assert client.post(f"/api/comments/{beta_one_thread}/replies", headers=sme_one, json={"body": "SME-side note"}).status_code == 403

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


def test_promoted_beta_author_does_not_expose_historical_beta_thread_to_other_smes(client):
    beta, beta_id = headers_for(client, "beta@example.test", UserRole.BETA_TESTER)
    other_sme, _ = headers_for(client, "other-sme@example.test", UserRole.SME)
    admin, _ = headers_for(client, "admin@example.test", UserRole.ADMIN)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    course_id = str(course.id)
    beta_thread = make_comment(client, beta, course_id, "Historical beta feedback")
    beta_user = session.get(User, uuid.UUID(beta_id))
    admin_user = session.query(User).filter_by(email="admin@example.test").one()
    change_role(session, admin_user, beta_user, UserRole.SME)
    session.close()

    assert {item["id"] for item in client.get("/api/comments", headers=other_sme, params={"course_id": course_id}).json()} == set()
    assert {item["id"] for item in client.get("/api/comments", headers=beta, params={"course_id": course_id}).json()} == {beta_thread}


def test_sme_threads_with_multiple_shares_are_not_duplicated(client):
    sme_one, _ = headers_for(client, "sme-one@example.test", UserRole.SME)
    sme_two, sme_two_id = headers_for(client, "sme-two@example.test", UserRole.SME)
    sme_three, sme_three_id = headers_for(client, "sme-three@example.test", UserRole.SME)
    lead, _ = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    course_id = str(course.id)
    session.close()
    thread = make_comment(client, sme_one, course_id, "SME discussion")
    assert client.post(f"/api/comments/{thread}/share", headers=lead, json={"user_id": sme_two_id}).status_code == 201
    assert client.post(f"/api/comments/{thread}/share", headers=lead, json={"user_id": sme_three_id}).status_code == 201

    response = client.get("/api/comments", headers=sme_two, params={"course_id": course_id})
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [thread]


def test_beta_thread_replies_are_limited_to_author_and_ld_dcd(client):
    beta, _ = headers_for(client, "beta@example.test", UserRole.BETA_TESTER)
    lead, _ = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    admin, _ = headers_for(client, "admin@example.test", UserRole.ADMIN)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    course_id = str(course.id)
    session.close()
    thread = make_comment(client, beta, course_id, "Beta feedback")

    assert client.post(f"/api/comments/{thread}/replies", headers=admin, json={"body": "Admin answer"}).status_code == 403
    assert client.post(f"/api/comments/{thread}/replies", headers=lead, json={"body": "LD answer"}).status_code == 201
    assert client.post(f"/api/comments/{thread}/replies", headers=beta, json={"body": "Thanks"}).status_code == 201
    detail = client.get(f"/api/comments/{thread}", headers=beta)
    assert [reply["body"] for reply in detail.json()["replies"]] == ["LD answer", "Thanks"]


def test_page_comment_list_returns_anchors_and_role_filtered_conversation(client):
    beta, _ = headers_for(client, "page-beta@example.test", UserRole.BETA_TESTER)
    selected_sme, selected_sme_id = headers_for(client, "page-selected@example.test", UserRole.SME)
    other_sme, _ = headers_for(client, "page-other@example.test", UserRole.SME)
    lead, lead_id = headers_for(client, "page-lead@example.test", UserRole.LD_DCD)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=896, course_url="https://my.uconline.ac.nz/course/view.php?id=896", title="UCO")
    course_id = str(course.id)
    session.close()
    page_url = "https://my.uconline.ac.nz/mod/page/view.php?id=42#topic"
    created = client.post("/api/comments", headers=beta, json={
        "course_id": course_id, "page_url": page_url, "page_title": "Topic",
        "body": "Check this", "category": "general", "anchor_type": "visual_pin",
        "css_selector": "#region-main", "relative_x": 0.25, "relative_y": 0.75,
    })
    assert created.status_code == 201
    comment_id = created.json()["id"]
    make_comment(client, beta, course_id, "Other page")
    assert client.post(f"/api/comments/{comment_id}/replies", headers=lead, json={"body": "Visible LD reply"}).status_code == 201
    assert client.post(f"/api/comments/{comment_id}/share", headers=lead, json={"user_id": selected_sme_id}).status_code == 201

    # Historical/imported SME-side notes can exist, but are not in the beta audience.
    session = client.db_factory()
    hidden_sme = session.query(User).filter_by(email="page-selected@example.test").one()
    session.add(CommentReply(comment_id=uuid.UUID(comment_id), author_user_id=hidden_sme.id, body="Hidden SME reply", created_at=datetime.now(UTC)))
    session.commit()
    session.close()

    response = client.get("/api/comments", headers=beta, params={"course_id": course_id, "page_url": page_url})
    assert response.status_code == 200
    assert len(response.json()) == 1
    item = response.json()[0]
    assert item | {} == item
    assert item["page_url"] == page_url
    assert item["page_title"] == "Topic"
    assert item["anchor_type"] == "visual_pin"
    assert item["css_selector"] == "#region-main"
    assert item["relative_x"] == 0.25 and item["relative_y"] == 0.75
    assert item["author_role"] == "beta_tester"
    assert [(reply["body"], reply["author_role"]) for reply in item["replies"]] == [("Visible LD reply", "ld_dcd")]
    assert item["status_history"][0]["status"] == "open"

    selected = client.get("/api/comments", headers=selected_sme, params={"course_id": course_id, "page_url": page_url})
    assert {row["id"] for row in selected.json()} == {comment_id}
    assert client.get("/api/comments", headers=other_sme, params={"course_id": course_id, "page_url": page_url}).json() == []
    lead_page = client.get("/api/comments", headers=lead, params={"course_id": course_id, "page_url": page_url})
    assert {reply["body"] for reply in lead_page.json()[0]["replies"]} == {"Visible LD reply", "Hidden SME reply"}


def test_page_comment_filter_rejects_non_http_and_overlong_urls(client):
    beta, _ = headers_for(client, "page-validation@example.test", UserRole.BETA_TESTER)
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=896, course_url="https://my.uconline.ac.nz/course/view.php?id=896", title="UCO")
    course_id = str(course.id)
    session.close()
    assert client.get("/api/comments", headers=beta, params={"course_id": course_id, "page_url": "javascript:alert(1)"}).status_code == 422
    assert client.get("/api/comments", headers=beta, params={"course_id": course_id, "page_url": "https://example.test/" + "a" * 4096}).status_code == 422
