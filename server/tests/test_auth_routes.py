from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import create_app
from app.models import Session, User, UserRole
from app.services.accounts import register_account


@pytest.fixture
def client(monkeypatch):
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


def test_json_registration_creates_a_pending_account(client):
    response = client.post("/auth/register", json={"display_name": "New Tester", "email": "new@example.test", "password": "long enough password"})

    assert response.status_code == 201
    assert response.json()["status"] == "pending"
    user = client.db_factory().query(User).one()
    assert user.approved_at is None
    assert user.display_name == "New Tester"


def test_json_registration_requires_a_trimmed_display_name(client):
    missing = client.post("/auth/register", json={"email": "new@example.test", "password": "long enough password"})
    blank = client.post("/auth/register", json={"display_name": "   ", "email": "new@example.test", "password": "long enough password"})
    assert missing.status_code == 422
    assert blank.status_code == 422


def test_json_registration_rejects_a_duplicate_email_with_a_conflict_response(client):
    payload = {"display_name": "New Tester", "email": "new@example.test", "password": "long enough password"}
    assert client.post("/auth/register", json=payload).status_code == 201

    response = client.post("/auth/register", json=payload)

    assert response.status_code == 409
    assert response.json() == {"detail": "An account with that email already exists"}


@pytest.mark.parametrize("email", ["   ", " @ ", " user@ "])
def test_json_registration_strips_email_before_validating_it(client, email):
    response = client.post(
        "/auth/register", json={"display_name": "New Tester", "email": email, "password": "long enough password"}
    )

    assert response.status_code == 422


def test_login_rejects_pending_accounts_with_a_generic_failure(client):
    client.post("/auth/register", json={"display_name": "New Tester", "email": "new@example.test", "password": "long enough password"})

    response = client.post("/auth/login", json={"email": "new@example.test", "password": "long enough password"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_uses_the_same_generic_failure_for_malformed_credentials(client):
    response = client.post("/auth/login", json={"email": "not-an-email", "password": "short"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_approved_login_issues_cookie_and_logout_revokes_it(client):
    session = client.db_factory()
    user = register_account(session, email="approved@example.test", password="long enough password")
    user.approved_at = datetime.now(UTC)
    session.commit()
    session.close()

    login = client.post("/auth/login", json={"email": "approved@example.test", "password": "long enough password"})
    assert login.status_code == 200
    assert "dashboard_session" in login.cookies

    assert client.post("/auth/logout").status_code == 204
    check = client.db_factory()
    assert check.query(Session).one().revoked_at is not None
    check.close()


def test_admin_browser_login_lands_on_account_approvals(client):
    session = client.db_factory()
    admin = register_account(session, email="admin@example.test", password="long enough password")
    admin.role, admin.approved_at = UserRole.ADMIN, datetime.now(UTC)
    member = register_account(session, email="member@example.test", password="long enough password")
    session.commit()
    member_id = str(member.id)
    session.close()

    client.get("/login")
    login = client.post(
        "/login",
        data={
            "email": "admin@example.test",
            "password": "long enough password",
            "csrf_token": client.cookies["csrf_token"],
        },
        follow_redirects=True,
    )

    assert login.status_code == 200
    assert login.url.path == "/admin/users"
    assert f'/admin/users/{member_id}/approve' in login.text


def test_browser_mutations_require_a_valid_csrf_token(client):
    assert client.post("/register", data={"email": "new@example.test", "password": "long enough password"}).status_code == 403

    page = client.get("/register")
    csrf = client.cookies.get("csrf_token")
    accepted = client.post("/register", data={"display_name": "New Tester", "email": "new@example.test", "password": "long enough password", "csrf_token": csrf}, follow_redirects=False)
    assert page.status_code == 200
    assert accepted.status_code == 303


def test_browser_logout_requires_csrf(client):
    session = client.db_factory()
    user = register_account(session, email="approved@example.test", password="long enough password")
    user.approved_at = datetime.now(UTC)
    session.commit()
    session.close()
    client.post("/auth/login", json={"email": "approved@example.test", "password": "long enough password"})

    assert client.post("/logout", data={}).status_code == 403


def test_extension_authorization_requires_an_allowlisted_redirect_and_exchanges_once(client, monkeypatch):
    import app.routers.auth as auth

    monkeypatch.setattr(auth, "extension_redirect_uris", lambda: {"https://abcdefghijklmnop.chromiumapp.org/"})
    assert client.get("/extension/authorize", params={"redirect_uri": "https://nope.example/"}).status_code == 400

    session = client.db_factory()
    user = register_account(session, email="approved@example.test", password="long enough password")
    user.approved_at = datetime.now(UTC)
    session.commit()
    session.close()
    client.post("/auth/login", json={"email": "approved@example.test", "password": "long enough password"})

    response = client.get("/extension/authorize", params={"redirect_uri": "https://abcdefghijklmnop.chromiumapp.org/"}, follow_redirects=False)
    assert response.status_code == 303
    code = response.headers["location"].split("code=", 1)[1]
    token = client.post("/extension/token", json={"code": code, "redirect_uri": "https://abcdefghijklmnop.chromiumapp.org/"})
    assert token.status_code == 200
    assert token.json()["access_token"]
    assert client.post("/extension/token", json={"code": code, "redirect_uri": "https://abcdefghijklmnop.chromiumapp.org/"}).status_code == 401
