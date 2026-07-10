import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DbSession

from app.config import Settings, get_settings
from app.db import get_session
from app.dependencies import current_api_user
from app.models import Attachment, User, UserRole
from app.services.attachments import AttachmentTooLargeError, UnsupportedAttachmentError, attachment_path, store_attachment, visible_attachment_comment_for
from app.services.comments import visible_comment_for


router = APIRouter(tags=["attachments"])


def _attachment_json(attachment: Attachment) -> dict[str, str | int]:
    return {
        "id": str(attachment.id),
        "comment_id": str(attachment.comment_id),
        "filename": attachment.original_filename,
        "media_type": attachment.media_type,
        "size_bytes": attachment.size_bytes,
        "download_url": f"/api/attachments/{attachment.id}",
    }


@router.post("/api/comments/{comment_id}/attachments", status_code=status.HTTP_201_CREATED)
def upload_attachment(comment_id: uuid.UUID, file: UploadFile = File(...), user: User = Depends(current_api_user), db: DbSession = Depends(get_session), settings: Settings = Depends(get_settings)) -> dict[str, str | int]:
    comment = visible_comment_for(db, user, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if user.id != comment.author_user_id and user.role is not UserRole.LD_DCD:
        raise HTTPException(status_code=403, detail="Only the comment author or an LD/DCD can attach a screenshot")
    try:
        attachment = store_attachment(db, user, comment, file, storage_dir=settings.attachment_storage_dir, max_bytes=settings.attachment_max_bytes)
        return _attachment_json(attachment)
    except UnsupportedAttachmentError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except AttachmentTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


@router.get("/api/attachments/{attachment_id}", response_class=FileResponse)
def download_attachment(attachment_id: uuid.UUID, user: User = Depends(current_api_user), db: DbSession = Depends(get_session), settings: Settings = Depends(get_settings)) -> FileResponse:
    attachment = db.get(Attachment, attachment_id)
    if attachment is None or visible_attachment_comment_for(db, user, attachment.comment_id) is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    path = attachment_path(attachment, settings.attachment_storage_dir)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(path, media_type=attachment.media_type, filename=attachment.original_filename)
