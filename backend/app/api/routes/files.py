from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.auth import UserContext, get_current_user
from app.api.dependencies import get_services

router = APIRouter(prefix="/files", tags=["files"])


class PresignUploadRequest(BaseModel):
    thread_id: str
    filename: str = Field(min_length=1, max_length=512)
    content_type: str = Field(min_length=1, max_length=200)
    size: int = Field(gt=0)
    purpose: Literal["upload", "artifact"] = "upload"


class CompleteUploadRequest(BaseModel):
    thread_id: str
    object_key: str = Field(min_length=1)
    original_filename: str = Field(min_length=1, max_length=512)
    content_type: str = Field(min_length=1, max_length=200)
    size: int = Field(gt=0)
    purpose: Literal["upload", "artifact"] = "upload"


class PresignDownloadRequest(BaseModel):
    thread_id: str
    file_id: str | None = None
    object_key: str | None = None


@router.post("/presign-upload")
async def presign_upload(
    payload: PresignUploadRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        return services.file_service.create_upload_ticket(
            actor_user_id=user.user_id,
            actor_role=user.role,
            thread_id=payload.thread_id,
            filename=payload.filename,
            content_type=payload.content_type,
            size=payload.size,
            purpose=payload.purpose,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/complete-upload", status_code=status.HTTP_201_CREATED)
async def complete_upload(
    payload: CompleteUploadRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        return services.file_service.complete_upload(
            actor_user_id=user.user_id,
            actor_role=user.role,
            thread_id=payload.thread_id,
            object_key=payload.object_key,
            original_filename=payload.original_filename,
            content_type=payload.content_type,
            size=payload.size,
            purpose=payload.purpose,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/presign-download")
async def presign_download(
    payload: PresignDownloadRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        return services.file_service.create_download_ticket(
            actor_user_id=user.user_id,
            actor_role=user.role,
            thread_id=payload.thread_id,
            file_id=payload.file_id,
            object_key=payload.object_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
