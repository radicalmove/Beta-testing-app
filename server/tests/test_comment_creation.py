from datetime import UTC, datetime

from app.models import Comment, CommentStatusEvent, PageLocation, User
from app.services.comments import create_comment
from app.services.courses import resolve_course


def test_text_highlight_persists_anchor_category_open_status_and_immutable_audit_event(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(
        db_session, author,
        course_id=course.id, page_url="https://moodle.example/mod/page/view.php?id=9", body="Clarify this", category="content",
        selected_quote="the selected words", prefix="Before ", suffix=" after", css_selector=".lesson p:nth-child(2)", dom_selector="#main .content",
    )

    location = db_session.get(PageLocation, comment.location_id)
    event = db_session.query(CommentStatusEvent).one()
    assert comment.status == "open"
    assert location.selected_quote == "the selected words"
    assert location.prefix == "Before " and location.suffix == " after"
    assert location.css_selector == ".lesson p:nth-child(2)" and location.dom_selector == "#main .content"
    assert event.status == "open" and event.comment_id == comment.id


def test_visual_pin_persists_relative_coordinates(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(db_session, author, course_id=course.id, page_url="https://moodle.example/mod/page/view.php?id=9", body="Move this", category="design", relative_x=0.25, relative_y=0.75)

    location = db_session.get(PageLocation, comment.location_id)
    assert location.relative_x == 0.25 and location.relative_y == 0.75
