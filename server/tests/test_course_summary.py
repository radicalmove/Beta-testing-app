from app.models import CommentStatus, UserRole
from app.services.comments import create_comment
from app.services.courses import resolve_course
from app.services.summary import course_summary_for


def test_course_summary_counts_only_the_requested_course(db_session):
    from app.models import User
    from app.security import utc_now
    ld = User(email="ld@example.test", display_name="LD", password_hash="x", role=UserRole.LD_DCD, approved_at=utc_now(), created_at=utc_now())
    db_session.add(ld); db_session.flush()
    first = resolve_course(db_session, moodle_course_id=896, course_url="https://my.uconline.ac.nz/course/view.php?id=896", title="CRJU150")
    second = resolve_course(db_session, moodle_course_id=897, course_url="https://my.uconline.ac.nz/course/view.php?id=897", title="Other")
    one = create_comment(db_session, ld, course_id=first.id, page_url="https://my.uconline.ac.nz/mod/page/view.php?id=1", page_title="One", body="Open", category="general", anchor_type="text_highlight", selected_quote="Open", css_selector="#one")
    two = create_comment(db_session, ld, course_id=first.id, page_url="https://my.uconline.ac.nz/mod/page/view.php?id=2", page_title="Two", body="Resolved", category="accessibility", anchor_type="text_highlight", selected_quote="Resolved", css_selector="#two")
    two.status = CommentStatus.RESOLVED
    create_comment(db_session, ld, course_id=second.id, page_url="https://my.uconline.ac.nz/mod/page/view.php?id=3", page_title="Other", body="Hidden", category="general", anchor_type="text_highlight", selected_quote="Hidden", css_selector="#three")
    db_session.commit()

    summary = course_summary_for(db_session, ld, first.id)

    assert summary["total"] == 2
    assert summary["statuses"] == {"open": 1, "in_progress": 0, "awaiting_sme": 0, "resolved": 1, "deferred": 0}
    assert {item["page_title"] for item in summary["comments"]} == {"One", "Two"}
