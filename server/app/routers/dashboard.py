import uuid
from collections import Counter
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
from app.services.comments import AuthorizationError, create_reply, share_comment_with_user, update_comment_status, visible_comment_for, visible_comments_for

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
    for course in db.scalars(select(Course).order_by(Course.title)):
        rows = []
        for comment in visible_comments_for(db, user, course.id):
            location = db.get(PageLocation, comment.location_id) if comment.location_id else None
            replies = list(db.scalars(select(CommentReply).where(CommentReply.comment_id == comment.id).order_by(CommentReply.created_at)))
            state = db.get(CommentReadState, (user.id, comment.id)); latest = replies[-1].created_at if replies else comment.updated_at
            unread = state is None or latest > state.read_at
            totals[comment.status.value] += 1
            if query.get("page") and query["page"].lower() not in (location.page_title if location else "").lower(): continue
            if query.get("category") and query["category"] != comment.category.value: continue
            if query.get("author_role") and query["author_role"] != comment.author_role.value: continue
            if query.get("status") and query["status"] != comment.status.value: continue
            if query.get("unread") and not unread: continue
            rows.append({"comment": comment, "location": location, "author": db.get(User, comment.author_user_id), "unread": unread})
        if rows or (user.role is UserRole.LD_DCD and not course.is_confirmed): cards.append({"course": course, "rows": rows})
    return rendered(request, "dashboard/index.html", {"user": user, "cards": cards, "totals": totals, "statuses": list(CommentStatus), "categories": list(CommentCategory), "roles": [UserRole.BETA_TESTER, UserRole.SME, UserRole.LD_DCD], "filters": query})

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
    people = {person.id: person for person in db.scalars(select(User))}
    location = db.get(PageLocation, comment.location_id) if comment.location_id else None
    smes = list(db.scalars(select(User).where(User.role == UserRole.SME, User.approved_at.is_not(None)).order_by(User.email))) if user.role is UserRole.LD_DCD else []
    return rendered(request, "dashboard/thread.html", {"user": user, "comment": comment, "location": location, "replies": replies, "events": events, "people": people, "smes": smes, "statuses": list(CommentStatus)})

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
    recipient = db.get(User, uuid.UUID(str(data.get("user_id")))) if data.get("user_id") else None
    if comment is None or recipient is None: raise HTTPException(404, "Thread or user not found")
    try: share_comment_with_user(db, user, comment, recipient)
    except AuthorizationError as exc: raise HTTPException(403, str(exc))
    return RedirectResponse(f"/dashboard/threads/{comment_id}", status_code=303)
