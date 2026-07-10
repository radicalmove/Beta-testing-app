from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Comment, Course, PageLocation, User, UserRole
from app.services.accounts import register_account
from app.services.comments import create_comment, create_reply


@pytest.fixture
def dashboard_client():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    app = create_app()
    app.dependency_overrides[get_session] = lambda: (yield factory())
    with TestClient(app, base_url="https://testserver") as client:
        client.db_factory = factory
        yield client


def login(client, email, role):
    db = client.db_factory()
    user = register_account(db, email=email, password="long enough password")
    user.role, user.approved_at = role, datetime.now(UTC)
    db.commit()
    client.post("/auth/login", json={"email": email, "password": "long enough password"})
    return user


def seed(client):
    db = client.db_factory()
    beta = register_account(db, email="beta@example.test", password="long enough password")
    beta.role, beta.approved_at = UserRole.BETA_TESTER, datetime.now(UTC)
    sme = register_account(db, email="sme@example.test", password="long enough password")
    sme.role, sme.approved_at = UserRole.SME, datetime.now(UTC)
    course = Course(normalized_url="https://moodle.test/course/view.php?id=7", title="Justice 101", identity_title="justice 101", moodle_course_id="7", is_confirmed=True, created_at=datetime.now(UTC), confirmed_at=datetime.now(UTC))
    unconfirmed = Course(normalized_url="https://moodle.test/course/view.php?id=8", title="Draft course", identity_title="draft course", is_confirmed=False, created_at=datetime.now(UTC))
    db.add_all([course, unconfirmed]); db.commit()
    comment = create_comment(db, beta, course_id=course.id, page_url="https://moodle.test/mod/page/view.php?id=42", page_title="Welcome page", body="Please clarify this wording", category="language_grammar", anchor_type="text_highlight", selected_quote="wording", prefix="this ")
    create_reply(db, beta, comment, "A follow-up reply")
    ids = comment.id, unconfirmed.id
    db.close()
    return ids


def test_ld_dashboard_groups_courses_filters_and_shows_totals_and_mapping_controls(dashboard_client):
    comment_id, unconfirmed_id = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    response = dashboard_client.get("/dashboard?status=open&category=language_grammar&author_role=beta_tester&unread=1&page=Welcome")
    assert response.status_code == 200
    html = response.text
    assert "Justice 101" in html and "Welcome page" in html and "Open" in html
    assert "Draft course" in html and "Confirm course mapping" in html
    assert f'action="/dashboard/courses/{unconfirmed_id}/confirm"' in html
    assert 'name="csrf_token"' in html
    assert 'name="mapping_choice"' in html
    assert 'value="new"' in html and "Confirm as a new course" in html
    assert f'value="{unconfirmed_id}"' not in html
    assert "Map to an existing confirmed course" in html
    assert "Justice 101" in html and 'selected' in html
    assert "Take me there" in html and "https://moodle.test/mod/page/view.php?id=42" in html
    assert f'/dashboard/threads/{comment_id}' in html
    for name in ("page", "category", "author_role", "status", "unread"):
        assert f'name="{name}"' in html


def test_reviewer_dashboard_uses_role_safe_visibility_and_hides_ld_controls(dashboard_client):
    seed(dashboard_client)
    login(dashboard_client, "other-beta@example.test", UserRole.BETA_TESTER)
    html = dashboard_client.get("/dashboard").text
    assert "Please clarify" not in html
    assert "Confirm course mapping" not in html and "Share with SME" not in html


def test_thread_is_readable_replyable_and_status_actions_are_csrf_protected(dashboard_client):
    comment_id, _ = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    page = dashboard_client.get(f"/dashboard/threads/{comment_id}")
    assert page.status_code == 200 and "A follow-up reply" in page.text and "Status history" in page.text
    assert dashboard_client.post(f"/dashboard/threads/{comment_id}/status", data={"status": "in_progress"}).status_code == 403
    csrf = dashboard_client.cookies["csrf_token"]
    changed = dashboard_client.post(f"/dashboard/threads/{comment_id}/status", data={"status": "in_progress", "csrf_token": csrf}, follow_redirects=False)
    assert changed.status_code == 303


def test_admin_is_redirected_to_admin_area_not_review_data(dashboard_client):
    seed(dashboard_client); login(dashboard_client, "admin@example.test", UserRole.ADMIN)
    response = dashboard_client.get("/dashboard", follow_redirects=False)
    assert response.status_code == 303 and response.headers["location"] == "/admin/users"


