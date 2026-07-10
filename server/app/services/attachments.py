import os
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session as DbSession

from app.models import Attachment, Comment, User, UserRole
from app.security import utc_now
from app.services.comments import visible_comment_for


class UnsupportedAttachmentError(Exception):
    pass


class AttachmentTooLargeError(Exception):
    pass


_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg"}


def visible_attachment_comment_for(db: DbSession, user: User, comment_id: uuid.UUID) -> Comment | None:
    """Apply thread visibility without the comment-only administrator bypass."""
    if user.role is UserRole.ADMIN:
        return None
    return visible_comment_for(db, user, comment_id)


def _sniff_media_type(header: bytes) -> str | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


async def store_attachment(db: DbSession, uploader: User, comment: Comment, upload: UploadFile, *, storage_dir: str, max_bytes: int) -> Attachment:
    claimed_type = (upload.content_type or "").lower()
    if claimed_type not in _EXTENSIONS:
        raise UnsupportedAttachmentError("Only PNG and JPEG screenshots are supported")
    if max_bytes < 1:
        raise ValueError("attachment_max_bytes must be positive")

    content = bytearray()
    while chunk := await upload.read(min(64 * 1024, max_bytes + 1 - len(content))):
        content.extend(chunk)
        if len(content) > max_bytes:
            raise AttachmentTooLargeError(f"Attachment exceeds the {max_bytes}-byte limit")
    detected_type = _sniff_media_type(content)
    if detected_type is None or detected_type != claimed_type:
        raise UnsupportedAttachmentError("File contents do not match the declared PNG or JPEG type")

    directory = Path(storage_dir).expanduser().resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    object_name = f"{uuid.uuid4().hex}{_EXTENSIONS[detected_type]}"
    final_path = directory / object_name
    temporary_path = directory / f".{uuid.uuid4().hex}.upload"
    fd = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(content)
            target.flush()
            os.fsync(target.fileno())
        # Hard-link publication is atomic and refuses to overwrite even in the
        # extraordinarily unlikely event of an object-name collision.
        os.link(temporary_path, final_path)
        temporary_path.unlink()
        attachment = Attachment(
            comment_id=comment.id,
            uploader_user_id=uploader.id,
            original_filename=Path(upload.filename or "screenshot").name[:255] or "screenshot",
            object_name=object_name,
            media_type=detected_type,
            size_bytes=len(content),
            created_at=utc_now(),
        )
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
        return attachment
    except Exception:
        db.rollback()
        temporary_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise


def attachment_path(attachment: Attachment, storage_dir: str) -> Path:
    directory = Path(storage_dir).expanduser().resolve()
    path = (directory / attachment.object_name).resolve()
    if path.parent != directory:
        raise FileNotFoundError("Invalid attachment object name")
    return path
