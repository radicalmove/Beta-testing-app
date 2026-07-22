import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_session
from app.dependencies import current_dashboard_user, current_extension_user, require_course_access
from app.models import AuditEvent, Course, CourseMembership, MembershipState, User, UserRole
from app.schemas import CourseLookupRequest, CourseReviewerListRequest, DeviceRenewRequest, ExistingReviewerSignInRequest, InvitationCreateRequest, InvitationRedeemRequest, MembershipResumeRequest, MembershipStateRequest
from app.security import utc_now
from app.services.access import AccessDenied, create_invitation, find_approved_reviewer, list_approved_reviewers, redeem_invitation, renew_device, resume_membership, sign_in_existing_reviewer

router = APIRouter(tags=["course access"])

ROLE_LABELS = {
    UserRole.BETA_TESTER: "Beta tester",
    UserRole.SME: "Subject matter expert",
    UserRole.LD_DCD: "Learning designer / course developer",
    UserRole.ADMIN: "Administrator",
}


def _access_json(result) -> dict:
    return {
        "state": result.membership.state.value,
        "role": result.membership.role.value,
        "session_token": result.session_token,
        "expires_in": 28800 if result.session_token else None,
        "device_credential": result.device_credential,
        "reconnect_code": result.reconnect_code or None,
    }


@router.post("/api/access/course")
def lookup_course(payload: CourseLookupRequest, db: DbSession = Depends(get_session)) -> dict:
    course = db.scalar(select(Course).where(Course.moodle_origin == payload.moodle_origin, Course.moodle_course_id == str(payload.moodle_course_id), Course.is_confirmed.is_(True)))
    if course is None:
        raise HTTPException(status_code=404, detail="Course not enabled for review")
    return {"course_handle": str(course.id), "title": course.title}


@router.post("/api/access/reviewers")
def approved_reviewers(payload: CourseReviewerListRequest, db: DbSession = Depends(get_session)) -> dict:
    try:
        if payload.email is None:
            reviewers = list_approved_reviewers(db, course_id=payload.course_handle)
            return {"reviewers": [
                {"membership_id": str(membership.id), "label": f"{reviewer.display_name} · {ROLE_LABELS[membership.role]}"}
                for membership, reviewer in reviewers
            ]}
        result = find_approved_reviewer(db, course_id=payload.course_handle, email=payload.email)
    except AccessDenied as exc:
        raise HTTPException(status_code=404, detail="Course not enabled for review") from exc
    if result is None:
        return {"reviewer": None}
    membership, reviewer = result
    return {"reviewer": {"membership_id": str(membership.id), "label": f"{reviewer.display_name} · {ROLE_LABELS[membership.role]}"}}


@router.post("/api/access/reviewers/sign-in")
def sign_in_existing(payload: ExistingReviewerSignInRequest, db: DbSession = Depends(get_session)) -> dict:
    try:
        return _access_json(sign_in_existing_reviewer(db, course_id=payload.course_handle, membership_id=payload.membership_id))
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail="Unable to verify reviewer access") from exc


@router.post("/api/access/redeem")
def redeem(payload: InvitationRedeemRequest, db: DbSession = Depends(get_session)) -> dict:
    try:
        role = UserRole(payload.role)
        return _access_json(redeem_invitation(db, course_id=payload.course_handle, display_name=payload.display_name, email=payload.email, role=role, invitation_code=payload.invitation_code))
    except (AccessDenied, ValueError) as exc:
        raise HTTPException(status_code=403, detail="Unable to verify reviewer access") from exc


@router.post("/api/access/resume")
def resume(payload: MembershipResumeRequest, db: DbSession = Depends(get_session)) -> dict:
    try:
        return _access_json(resume_membership(db, course_id=payload.course_handle, email=payload.email, reconnect_code=payload.reconnect_code))
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail="Unable to verify reviewer access") from exc


@router.post("/api/access/renew")
def renew(payload: DeviceRenewRequest, db: DbSession = Depends(get_session)) -> dict:
    try:
        return _access_json(renew_device(db, course_id=payload.course_handle, device_credential=payload.device_credential))
    except AccessDenied as exc:
        raise HTTPException(status_code=403, detail="Unable to verify reviewer access") from exc


@router.post("/api/access/courses/{course_id}/invitations", status_code=status.HTTP_201_CREATED)
def invite(course_id: uuid.UUID, payload: InvitationCreateRequest, actor=Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict:
    require_course_access(actor, course_id)
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    try:
        invitation, raw = create_invitation(db, actor, course, payload.email, UserRole(payload.role))
    except (AccessDenied, ValueError) as exc:
        raise HTTPException(status_code=403, detail="Invitation access denied") from exc
    return {"id": str(invitation.id), "invitation_code": raw, "expires_at": invitation.expires_at.isoformat()}


@router.post("/api/access/memberships/{membership_id}/state")
def membership_state(membership_id: uuid.UUID, payload: MembershipStateRequest, actor=Depends(current_extension_user), db: DbSession = Depends(get_session)) -> dict:
    membership = db.get(CourseMembership, membership_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    require_course_access(actor, membership.course_id)
    try:
        new_state = MembershipState(payload.state)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid membership state") from exc
    if actor.role is not UserRole.ADMIN and not (actor.role is UserRole.LD_DCD and membership.role is UserRole.SME):
        raise HTTPException(status_code=403, detail="Membership approval denied")
    if new_state not in {MembershipState.APPROVED, MembershipState.REJECTED, MembershipState.REVOKED}:
        raise HTTPException(status_code=422, detail="Invalid membership state")
    membership.state = new_state
    membership.updated_at = utc_now()
    membership.approved_by_user_id = actor.id if new_state is MembershipState.APPROVED else None
    membership.approved_at = utc_now() if new_state is MembershipState.APPROVED else None
    db.add(AuditEvent(actor_user_id=actor.id, action=f"membership.{new_state.value}", entity_type="course_membership", entity_id=str(membership.id), details=None, created_at=utc_now()))
    db.commit()
    return {"id": str(membership.id), "state": membership.state.value}
