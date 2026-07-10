from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Comment, Course, User, UserRole
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


def extension_headers(client, role=UserRole.BETA_TESTER):
    session = client.db_factory()
    user = User(email=f"{role.value}@example.test", password_hash="hash", role=role, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    session.add(user)
    session.commit()
    code = create_extension_login_code(session, user, "https://abcdefghijklmnop.chromiumapp.org/")
    token = exchange_extension_login_code(session, code, "https://abcdefghijklmnop.chromiumapp.org/")
    session.close()
    return {"Authorization": f"Bearer {token}"}


def test_extension_comment_route_defaults_omitted_category_to_general(client):
    headers = extension_headers(client)
    course = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=12", "title": "Law", "moodle_course_id": 12})

    response = client.post("/api/comments", headers=headers, json={
        "course_id": course.json()["id"], "page_url": "https://moodle.example/mod/page/view.php?id=9",
        "page_title": "Unit 1", "body": "Clarify this", "anchor_type": "text_highlight",
        "selected_quote": "Clarify", "css_selector": "#content",
    })

    assert response.status_code == 201
    assert response.json()["category"] == "general"
    check = client.db_factory()
    assert check.get(Comment, UUID(response.json()["id"])).category.value == "general"
    check.close()


def test_extension_course_confirmation_rejects_a_confirmed_source_without_deleting_it(client):
    headers = extension_headers(client, UserRole.LD_DCD)
    session = client.db_factory()
    source = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    target = resolve_course(session, moodle_course_id=13, course_url="https://moodle.example/course/view.php?id=13", title="Justice")
    source_id, target_id = str(source.id), str(target.id)
    session.close()

    response = client.post(f"/api/courses/{source_id}/confirm", headers=headers, json={"target_course_id": target_id})

    assert response.status_code == 409
    assert response.json() == {"detail": "Only an unconfirmed temporary course can be confirmed or mapped"}
    check = client.db_factory()
    assert check.get(Course, UUID(source_id)).is_confirmed is True
    assert check.get(Course, UUID(target_id)).is_confirmed is True
    check.close()


@pytest.mark.parametrize("url", ["/course/view.php?id=12", "javascript:alert(1)", "ftp://moodle.example/course"])
def test_extension_routes_reject_non_http_absolute_course_and_page_urls(client, url):
    headers = extension_headers(client)
    course = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=12", "title": "Law", "moodle_course_id": 12})

    resolved = client.post("/api/courses/resolve", headers=headers, json={"course_url": url, "title": "Bad"})
    comment = client.post("/api/comments", headers=headers, json={
        "course_id": course.json()["id"], "page_url": url, "page_title": "Unit 1", "body": "Clarify this",
        "anchor_type": "text_highlight", "selected_quote": "Clarify", "css_selector": "#content",
    })

    assert resolved.status_code == 422
    assert comment.status_code == 422
