import uuid
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator, model_validator


def _absolute_http_url(value: str, field_name: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{field_name} must be an absolute http or https URL")
    return value


class RegistrationRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("email")
    @classmethod
    def email_has_at_sign(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("Invalid email address")
        return value


class ExtensionTokenRequest(BaseModel):
    code: str = Field(min_length=1)
    redirect_uri: str = Field(min_length=1)


class RoleChangeRequest(BaseModel):
    role: str


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

    @field_validator("page_url")
    @classmethod
    def page_url_is_http_url(cls, value: str) -> str:
        return _absolute_http_url(value, "page_url")

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
