import uuid

from pydantic import BaseModel, Field, field_validator, model_validator


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


class CourseConfirmRequest(BaseModel):
    target_course_id: uuid.UUID | None = None
    course_url: str | None = Field(default=None, min_length=1, max_length=4096)
    title: str | None = Field(default=None, min_length=1, max_length=512)
    moodle_course_id: int | None = Field(default=None, ge=1)

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
    body: str = Field(min_length=1, max_length=10000)
    category: str
    selected_quote: str | None = Field(default=None, max_length=20000)
    prefix: str | None = Field(default=None, max_length=2000)
    suffix: str | None = Field(default=None, max_length=2000)
    css_selector: str | None = Field(default=None, max_length=4000)
    dom_selector: str | None = Field(default=None, max_length=4000)
    relative_x: float | None = Field(default=None, ge=0, le=1)
    relative_y: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def valid_anchor(self):
        if self.category not in {"content", "design", "assessment", "accessibility", "technical", "other"}:
            raise ValueError("Invalid comment category")
        if (self.relative_x is None) != (self.relative_y is None):
            raise ValueError("relative_x and relative_y must be supplied together")
        return self


class CommentStatusRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def known_status(cls, value: str) -> str:
        if value not in {"open", "in_progress", "awaiting_sme", "resolved", "deferred"}:
            raise ValueError("Invalid comment status")
        return value
