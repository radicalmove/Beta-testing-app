from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession

from app.models import Comment, Course, PageLocation
from app.security import utc_now


def normalize_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("course_url must be an absolute http or https URL")
    return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path or "/", parsed.query, ""))


def normalize_title(value: str) -> tuple[str, str]:
    title = " ".join(value.split())
    if not title:
        raise ValueError("title is required")
    return title, title.casefold()


def resolve_course(db: DbSession, *, course_url: str, title: str, moodle_course_id: int | str | None = None) -> Course:
    url = normalize_url(course_url)
    clean_title, identity_title = normalize_title(title)
    stable_id = str(moodle_course_id).strip() if moodle_course_id is not None else None
    if stable_id:
        if not stable_id.isdigit():
            raise ValueError("moodle_course_id must be numeric")
        course = db.scalar(select(Course).where(Course.moodle_course_id == stable_id))
        if course is None:
            course = db.scalar(select(Course).where(Course.normalized_url == url, Course.identity_title == identity_title))
            if course is not None:
                course.moodle_course_id = stable_id
                course.is_confirmed = True
                course.confirmed_at = utc_now()
            else:
                course = Course(moodle_course_id=stable_id, normalized_url=url, title=clean_title, identity_title=identity_title, is_confirmed=True, created_at=utc_now(), confirmed_at=utc_now())
                db.add(course)
            db.commit()
            db.refresh(course)
        return course
    course = db.scalar(select(Course).where(Course.normalized_url == url, Course.identity_title == identity_title))
    if course is None:
        course = Course(normalized_url=url, title=clean_title, identity_title=identity_title, is_confirmed=False, created_at=utc_now())
        db.add(course)
        db.commit()
        db.refresh(course)
    return course


def confirm_course(db: DbSession, source: Course, *, target_course_id=None, moodle_course_id: int | str | None = None, course_url: str | None = None, title: str | None = None) -> Course:
    if source.is_confirmed:
        raise ValueError("Only an unconfirmed temporary course can be confirmed or mapped")
    if target_course_id is not None:
        target = db.get(Course, target_course_id)
        if target is None:
            raise ValueError("target course not found")
    elif moodle_course_id is not None and course_url is not None and title is not None:
        target = resolve_course(db, moodle_course_id=moodle_course_id, course_url=course_url, title=title)
    else:
        raise ValueError("a target course or stable Moodle course identity is required")
    if target.id == source.id:
        if not target.is_confirmed:
            target.is_confirmed, target.confirmed_at = True, utc_now()
            db.commit()
        return target
    db.execute(update(Comment).where(Comment.course_id == source.id).values(course_id=target.id))
    db.execute(update(PageLocation).where(PageLocation.course_id == source.id).values(course_id=target.id))
    db.delete(source)
    db.commit()
    db.refresh(target)
    return target
