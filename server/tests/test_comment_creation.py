from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models import Comment, CommentStatusEvent, PageLocation, User
from app.schemas import CommentCreateRequest
from app.services.comments import create_comment
from app.services.courses import resolve_course


def test_text_highlight_persists_anchor_category_open_status_and_immutable_audit_event(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(
        db_session, author,
        course_id=course.id, page_url="https://moodle.example/mod/page/view.php?id=9", page_title="Unit 1", body="Clarify this", category="learning_design_content_flow", anchor_type="text_highlight",
        selected_quote="the selected words", prefix="Before ", suffix=" after", css_selector=".lesson p:nth-child(2)", dom_selector="#main .content",
    )

    location = db_session.get(PageLocation, comment.location_id)
    event = db_session.query(CommentStatusEvent).one()
    assert comment.status == "open"
    assert location.selected_quote == "the selected words"
    assert location.page_title == "Unit 1" and location.anchor_type == "text_highlight"
    assert location.prefix == "Before " and location.suffix == " after"
    assert location.css_selector == ".lesson p:nth-child(2)" and location.dom_selector == "#main .content"
    assert event.status == "open" and event.comment_id == comment.id


def test_visual_pin_persists_relative_coordinates(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(db_session, author, course_id=course.id, page_url="https://moodle.example/mod/page/view.php?id=9", page_title="Unit 1", body="Move this", category="learning_design_content_flow", anchor_type="visual_pin", css_selector="#diagram", relative_x=0.25, relative_y=0.75)

    location = db_session.get(PageLocation, comment.location_id)
    assert location.relative_x == 0.25 and location.relative_y == 0.75


def test_text_highlight_accepts_context_when_a_selector_is_unavailable(db_session):
    author = User(email="context@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(db_session, author, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Clarify", category="general", anchor_type="text_highlight", selected_quote="Selected text", prefix="Before the selected text")

    assert comment.location_id is not None


@pytest.mark.parametrize("category", ["language_grammar", "learning_design_content_flow", "accessibility", "technical_link_media_interaction", "assessment", "general"])
def test_comment_categories_are_limited_to_the_approved_ui_categories(db_session, category):
    author = User(email=f"{category}@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    comment = create_comment(db_session, author, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category=category, anchor_type="text_highlight", selected_quote="Selected text", css_selector="#content")

    assert comment.category.value == category


@pytest.mark.parametrize(
    "anchor_type, selected_quote, css_selector, relative_x, relative_y",
    [
        ("text_highlight", "   ", None, None, None),
        ("text_highlight", "Selected text", None, None, None),
        ("visual_pin", None, "   ", 0.25, 0.75),
        ("visual_pin", None, "#diagram", 0.25, None),
    ],
)
def test_comment_creation_rejects_unanchored_or_incomplete_anchor_payloads(db_session, anchor_type, selected_quote, css_selector, relative_x, relative_y):
    author = User(email=f"{anchor_type}-{relative_x}@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    course = resolve_course(db_session, moodle_course_id=12, course_url="https://moodle.example/course/view.php?id=12", title="Law")

    with pytest.raises(ValueError):
        create_comment(db_session, author, course_id=course.id, page_url="https://moodle.example/page/9", page_title="Unit 1", body="Fix", category="general", anchor_type=anchor_type, selected_quote=selected_quote, css_selector=css_selector, relative_x=relative_x, relative_y=relative_y)


def test_comment_request_requires_page_title_and_anchor_type():
    with pytest.raises(ValidationError):
        CommentCreateRequest(course_id="00000000-0000-0000-0000-000000000001", page_url="https://moodle.example/page/9", body="Fix", category="general")
