from datetime import UTC, datetime

from app.models import Comment, CommentStatus, CommentStatusEvent, User, UserRole
import pytest

from app.services.comments import AuthorizationError, create_comment, update_comment_status
from app.services.courses import resolve_course


def test_ld_dcd_can_change_status_and_each_change_is_append_only(db_session):
    owner = User(email="owner@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, lead])
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category="assessment", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")

    update_comment_status(db_session, lead, comment, "in_progress")

    assert comment.status == "in_progress"
    assert [event.status for event in db_session.query(CommentStatusEvent).order_by(CommentStatusEvent.created_at).all()] == ["open", "in_progress"]


def test_non_owner_cannot_change_status_but_ld_can(db_session):
    owner = User(email="owner@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    stranger = User(email="stranger@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, stranger, lead])
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category="assessment", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")

    try:
        update_comment_status(db_session, stranger, comment, "resolved")
        assert False, "expected an ownership error"
    except AuthorizationError:
        pass
    update_comment_status(db_session, lead, comment, "in_progress")
    update_comment_status(db_session, lead, comment, "resolved")
    assert comment.status == "resolved"


def test_repeating_current_status_is_idempotent(db_session):
    owner = User(email="owner@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, lead])
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category="assessment", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")

    returned = update_comment_status(db_session, lead, comment, "open")

    assert returned.status is CommentStatus.OPEN
    assert [event.status for event in db_session.query(CommentStatusEvent).all()] == [CommentStatus.OPEN]


def test_open_rejects_skipped_status_transition(db_session):
    owner = User(email="owner-skip@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead-skip@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, lead])
    course = resolve_course(db_session, moodle_course_id=13, course_url="https://moodle.example/course/view.php?id=13", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/13", page_title="Unit 1", body="Fix", category="assessment", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")

    with pytest.raises(ValueError, match="Invalid status transition"):
        update_comment_status(db_session, lead, comment, "awaiting_sme")


def test_ld_can_resolve_open_feedback_and_reopen_it(db_session):
    owner = User(email="owner-reopen@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email="lead-reopen@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, lead]); course = resolve_course(db_session, moodle_course_id=15, course_url="https://moodle.example/course/view.php?id=15", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/15", page_title="Unit", body="Fix", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")
    update_comment_status(db_session, lead, comment, "resolved"); assert comment.status is CommentStatus.RESOLVED
    update_comment_status(db_session, lead, comment, "open"); assert comment.status is CommentStatus.OPEN


@pytest.mark.parametrize("terminal", ["resolved", "deferred"])
def test_terminal_statuses_reject_reversals(db_session, terminal):
    owner = User(email=f"owner-{terminal}@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    lead = User(email=f"lead-{terminal}@example.test", password_hash="hash", role=UserRole.LD_DCD, approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add_all([owner, lead])
    course = resolve_course(db_session, moodle_course_id=12, course_url=f"https://moodle.example/course/view.php?id={terminal}", title="Law")
    comment = create_comment(db_session, owner, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category="assessment", anchor_type="text_highlight", selected_quote="Fix", css_selector="#content")
    update_comment_status(db_session, lead, comment, terminal if terminal == "deferred" else "in_progress")
    if terminal == "resolved":
        update_comment_status(db_session, lead, comment, terminal)

    with pytest.raises(ValueError, match="Invalid status transition"):
        update_comment_status(db_session, lead, comment, "in_progress")
