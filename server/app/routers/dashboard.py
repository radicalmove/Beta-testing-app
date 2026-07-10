import uuid
from collections import Counter, defaultdict
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from app.db import get_session
from app.dependencies import current_dashboard_user
from app.models import CommentCategory, CommentReadState, CommentReply, CommentStatus, CommentStatusEvent, Course, PageLocation, User, UserRole
from app.routers.auth import _form_with_csrf
from app.security import generate_token, utc_now
from app.services.comments import AuthorizationError, allowed_status_choices, create_reply, dashboard_comments_for, share_comment_with_user, update_comment_status, visible_comment_for
from app.services.courses import confirm_course

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
templates = Jinja2Templates(directory="app/templates")

def rendered(request, name, context):
    token = request.cookies.get("csrf_token") or generate_token()
    response = templates.TemplateResponse(request, name, {**context, "csrf_token": token})
    if request.cookies.get("csrf_token") != token: response.set_cookie("csrf_token", token, secure=True, samesite="lax")
    return response

def admin_redirect(user):
    return RedirectResponse("/admin/users", status_code=303) if user.role is UserRole.ADMIN else None

@router.get("", response_class=HTMLResponse)
def index(request: Request, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    if redirect := admin_redirect(user): return redirect
    query, cards, totals = request.query_params, [], Counter()
    projected = dashboard_comments_for(db, user)
    projected_by_course = defaultdict(list)
    for item in projected:
        projected_by_course[item.comment.course_id].append(item)
    for course in db.scalars(select(Course).order_by(Course.title)):
        rows = []
        for item in projected_by_course[course.id]:
            comment, location, unread = item.comment, item.location, item.unread
            if comment.course_id != course.id: continue
            totals[comment.status.value] += 1
            if query.get("page") and query["page"].lower() not in (location.page_title if location else "").lower(): continue
            if query.get("category") and query["category"] != comment.category.value: continue
            if query.get("author_role") and query["author_role"] != comment.author_role.value: continue
            if query.get("status") and query["status"] != comment.status.value: continue
            if query.get("unread") and not unread: continue
            rows.append({"comment": comment, "location": location, "author_display": item.author_display, "latest_reply_author": item.latest_reply_author, "unread": unread})
        if rows or (user.role is UserRole.LD_DCD and not course.is_confirmed): cards.append({"course": course, "rows": rows})
    confirmed_courses = list(db.scalars(select(Course).where(Course.is_confirmed.is_(True)).order_by(Course.title)))
    feedback = {
        "success": "Course mapping saved.",
        "invalid": "Choose a valid confirmed course or confirm this as a new course.",
        "not_found": "Course not found.",
        "already_confirmed": "This course is already confirmed.",
    }.get(query.get("reason") if query.get("mapping") == "error" else query.get("mapping"))
    return rendered(request, "dashboard/index.html", {"user": user, "cards": cards, "totals": totals, "statuses": list(CommentStatus), "categories": list(CommentCategory), "roles": [UserRole.BETA_TESTER, UserRole.SME, UserRole.LD_DCD], "filters": query, "confirmed_courses": confirmed_courses, "mapping_feedback": feedback, "mapping_feedback_kind": query.get("mapping")})


@router.post("/courses/{course_id}/confirm")
async def confirm_dashboard_course(request: Request, course_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    if user.role is not UserRole.LD_DCD:
        raise HTTPException(403, "LD/DCD access required")
    data = await _form_with_csrf(request)
    source = db.get(Course, course_id)
    if source is None:
        return RedirectResponse("/dashboard?mapping=error&reason=not_found", status_code=303)
    if source.is_confirmed:
        return RedirectResponse("/dashboard?mapping=error&reason=already_confirmed", status_code=303)
    choice = str(data.get("mapping_choice", ""))
    if choice == "new":
        target_id = source.id
    else:
        try:
            target_id = uuid.UUID(choice)
        except ValueError:
            return RedirectResponse("/dashboard?mapping=error&reason=invalid", status_code=303)
        target = db.get(Course, target_id)
        if target is None or not target.is_confirmed:
            return RedirectResponse("/dashboard?mapping=error&reason=invalid", status_code=303)
    try:
        confirm_course(db, source, target_course_id=target_id)
    except ValueError:
        return RedirectResponse("/dashboard?mapping=error&reason=invalid", status_code=303)
    return RedirectResponse("/dashboard?mapping=success", status_code=303)

@router.get("/threads/{comment_id}", response_class=HTMLResponse)
def thread(request: Request, comment_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    if redirect := admin_redirect(user): return redirect
    comment = visible_comment_for(db, user, comment_id)
    if comment is None: raise HTTPException(404, "Thread not found")
    state = db.get(CommentReadState, (user.id, comment.id))
    if state: state.read_at = utc_now()
    else: db.add(CommentReadState(user_id=user.id, comment_id=comment.id, read_at=utc_now()))
    db.commit()
    replies = list(db.scalars(select(CommentReply).where(CommentReply.comment_id == comment.id).order_by(CommentReply.created_at)))
    events = list(db.scalars(select(CommentStatusEvent).where(CommentStatusEvent.comment_id == comment.id).order_by(CommentStatusEvent.created_at)))
    actor_ids = {comment.author_user_id}
    actor_ids.update(reply.author_user_id for reply in replies)
    actor_ids.update(event.actor_user_id for event in events)
    people = dict(db.execute(select(User.id, User.email).where(User.id.in_(actor_ids))).all())
    location = db.get(PageLocation, comment.location_id) if comment.location_id else None
    smes = list(db.execute(select(User.id, User.email).where(User.role == UserRole.SME, User.approved_at.is_not(None)).order_by(User.email))) if user.role is UserRole.LD_DCD else []
    share_feedback = {
        "invalid_recipient": "Choose a valid SME account before sharing.",
        "not_sme": "Choose a valid SME account before sharing.",
    }.get(request.query_params.get("share_error"))
    status_choices = allowed_status_choices(comment.status)[1:]
    return rendered(request, "dashboard/thread.html", {"user": user, "comment": comment, "location": location, "replies": replies, "events": events, "people": people, "smes": smes, "status_choices": status_choices, "status_terminal": not bool(status_choices), "share_feedback": share_feedback})

@router.post("/threads/{comment_id}/reply")
async def reply(request: Request, comment_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    data = await _form_with_csrf(request); comment = visible_comment_for(db, user, comment_id)
    if comment is None: raise HTTPException(404, "Thread not found")
    try: create_reply(db, user, comment, str(data.get("body", "")))
    except (AuthorizationError, ValueError) as exc: raise HTTPException(403 if isinstance(exc, AuthorizationError) else 422, str(exc))
    return RedirectResponse(f"/dashboard/threads/{comment_id}#replies", status_code=303)

@router.post("/threads/{comment_id}/status")
async def status(request: Request, comment_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    data = await _form_with_csrf(request); comment = visible_comment_for(db, user, comment_id)
    if comment is None: raise HTTPException(404, "Thread not found")
    try: update_comment_status(db, user, comment, str(data.get("status", "")))
    except AuthorizationError as exc: raise HTTPException(403, str(exc))
    except ValueError as exc: raise HTTPException(422, str(exc))
    return RedirectResponse(f"/dashboard/threads/{comment_id}?changed=1", status_code=303)

@router.post("/threads/{comment_id}/share")
async def share(request: Request, comment_id: uuid.UUID, user: User = Depends(current_dashboard_user), db: DbSession = Depends(get_session)):
    data = await _form_with_csrf(request); comment = visible_comment_for(db, user, comment_id)
    if comment is None: raise HTTPException(404, "Thread not found")
    if user.role is not UserRole.LD_DCD: raise HTTPException(403, "Only an LD/DCD can share a thread")
    try:
        recipient_id = uuid.UUID(str(data.get("user_id", "")))
    except (TypeError, ValueError):
        return RedirectResponse(f"/dashboard/threads/{comment_id}?share_error=invalid_recipient", status_code=303)
    recipient = db.get(User, recipient_id)
    if recipient is None:
        return RedirectResponse(f"/dashboard/threads/{comment_id}?share_error=invalid_recipient", status_code=303)
    try: share_comment_with_user(db, user, comment, recipient)
    except AuthorizationError as exc: raise HTTPException(403, str(exc))
    except ValueError:
        return RedirectResponse(f"/dashboard/threads/{comment_id}?share_error=not_sme", status_code=303)
    return RedirectResponse(f"/dashboard/threads/{comment_id}", status_code=303)
