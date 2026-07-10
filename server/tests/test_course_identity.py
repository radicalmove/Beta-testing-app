from datetime import UTC, datetime

from app.models import Comment, Course, User
from app.services.courses import confirm_course, resolve_course


def test_moodle_numeric_id_creates_a_confirmed_stable_course(db_session):
    course = resolve_course(db_session, moodle_course_id=123, course_url="https://moodle.example/course/view.php?id=123", title="Law")

    assert course.moodle_course_id == "123"
    assert course.is_confirmed is True
    assert db_session.query(Course).count() == 1


def test_url_and_title_create_an_unconfirmed_temporary_identity(db_session):
    course = resolve_course(db_session, course_url=" HTTPS://Moodle.Example/course/view.php?x=1 ", title="  Intro to Law  ")

    assert course.moodle_course_id is None
    assert course.is_confirmed is False
    assert course.normalized_url == "https://moodle.example/course/view.php?x=1"
    assert course.title == "Intro to Law"


def test_confirm_mapping_reuses_existing_course_and_moves_comments_without_duplicates(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    temporary = resolve_course(db_session, course_url="https://moodle.example/course/view.php?x=1", title="Intro")
    existing = resolve_course(db_session, moodle_course_id=777, course_url="https://moodle.example/course/view.php?id=777", title="Intro")
    comment = Comment(course_id=temporary.id, author_user_id=author.id, body="Needs work", category="content", status="open", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    db_session.add(comment)
    db_session.commit()

    mapped = confirm_course(db_session, temporary, target_course_id=existing.id)

    assert mapped.id == existing.id
    assert db_session.query(Course).count() == 1
    assert db_session.get(Comment, comment.id).course_id == existing.id


def test_confirm_mapping_upgrades_temporary_course_to_a_new_stable_identity_without_losing_comments(db_session):
    author = User(email="tester@example.test", password_hash="hash", approved_at=datetime.now(UTC), created_at=datetime.now(UTC))
    db_session.add(author)
    temporary = resolve_course(db_session, course_url="https://moodle.example/course/view.php?id=88", title="Intro")
    comment = Comment(course_id=temporary.id, author_user_id=author.id, body="Needs work", category="content", status="open", created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
    db_session.add(comment)
    db_session.commit()

    confirmed = confirm_course(db_session, temporary, moodle_course_id=88, course_url="https://moodle.example/course/view.php?id=88", title="Intro")

    assert confirmed.id == temporary.id
    assert confirmed.moodle_course_id == "88" and confirmed.is_confirmed is True
    assert db_session.query(Course).count() == 1
    assert db_session.get(Comment, comment.id).course_id == confirmed.id
