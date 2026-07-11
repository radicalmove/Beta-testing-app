import uuid
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.models import CommentStatus, PageLocation, User, UserRole
from app.services.comments import visible_comments_for


class SummaryAccessDenied(Exception):
    pass


def course_summary_for(db: DbSession, viewer, course_id: uuid.UUID) -> dict:
    if viewer.role not in {UserRole.LD_DCD, UserRole.ADMIN}:
        raise SummaryAccessDenied("LD/DCD or administrator access required")
    if getattr(viewer, "course_id", None) is not None and viewer.course_id != course_id:
        raise SummaryAccessDenied("LD/DCD or administrator access required")
    comments = visible_comments_for(db, viewer, course_id)
    locations = {row.id: row for row in db.scalars(select(PageLocation).where(PageLocation.id.in_([comment.location_id for comment in comments if comment.location_id])))} if comments else {}
    authors = {row.id: row for row in db.scalars(select(User).where(User.id.in_([comment.author_user_id for comment in comments])))} if comments else {}
    status_counts = Counter(comment.status.value for comment in comments)
    category_counts = Counter(comment.category.value for comment in comments)
    return {
        "total": len(comments),
        "statuses": {status.value: status_counts[status.value] for status in CommentStatus},
        "categories": dict(sorted(category_counts.items())),
        "comments": [
            {
                "id": str(comment.id),
                "body": comment.body,
                "status": comment.status.value,
                "category": comment.category.value,
                "page_title": locations[comment.location_id].page_title if comment.location_id in locations else "Unknown page",
                "page_url": locations[comment.location_id].page_url if comment.location_id in locations else "",
                "author": authors[comment.author_user_id].display_name,
                "author_role": comment.author_role.value,
                "updated_at": comment.updated_at.isoformat(),
            }
            for comment in comments
        ],
    }
