import uuid
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator

from app.url_validation import canonical_https_url


def _absolute_http_url(value: str, field_name: str) -> str:
    if value != value.strip():
        raise ValueError(f"{field_name} must not contain leading or trailing whitespace")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be an absolute http or https URL")
    return value


class RegistrationRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("email")
    @classmethod
    def email_has_at_sign(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Invalid email address")
        return value

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Display name is required")
        return value


class ExtensionTokenRequest(BaseModel):
    code: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)


class RoleChangeRequest(BaseModel):
    role: str


class CourseLookupRequest(BaseModel):
    moodle_origin: str = Field(min_length=1, max_length=255)
    moodle_course_id: int = Field(ge=1)

    @field_validator("moodle_origin")
    @classmethod
    def origin_is_http_origin(cls, value: str) -> str:
        parsed = urlsplit(value.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
            raise ValueError("moodle_origin must be an http or https origin")
        return f"{parsed.scheme}://{parsed.netloc}".lower()


class InvitationCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: str


class InvitationRedeemRequest(BaseModel):
    course_handle: uuid.UUID
    display_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=3, max_length=320)
    role: str
    invitation_code: str = Field(min_length=20, max_length=32)


class MembershipResumeRequest(BaseModel):
    course_handle: uuid.UUID
    email: str = Field(min_length=3, max_length=320)
    reconnect_code: str = Field(min_length=20, max_length=32)


class DeviceRenewRequest(BaseModel):
    course_handle: uuid.UUID
    device_credential: str = Field(min_length=32, max_length=256)


class CourseReviewerListRequest(BaseModel):
    course_handle: uuid.UUID


class ExistingReviewerSignInRequest(BaseModel):
    course_handle: uuid.UUID
    membership_id: uuid.UUID


class MembershipStateRequest(BaseModel):
    state: str


class CourseResolveRequest(BaseModel):
    course_url: str = Field(min_length=1, max_length=4096)
    title: str = Field(min_length=1, max_length=512)
    moodle_course_id: int | None = Field(default=None, ge=1)

    @field_validator("course_url")
    @classmethod
    def course_url_is_http_url(cls, value: str) -> str:
        return _absolute_http_url(value, "course_url")


class CourseConfirmRequest(BaseModel):
    target_course_id: uuid.UUID | None = None
    course_url: str | None = Field(default=None, min_length=1, max_length=4096)
    title: str | None = Field(default=None, min_length=1, max_length=512)
    moodle_course_id: int | None = Field(default=None, ge=1)

    @field_validator("course_url")
    @classmethod
    def course_url_is_http_url(cls, value: str | None) -> str | None:
        return None if value is None else _absolute_http_url(value, "course_url")

    @model_validator(mode="after")
    def has_one_resolution(self):
        mapped = self.target_course_id is not None
        stable = self.moodle_course_id is not None and self.course_url is not None and self.title is not None
        if mapped == stable:
            raise ValueError("provide target_course_id or a full stable Moodle identity")
        return self


class CommentCreateRequest(BaseModel):
    course_id: uuid.UUID
    page_url: str = Field(min_length=1, max_length=4096)
    page_title: str = Field(min_length=1, max_length=512)
    body: str = Field(min_length=1, max_length=10000)
    category: str = "general"
    anchor_type: str
    selected_quote: str | None = Field(default=None, max_length=20000)
    prefix: str | None = Field(default=None, max_length=2000)
    suffix: str | None = Field(default=None, max_length=2000)
    css_selector: str | None = Field(default=None, max_length=4000)
    dom_selector: str | None = Field(default=None, max_length=4000)
    relative_x: float | None = Field(default=None, ge=0, le=1)
    relative_y: float | None = Field(default=None, ge=0, le=1)
    parent_activity_url: str | None = Field(default=None, min_length=1, max_length=4096)
    embedded_locator: str | None = Field(default=None, min_length=1, max_length=2048)

    @field_validator("page_url")
    @classmethod
    def page_url_is_http_url(cls, value: str) -> str:
        return _absolute_http_url(value, "page_url")

    @field_validator("parent_activity_url")
    @classmethod
    def parent_activity_is_https_moodle_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return canonical_https_url(value, "parent_activity_url", max_length=4096)

    @field_validator("embedded_locator")
    @classmethod
    def embedded_locator_is_safe_rise_route(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value != value.strip() or any(ord(character) <= 32 or ord(character) == 127 or character == "\\" for character in value):
            raise ValueError("embedded_locator contains unsafe characters")
        if (not value.startswith(("#", "/"))) or value.startswith("//"):
            raise ValueError("embedded_locator must be a Rise hash or root-relative route")
        return value

    @model_validator(mode="after")
    def valid_anchor(self):
        if not self.page_title.strip():
            raise ValueError("page_title is required")
        if self.category not in {"language_grammar", "learning_design_content_flow", "accessibility", "technical_link_media_interaction", "assessment", "general"}:
            raise ValueError("Invalid comment category")
        if self.anchor_type not in {"text_highlight", "visual_pin"}:
            raise ValueError("Invalid anchor type")
        if (self.relative_x is None) != (self.relative_y is None):
            raise ValueError("relative_x and relative_y must be supplied together")
        if (self.parent_activity_url is None) != (self.embedded_locator is None):
            raise ValueError("parent_activity_url and embedded_locator must be supplied together")
        quote = self.selected_quote and self.selected_quote.strip()
        selector = (self.css_selector and self.css_selector.strip()) or (self.dom_selector and self.dom_selector.strip())
        context = (self.prefix and self.prefix.strip()) or (self.suffix and self.suffix.strip())
        if self.anchor_type == "text_highlight" and (not quote or not (context or selector)):
            raise ValueError("text_highlight requires a selected_quote and context or selector")
        if self.anchor_type == "visual_pin" and (not selector or self.relative_x is None or self.relative_y is None):
            raise ValueError("visual_pin requires a selector and paired coordinates")
        return self


class CommentStatusRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def known_status(cls, value: str) -> str:
        if value not in {"open", "in_progress", "awaiting_sme", "resolved", "deferred"}:
            raise ValueError("Invalid comment status")
        return value


class CommentUpdateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10000)

    @field_validator("body")
    @classmethod
    def body_is_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("body is required")
        return value


class CommentSmeRecipientsRequest(BaseModel):
    user_ids: list[uuid.UUID] = Field(max_length=50)

    @field_validator("user_ids")
    @classmethod
    def recipient_ids_are_unique(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise ValueError("user_ids must be unique")
        return value


class CommentReplyRequest(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class CommentShareRequest(BaseModel):
    user_id: uuid.UUID
