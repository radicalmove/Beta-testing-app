from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Course, UserRole
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
    comment_id, _ = seed(dashboard_client)
    login(dashboard_client, "lead@example.test", UserRole.LD_DCD)
    response = dashboard_client.get("/dashboard?status=open&category=language_grammar&author_role=beta_tester&unread=1&page=Welcome")
    assert response.status_code == 200
    html = response.text
    assert "Justice 101" in html and "Welcome page" in html and "Open" in html
    assert "Draft course" in html and "Confirm course mapping" in html
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
