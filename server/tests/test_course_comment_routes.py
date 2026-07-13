from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Comment, Course, CourseMembership, MembershipState, Session, User, UserRole
from app.security import token_hash, utc_now
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


def bound_extension_headers(client, course: Course, role=UserRole.BETA_TESTER):
    session = client.db_factory()
    user = User(email=f"bound-{course.moodle_course_id}@example.test", display_name="Bound reviewer", password_hash="hash", role=UserRole.BETA_TESTER, approved_at=utc_now(), created_at=utc_now())
    session.add(user)
    session.flush()
    membership = CourseMembership(user_id=user.id, course_id=course.id, role=role, state=MembershipState.APPROVED, approved_at=utc_now(), created_at=utc_now(), updated_at=utc_now())
    session.add(membership)
    session.flush()
    raw_token = f"bound-token-{course.moodle_course_id}"
    session.add(Session(user_id=user.id, membership_id=membership.id, token_hash=token_hash(raw_token), kind="extension", expires_at=utc_now() + timedelta(hours=8), created_at=utc_now()))
    session.commit()
    session.close()
    return {"Authorization": f"Bearer {raw_token}"}


def test_bound_extension_identity_is_authoritative_for_the_course(client):
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=896, course_url="https://moodle.example/course/view.php?id=896", title="Law")
    course_id = course.id
    session.close()
    headers = bound_extension_headers(client, Course(id=course_id, moodle_course_id="896"), UserRole.LD_DCD)

    response = client.get(f"/api/me?course_id={course_id}", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "course_id": str(course_id),
        "user": {
            "id": response.json()["user"]["id"],
            "display_name": "Bound reviewer",
            "email": "bound-896@example.test",
            "role": "ld_dcd",
        },
    }


def test_bound_extension_identity_hides_other_courses(client):
    session = client.db_factory()
    own = resolve_course(session, moodle_course_id=896, course_url="https://moodle.example/course/view.php?id=896", title="Own")
    other = resolve_course(session, moodle_course_id=897, course_url="https://moodle.example/course/view.php?id=897", title="Other")
    own_id, other_id = own.id, other.id
    session.close()
    headers = bound_extension_headers(client, Course(id=own_id, moodle_course_id="896"), UserRole.LD_DCD)

    response = client.get(f"/api/me?course_id={other_id}", headers=headers)

    assert response.status_code == 404


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


def test_bound_session_cannot_list_or_create_comments_in_another_course(client):
    session = client.db_factory()
    own = resolve_course(session, moodle_course_id=896, course_url="https://moodle.example/course/view.php?id=896", title="Own")
    other = resolve_course(session, moodle_course_id=897, course_url="https://moodle.example/course/view.php?id=897", title="Other")
    own_id, other_id = own.id, other.id
    session.close()
    headers = bound_extension_headers(client, Course(id=own_id, moodle_course_id="896"))

    listed = client.get(f"/api/comments?course_id={other_id}", headers=headers)
    created = client.post("/api/comments", headers=headers, json={
        "course_id": str(other_id), "page_url": "https://moodle.example/mod/page/view.php?id=9",
        "page_title": "Unit", "body": "Cross-course", "anchor_type": "text_highlight",
        "selected_quote": "Cross", "css_selector": "#content",
    })

    assert listed.status_code == 404
    assert created.status_code == 404


def test_comment_author_can_patch_only_the_body(client):
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=901, course_url="https://moodle.example/course/view.php?id=901", title="Editing")
    session.close()
    headers = bound_extension_headers(client, course)
    created = client.post("/api/comments", headers=headers, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/1", "page_title": "Page",
        "body": "Before", "anchor_type": "text_highlight", "selected_quote": "Before", "css_selector": "#main",
    })

    response = client.patch(f"/api/comments/{created.json()['id']}", headers=headers, json={"body": "  After  "})

    assert response.status_code == 200
    assert response.json()["body"] == "After"
    assert client.patch(f"/api/comments/{created.json()['id']}", headers=headers, json={"body": "   "}).status_code == 422


def test_ask_sme_get_and_put_replace_current_recipients(client):
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=902, course_url="https://moodle.example/course/view.php?id=902", title="SMEs")
    course_id = course.id
    for email, name in (("z@example.test", "Zulu"), ("a@example.test", "Alpha")):
        user = User(email=email, display_name=name, password_hash="hash", role=UserRole.BETA_TESTER, approved_at=utc_now(), created_at=utc_now())
        session.add(user); session.flush()
        session.add(CourseMembership(user_id=user.id, course_id=course_id, role=UserRole.SME, state=MembershipState.APPROVED, approved_at=utc_now(), created_at=utc_now(), updated_at=utc_now()))
    session.commit()
    recipients = session.query(User).filter(User.email.in_(["z@example.test", "a@example.test"])).all()
    session.close()
    course = Course(id=course_id, moodle_course_id="902")
    lead = bound_extension_headers(client, course, UserRole.LD_DCD)
    created = client.post("/api/comments", headers=lead, json={"course_id": str(course_id), "page_url": "https://moodle.example/page/2", "page_title": "Page", "body": "Ask", "anchor_type": "text_highlight", "selected_quote": "Ask", "css_selector": "#main"})
    url = f"/api/comments/{created.json()['id']}/sme-recipients"

    initial = client.get(url, headers=lead)
    assert [item["display_name"] for item in initial.json()["available_recipients"]] == ["Alpha", "Zulu"]
    replaced = client.put(url, headers=lead, json={"user_ids": [str(recipients[0].id)]})
    assert replaced.status_code == 200
    assert replaced.json()["selected_user_ids"] == [str(recipients[0].id)]
    assert client.put(url, headers=lead, json={"user_ids": []}).json()["selected_user_ids"] == []
