from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Comment, Course, CourseMembership, MembershipState, PageLocation, Session, User, UserRole
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


def bound_extension_headers(client, course: Course, role=UserRole.BETA_TESTER, *, email=None, display_name="Bound reviewer"):
    session = client.db_factory()
    email = email or f"bound-{course.moodle_course_id}@example.test"
    user = User(email=email, display_name=display_name, password_hash="hash", role=UserRole.BETA_TESTER, approved_at=utc_now(), created_at=utc_now())
    session.add(user)
    session.flush()
    membership = CourseMembership(user_id=user.id, course_id=course.id, role=role, state=MembershipState.APPROVED, approved_at=utc_now(), created_at=utc_now(), updated_at=utc_now())
    session.add(membership)
    session.flush()
    raw_token = f"bound-token-{course.moodle_course_id}-{role.value}-{user.id}"
    session.add(Session(user_id=user.id, membership_id=membership.id, token_hash=token_hash(raw_token), kind="extension", expires_at=utc_now() + timedelta(hours=8), created_at=utc_now()))
    session.commit()
    session.close()
    return {"Authorization": f"Bearer {raw_token}"}


def test_course_membership_roles_drive_sme_thread_labels_and_private_replies(client):
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=899, course_url="https://moodle.example/course/view.php?id=899", title="Law")
    course_ref = Course(id=course.id, moodle_course_id="899")
    session.close()
    beta = bound_extension_headers(client, course_ref, UserRole.BETA_TESTER, email="course-beta@example.test", display_name="Course beta")
    lead = bound_extension_headers(client, course_ref, UserRole.LD_DCD, email="course-lead@example.test", display_name="Course lead")
    sme = bound_extension_headers(client, course_ref, UserRole.SME, email="course-sme@example.test", display_name="Course SME")

    created = client.post("/api/comments", headers=beta, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/899", "page_title": "Unit",
        "body": "Beta feedback", "anchor_type": "text_highlight", "selected_quote": "Beta", "css_selector": "#main",
    })
    comment_id = created.json()["id"]
    check = client.db_factory()
    sme_user = check.query(User).filter_by(email="course-sme@example.test").one()
    check.close()

    assert client.put(f"/api/comments/{comment_id}/sme-recipients", headers=lead, json={"user_ids": [str(sme_user.id)]}).status_code == 200
    reply = client.post(f"/api/comments/{comment_id}/replies", headers=sme, json={"body": "Private SME clarification"})
    assert reply.status_code == 201

    lead_view = client.get(f"/api/comments?course_id={course.id}", headers=lead).json()[0]
    sme_view = client.get(f"/api/comments?course_id={course.id}", headers=sme).json()[0]
    beta_view = client.get(f"/api/comments?course_id={course.id}", headers=beta).json()[0]
    assert lead_view["replies"][0]["author"]["role"] == "sme"
    assert sme_view["capabilities"]["can_reply"] is True
    assert beta_view["replies"] == []

    assert client.put(f"/api/comments/{comment_id}/sme-recipients", headers=lead, json={"user_ids": []}).status_code == 200
    assert client.get(f"/api/comments?course_id={course.id}", headers=sme).json() == []

    sme_origin = client.post("/api/comments", headers=sme, json={
        "course_id": str(course.id), "page_url": "https://moodle.example/page/899", "page_title": "Unit",
        "body": "SME feedback", "anchor_type": "text_highlight", "selected_quote": "SME", "css_selector": "#main",
    })
    assert sme_origin.status_code == 201
    rendered = next(item for item in client.get(f"/api/comments?course_id={course.id}", headers=lead).json() if item["id"] == sme_origin.json()["id"])
    assert rendered["author"] == {"display_name": "Course SME", "role": "sme"}
    assert rendered["capabilities"]["can_share_with_sme"] is False


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


def test_course_comment_list_includes_locations_and_excludes_other_courses(client):
    headers = extension_headers(client, UserRole.LD_DCD)
    first = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=12", "title": "Law", "moodle_course_id": 12}).json()["id"]
    second = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=13", "title": "Other", "moodle_course_id": 13}).json()["id"]
    for course_id, page_id in [(first, 91), (first, 92), (second, 93)]:
        client.post("/api/comments", headers=headers, json={"course_id": course_id, "page_url": f"https://moodle.example/mod/page/view.php?id={page_id}", "page_title": f"Page {page_id}", "body": f"Comment {page_id}", "anchor_type": "text_highlight", "selected_quote": "Comment", "css_selector": "#main"})

    response = client.get(f"/api/comments?course_id={first}", headers=headers)

    assert response.status_code == 200
    assert {item["page_title"] for item in response.json()} == {"Page 91", "Page 92"}
    assert all(item["page_url"].endswith(("91", "92")) for item in response.json())
    assert all(item["parent_activity_url"] is None and item["embedded_locator"] is None for item in response.json())


