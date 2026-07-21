import os
import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session as DbSession

from app.models import Attachment, Comment, User
from app.security import utc_now
from app.services.comments import visible_comment_for


class UnsupportedAttachmentError(Exception):
    pass


class AttachmentTooLargeError(Exception):
    pass


_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "application/pdf": ".pdf", "application/msword": ".doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx"}
_CHUNK_SIZE = 64 * 1024
_SIGNATURE_BYTES = 8


def visible_attachment_comment_for(db: DbSession, user: User, comment_id: uuid.UUID) -> Comment | None:
    """Apply the same role-aware visibility used by the comment thread."""
    return visible_comment_for(db, user, comment_id)


def _sniff_media_type(header: bytes) -> str | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if header.startswith(b"%PDF-"):
        return "application/pdf"
    if header.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "application/msword"
    if header.startswith(b"PK\x03\x04"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return None


def _new_object_name(media_type: str) -> str:
    return f"{uuid.uuid4().hex}{_EXTENSIONS[media_type]}"


def store_attachment(db: DbSession, uploader: User, comment: Comment, upload: UploadFile, *, storage_dir: str, max_bytes: int) -> Attachment:
    claimed_type = (upload.content_type or "").lower()
    if claimed_type not in _EXTENSIONS:
        raise UnsupportedAttachmentError("Only PDF, Word, PNG and JPEG files are supported")
    if max_bytes < 1:
        raise ValueError("attachment_max_bytes must be positive")

    directory = Path(storage_dir).expanduser().resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary_path = directory / f".{uuid.uuid4().hex}.upload"
    fd = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    final_path: Path | None = None
    published_by_this_call = False
    try:
        size_bytes = 0
        header = bytearray()
        with os.fdopen(fd, "wb") as target:
            while chunk := upload.file.read(_CHUNK_SIZE):
                size_bytes += len(chunk)
                if size_bytes > max_bytes:
                    raise AttachmentTooLargeError(f"Attachment exceeds the {max_bytes}-byte limit")
                if len(header) < _SIGNATURE_BYTES:
                    header.extend(chunk[: _SIGNATURE_BYTES - len(header)])
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())

        detected_type = _sniff_media_type(header)
        if detected_type is None or detected_type != claimed_type:
            raise UnsupportedAttachmentError("File contents do not match the declared file type")

        # Hard-link publication is atomic and refuses to overwrite. Generate a
        # fresh object name on collision so cleanup can never touch that object.
        while not published_by_this_call:
            object_name = _new_object_name(detected_type)
            candidate_path = directory / object_name
            try:
                os.link(temporary_path, candidate_path)
            except FileExistsError:
                continue
            final_path = candidate_path
            published_by_this_call = True
        temporary_path.unlink()
        attachment = Attachment(
            comment_id=comment.id,
            uploader_user_id=uploader.id,
            original_filename=Path(upload.filename or "screenshot").name[:255] or "screenshot",
            object_name=object_name,
            media_type=detected_type,
            size_bytes=size_bytes,
            created_at=utc_now(),
        )
        db.add(attachment)
        db.commit()
        db.refresh(attachment)
        return attachment
    except Exception:
        db.rollback()
        temporary_path.unlink(missing_ok=True)
        if published_by_this_call and final_path is not None:
            final_path.unlink(missing_ok=True)
        raise


def attachment_path(attachment: Attachment, storage_dir: str) -> Path:
    directory = Path(storage_dir).expanduser().resolve()
    path = (directory / attachment.object_name).resolve()
    if path.parent != directory:
        raise FileNotFoundError("Invalid attachment object name")
    return path


def delete_attachment_objects(object_names: tuple[str, ...], storage_dir: str) -> None:
    directory = Path(storage_dir).expanduser().resolve()
    for object_name in object_names:
        path = (directory / object_name).resolve()
        if path.parent == directory:
            path.unlink(missing_ok=True)
