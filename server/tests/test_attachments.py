import io
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import get_settings
from app.db import Base, get_session
from app.main import create_app
from app.models import Attachment, User, UserRole
from app.services.accounts import create_extension_login_code, exchange_extension_login_code
from app.services.courses import resolve_course


PNG = b"\x89PNG\r\n\x1a\n" + b"small-png"
JPEG = b"\xff\xd8\xff\xe0" + b"small-jpeg"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ATTACHMENT_STORAGE_DIR", str(tmp_path / "private-attachments"))
    monkeypatch.setenv("ATTACHMENT_MAX_BYTES", "32")
    get_settings.cache_clear()
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
        test_client.storage_dir = tmp_path / "private-attachments"
        yield test_client
    get_settings.cache_clear()


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


def make_comment(client, headers):
    session = client.db_factory()
    course = resolve_course(session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    course_id = str(course.id)
    session.close()
    response = client.post("/api/comments", headers=headers, json={
        "course_id": course_id, "page_url": "https://moodle.example/mod/page/view.php?id=9", "page_title": "Unit 1",
        "body": "Screenshot evidence", "anchor_type": "text_highlight", "selected_quote": "selected", "css_selector": "#content",
    })
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.parametrize(("filename", "content_type", "content", "expected_type"), [
    ("proof.png", "image/png", PNG, "image/png"),
    ("proof.jpg", "image/jpeg", JPEG, "image/jpeg"),
])
def test_comment_author_can_upload_and_download_signature_verified_image(client, filename, content_type, content, expected_type):
    author, _ = headers_for(client, "author@example.test", UserRole.BETA_TESTER)
    comment_id = make_comment(client, author)

    response = client.post(f"/api/comments/{comment_id}/attachments", headers=author, files={"file": (filename, io.BytesIO(content), content_type)})

    assert response.status_code == 201
    assert response.json()["media_type"] == expected_type
    attachment_id = response.json()["id"]
    download = client.get(f"/api/attachments/{attachment_id}", headers=author)
    assert download.status_code == 200
    assert download.content == content
    assert download.headers["content-type"] == expected_type
    check = client.db_factory()
    record = check.query(Attachment).one()
    assert record.object_name != filename
    assert Path(record.object_name).name == record.object_name
    assert (client.storage_dir / record.object_name).read_bytes() == content
    check.close()


@pytest.mark.parametrize(("filename", "content_type", "content", "status_code"), [
    ("proof.gif", "image/gif", b"GIF89a", 415),
    ("large.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"x" * 25, 413),
    ("fake.png", "image/png", JPEG, 415),
])
def test_upload_rejects_unsupported_oversized_or_mismatched_content(client, filename, content_type, content, status_code):
    author, _ = headers_for(client, "author@example.test", UserRole.BETA_TESTER)
    comment_id = make_comment(client, author)

    response = client.post(f"/api/comments/{comment_id}/attachments", headers=author, files={"file": (filename, io.BytesIO(content), content_type)})

    assert response.status_code == status_code
    assert not client.storage_dir.exists() or list(client.storage_dir.iterdir()) == []


def test_upload_requires_visibility_then_author_or_ld_dcd_permission(client):
    author, _ = headers_for(client, "author@example.test", UserRole.BETA_TESTER)
    other_beta, _ = headers_for(client, "other@example.test", UserRole.BETA_TESTER)
    lead, _ = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    admin, _ = headers_for(client, "admin@example.test", UserRole.ADMIN)
    comment_id = make_comment(client, author)

    assert client.post(f"/api/comments/{comment_id}/attachments", headers=other_beta, files={"file": ("proof.png", PNG, "image/png")}).status_code == 404
    assert client.post(f"/api/comments/{comment_id}/attachments", headers=admin, files={"file": ("proof.png", PNG, "image/png")}).status_code == 403
    assert client.post(f"/api/comments/{comment_id}/attachments", headers=lead, files={"file": ("proof.png", PNG, "image/png")}).status_code == 201


def test_download_requires_thread_visibility(client):
    author, _ = headers_for(client, "author@example.test", UserRole.BETA_TESTER)
    other_beta, _ = headers_for(client, "other@example.test", UserRole.BETA_TESTER)
    lead, _ = headers_for(client, "lead@example.test", UserRole.LD_DCD)
    comment_id = make_comment(client, author)
    uploaded = client.post(f"/api/comments/{comment_id}/attachments", headers=author, files={"file": ("proof.png", PNG, "image/png")})
    attachment_id = uploaded.json()["id"]

    assert client.get(f"/api/attachments/{attachment_id}", headers=other_beta).status_code == 404
    assert client.get(f"/api/attachments/{attachment_id}", headers=lead).status_code == 200