def test_embedded_navigation_metadata_round_trips_through_course_comment_list(client):
    headers = extension_headers(client)
    course = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=20", "title": "Law", "moodle_course_id": 20})
    payload = {
        "course_id": course.json()["id"], "page_url": "https://rise.example/scorm/index.html", "page_title": "Lesson 1", "body": "Clarify",
        "anchor_type": "visual_pin", "css_selector": "#main", "relative_x": .2, "relative_y": .3,
        "parent_activity_url": "https://moodle.example/mod/scorm/player.php?a=9", "embedded_locator": "/activity/index.html#/lessons/one",
        "interaction_context": {
            "version": 1, "kind": "tabs",
            "container": {"block_id": "tabs-1", "ordinal": 1, "fingerprint": "Constitution types"},
            "item": {"ordinal": 2, "count": 2, "label": "Unwritten (uncodified)", "control_key": "panel-unwritten"},
        },
    }
    created = client.post("/api/comments", headers=headers, json=payload)
    assert created.status_code == 201
    listed = client.get(f"/api/comments?course_id={course.json()['id']}", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["parent_activity_url"] == payload["parent_activity_url"]
    assert listed.json()[0]["embedded_locator"] == payload["embedded_locator"]
    assert listed.json()[0]["interaction_context"] == payload["interaction_context"]


def test_course_comment_list_fails_closed_for_malformed_stored_interaction_context(client):
    headers = extension_headers(client)
    course = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=22", "title": "Law", "moodle_course_id": 22})
    created = client.post("/api/comments", headers=headers, json={
        "course_id": course.json()["id"], "page_url": "https://rise.example/index.html", "page_title": "Lesson", "body": "Clarify",
        "anchor_type": "visual_pin", "css_selector": "#main", "relative_x": .2, "relative_y": .3,
    })
    check = client.db_factory()
    comment = check.get(Comment, UUID(created.json()["id"]))
    location = check.get(PageLocation, comment.location_id)
    location.interaction_context = {"version": 99, "kind": "tabs"}
    check.commit()
    check.close()

    listed = client.get(f"/api/comments?course_id={course.json()['id']}", headers=headers)

    assert listed.status_code == 422


def test_embedded_parent_with_out_of_range_port_returns_validation_error(client):
    headers = extension_headers(client)
    course = client.post("/api/courses/resolve", headers=headers, json={"course_url": "https://moodle.example/course/view.php?id=21", "title": "Law", "moodle_course_id": 21})
    response = client.post("/api/comments", headers=headers, json={
        "course_id": course.json()["id"], "page_url": "https://rise.example/scorm/index.html", "page_title": "Lesson", "body": "Clarify",
        "anchor_type": "visual_pin", "css_selector": "#main", "relative_x": .2, "relative_y": .3,
        "parent_activity_url": "https://moodle.example:99999/mod/scorm/player.php", "embedded_locator": "#/lessons/one",
    })
    assert response.status_code == 422


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
    beta = bound_extension_headers(client, course, UserRole.BETA_TESTER, email="ask-beta@example.test")
    created = client.post("/api/comments", headers=beta, json={"course_id": str(course_id), "page_url": "https://moodle.example/page/2", "page_title": "Page", "body": "Ask", "anchor_type": "text_highlight", "selected_quote": "Ask", "css_selector": "#main"})
    url = f"/api/comments/{created.json()['id']}/sme-recipients"

    initial = client.get(url, headers=lead)
    assert [item["display_name"] for item in initial.json()["available_recipients"]] == ["Alpha", "Zulu"]
    replaced = client.put(url, headers=lead, json={"user_ids": [str(recipients[0].id)]})
    assert replaced.status_code == 200
    assert replaced.json()["selected_user_ids"] == [str(recipients[0].id)]
    assert client.put(url, headers=lead, json={"user_ids": []}).json()["selected_user_ids"] == []
