from datetime import UTC, datetime

from app.models import Comment, CommentStatusEvent, User, UserRole
from app.services.comments import AuthorizationError, create_comment, update_comment_status
from app.services.courses import resolve_course


def test_owner_can_change_status_and_each_change_is_append_only(db_session):
    owner = User(email="owner@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(owner)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", body="Fix", category="assessment")

    update_comment_status(db_session, owner, comment, "in_progress")

    assert comment.status == "in_progress"
    assert [event.status for event in db_session.query(CommentStatusEvent).order_by(CommentStatusEvent.created_at).all()] == ["open", "in_progress"]


def test_non_owner_cannot_change_status_but_ld_can(db_session):
    owner = User(email="owner@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    stranger = User(email="stranger@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, stranger, lead])
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", body="Fix", category="assessment")

    try:
        update_comment_status(db_session, stranger, comment, "resolved")
        assert False, "expected an ownership error"
    except AuthorizationError:
        pass
    update_comment_status(db_session, lead, comment, "resolved")
    assert comment.status == "resolved"