def test_ld_can_map_an_unconfirmed_course_to_selected_existing_course_and_preserve_feedback(dashboard_client):
    _, unconfirmed_id = seed(dashboard_client)
    db = dashboard_client.db_factory()
    source = db.get(Course, unconfirmed_id)
    target = db.query(Course).filter(Course.is_confirmed.is_(True)).one()
    beta = db.query(User).filter_by(email="beta@example.test").one()
    comment = create_comment(db, beta, course_id=source.id, page_url="https://moodle.test/mod/page/view.php?id=88", page_title="Draft activity", body="Keep this feedback", category="general", anchor_type="text_highlight", selected_quote="this feedback", prefix="Keep ")
    comment_id, location_id, target_id = comment.id, comment.location_id, target.id
    db.close()
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    dashboard_client.get("/dashboard")
    response = dashboard_client.post(
        f"/dashboard/courses/{unconfirmed_id}/confirm",
        data={"csrf_token": dashboard_client.cookies["csrf_token"], "mapping_choice": str(target_id)},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/dashboard?mapping=success"
    db = dashboard_client.db_factory()
    assert db.get(Course, unconfirmed_id) is None
    assert db.get(Comment, comment_id).course_id == target_id
    location = db.get(PageLocation, location_id)
    assert location.course_id == target_id
    assert (location.page_title, location.selected_quote, location.prefix) == ("Draft activity", "this feedback", "Keep ")


def test_ld_can_confirm_an_unconfirmed_course_as_new(dashboard_client):
    _, unconfirmed_id = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    dashboard_client.get("/dashboard")
    response = dashboard_client.post(
        f"/dashboard/courses/{unconfirmed_id}/confirm",
        data={"csrf_token": dashboard_client.cookies["csrf_token"], "mapping_choice": "new"},
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/dashboard?mapping=success"
    db = dashboard_client.db_factory()
    assert db.get(Course, unconfirmed_id).is_confirmed is True


def test_course_mapping_browser_route_requires_csrf_and_ld_role(dashboard_client):
    _, unconfirmed_id = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    assert dashboard_client.post(f"/dashboard/courses/{unconfirmed_id}/confirm", data={"mapping_choice": "new"}).status_code == 403

    for email, role in (("beta-map@example.test", UserRole.BETA_TESTER), ("sme-map@example.test", UserRole.SME), ("admin-map@example.test", UserRole.ADMIN)):
        dashboard_client.cookies.clear()
        login(dashboard_client, email, role)
        dashboard_client.get("/login")
        response = dashboard_client.post(
            f"/dashboard/courses/{unconfirmed_id}/confirm",
            data={"csrf_token": dashboard_client.cookies["csrf_token"], "mapping_choice": "new"},
        )
        assert response.status_code == 403


def test_course_mapping_validation_conflict_and_not_found_redirect_with_accessible_feedback(dashboard_client):
    _, unconfirmed_id = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    dashboard_client.get("/dashboard")
    csrf = dashboard_client.cookies["csrf_token"]

    invalid = dashboard_client.post(f"/dashboard/courses/{unconfirmed_id}/confirm", data={"csrf_token": csrf, "mapping_choice": "not-a-course"}, follow_redirects=False)
    assert invalid.status_code == 303 and "mapping=error" in invalid.headers["location"]
    error_page = dashboard_client.get(invalid.headers["location"])
    assert 'role="alert"' in error_page.text and "Choose a valid confirmed course" in error_page.text

    missing = dashboard_client.post(f"/dashboard/courses/00000000-0000-0000-0000-000000000000/confirm", data={"csrf_token": csrf, "mapping_choice": "new"}, follow_redirects=False)
    assert missing.status_code == 303 and "mapping=error" in missing.headers["location"]
    assert "Course not found" in dashboard_client.get(missing.headers["location"]).text

    ok = dashboard_client.post(f"/dashboard/courses/{unconfirmed_id}/confirm", data={"csrf_token": csrf, "mapping_choice": "new"}, follow_redirects=False)
    assert ok.status_code == 303
    conflict = dashboard_client.post(f"/dashboard/courses/{unconfirmed_id}/confirm", data={"csrf_token": csrf, "mapping_choice": "new"}, follow_redirects=False)
    assert conflict.status_code == 303 and "mapping=error" in conflict.headers["location"]
    assert "already confirmed" in dashboard_client.get(conflict.headers["location"]).text
    assert 'role="status"' in dashboard_client.get(ok.headers["location"]).text
