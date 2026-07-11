from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError
from sqlalchemy.orm import Session as DbSession

from app.config import get_settings
from app.db import get_session
from app.dependencies import current_dashboard_user
from app.models import User, UserRole
from app.schemas import ExtensionTokenRequest, RegistrationRequest
from app.security import dashboard_cookie_settings, generate_token
from app.services.accounts import (
    AccountNotApprovedError,
    AuthenticationError,
    AccountAlreadyExistsError,
    authenticate_account,
    create_dashboard_session,
    create_extension_login_code,
    exchange_extension_login_code,
    register_account,
    revoke_session,
)

router = APIRouter()
templates = Jinja2Templates(directory="app/templates")


def extension_redirect_uris() -> set[str]:
    return {uri.strip() for uri in get_settings().extension_redirect_uris.split(",") if uri.strip()}


def _validated_login_continuation(value: str | None) -> str | None:
    if not value:
        return None
    parts = urlsplit(value)
    query = parse_qsl(parts.query, keep_blank_values=True)
    if (
        parts.scheme
        or parts.netloc
        or parts.path != "/extension/authorize"
        or parts.fragment
        or len(query) != 1
        or query[0][0] != "redirect_uri"
        or query[0][1] not in extension_redirect_uris()
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid login continuation")
    return f"/extension/authorize?{urlencode(query)}"


def _csrf_response(request: Request, name: str, context: dict | None = None) -> HTMLResponse:
    token = request.cookies.get("csrf_token") or generate_token()
    response = templates.TemplateResponse(request, name, {"csrf_token": token, **(context or {})})
    if request.cookies.get("csrf_token") != token:
        response.set_cookie("csrf_token", token, secure=True, samesite="lax")
    return response


async def _form_with_csrf(request: Request) -> dict[str, str]:
    form = await request.form()
    token = str(form.get("csrf_token", ""))
    if not token or token != request.cookies.get("csrf_token"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    return {key: str(value) for key, value in form.items()}


def _generic_login_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")


@router.get("/register", response_class=HTMLResponse)
def register_page(request: Request) -> HTMLResponse:
    return _csrf_response(request, "auth/register.html")


@router.post("/register")
async def register_form(request: Request, db: DbSession = Depends(get_session)) -> RedirectResponse:
    data = await _form_with_csrf(request)
    try:
        payload = RegistrationRequest.model_validate(data)
        user = register_account(db, email=payload.email, password=payload.password, display_name=payload.display_name)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid registration details") from exc
    except AccountAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return RedirectResponse("/login?registered=1", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register_json(payload: RegistrationRequest, db: DbSession = Depends(get_session)) -> dict[str, str]:
    try:
        user = register_account(db, email=payload.email, password=payload.password, display_name=payload.display_name)
    except AccountAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "pending" if user.approved_at is None else "approved"}


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, next: str | None = None) -> HTMLResponse:
    return _csrf_response(request, "auth/login.html", {"next": _validated_login_continuation(next)})


def _login(db: DbSession, email: str, password: str) -> str:
    try:
        user = authenticate_account(db, email=email, password=password)
        return create_dashboard_session(db, user)
    except (AuthenticationError, AccountNotApprovedError) as exc:
        raise _generic_login_error() from exc


def _login_response(token: str, response: Response) -> Response:
    settings = get_settings()
    response.set_cookie(**dashboard_cookie_settings(token, settings.dashboard_session_hours * 3600))
    return response


@router.post("/login")
async def login_form(request: Request, db: DbSession = Depends(get_session)) -> RedirectResponse:
    data = await _form_with_csrf(request)
    continuation = _validated_login_continuation(data.get("next"))
    token = _login(db, data.get("email", ""), data.get("password", ""))
    return _login_response(token, RedirectResponse(continuation or "/", status_code=status.HTTP_303_SEE_OTHER))


@router.post("/auth/login")
async def login_json(request: Request, db: DbSession = Depends(get_session)) -> Response:
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    email = payload.get("email", "") if isinstance(payload, dict) else ""
    password = payload.get("password", "") if isinstance(payload, dict) else ""
    if not isinstance(email, str) or not isinstance(password, str):
        raise _generic_login_error()
    return _login_response(_login(db, email, password), JSONResponse({"status": "ok"}))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: DbSession = Depends(get_session)) -> Response:
    if request.url.path == "/logout" or request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
        await _form_with_csrf(request)
    token = request.cookies.get("dashboard_session")
    if token:
        revoke_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("dashboard_session", secure=True, samesite="lax")
    return response


@router.get("/extension/authorize")
def extension_authorize(
    request: Request,
    redirect_uri: str,
    db: DbSession = Depends(get_session),
) -> RedirectResponse:
    if redirect_uri not in extension_redirect_uris():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unapproved redirect URI")
    try:
        from app.services.accounts import verify_dashboard_session

        user = verify_dashboard_session(db, request.cookies.get("dashboard_session", ""))
    except AuthenticationError:
        continuation = f"/extension/authorize?{urlencode({'redirect_uri': redirect_uri})}"
        return RedirectResponse(f"/login?{urlencode({'next': continuation})}", status_code=status.HTTP_303_SEE_OTHER)
    code = create_extension_login_code(db, user, redirect_uri)
    parts = urlsplit(redirect_uri)
    query = urlencode([*parse_qsl(parts.query, keep_blank_values=True), ("code", code)])
    return RedirectResponse(urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment)), status_code=303)


@router.post("/extension/token")
def extension_token(payload: ExtensionTokenRequest, db: DbSession = Depends(get_session)) -> dict[str, str]:
    if payload.redirect_uri not in extension_redirect_uris():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unapproved redirect URI")
    try:
        token = exchange_extension_login_code(db, payload.code, payload.redirect_uri)
    except AuthenticationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid extension authorization code") from exc
    return {"access_token": token, "token_type": "Bearer"}
