#!/usr/bin/env python3
"""Provision the CRJU150 pilot course and one-time fake reviewer invitations."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, UserRole
from app.services.access import create_invitation
from app.services.courses import resolve_course


PILOT_REVIEWERS = (
    ("beta.one@example.test", UserRole.BETA_TESTER),
    ("beta.two@example.test", UserRole.BETA_TESTER),
    ("sme.pilot@example.test", UserRole.SME),
    ("ld.pilot@example.test", UserRole.LD_DCD),
)


def main() -> None:
    with SessionLocal() as db:
        admin = db.scalar(select(User).where(User.role == UserRole.ADMIN, User.approved_at.is_not(None)))
        if admin is None:
            raise SystemExit("approved administrator not found")
        course = resolve_course(
            db,
            moodle_course_id=896,
            course_url="https://my.uconline.ac.nz/course/view.php?id=896",
            title="CRJU150 – Legal Method in the Criminal Justice Context – MAIN COPY",
        )
        print(f"COURSE_HANDLE={course.id}")
        for email, role in PILOT_REVIEWERS:
            _, raw = create_invitation(db, admin, course, email, role)
            print(f"{email}\t{role.value}\t{raw}")


if __name__ == "__main__":
    main()
