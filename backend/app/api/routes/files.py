from typing import Annotated, Literal
from tempfile import SpooledTemporaryFile
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
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
    file_id: str = Field(min_length=1)


class PresignDownloadRequest(BaseModel):
    thread_id: str
    file_id: str = Field(min_length=1)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_file(
    request: Request,
    user: Annotated[UserContext, Depends(get_current_user)],
    thread_id: Annotated[str, Query(min_length=1)],
    filename: Annotated[str, Query(min_length=1, max_length=512)],
    purpose: Annotated[Literal["upload", "artifact"], Query()] = "upload",
):
    services = get_services()
    content_type = request.headers.get("content-type", "application/octet-stream")
    with SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as spool:
        content_length = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            content_length += len(chunk)
            spool.write(chunk)
        spool.seek(0)

        try:
            return services.file_service.upload_file_stream(
                actor_user_id=user.user_id,
                actor_role=user.role,
                thread_id=thread_id,
                filename=filename,
                content_type=content_type,
                content_length=content_length,
                content_stream=spool,
                purpose=purpose,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


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
            file_id=payload.file_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc


@router.post("/presign-download")
async def presign_download(
    payload: PresignDownloadRequest,
    request: Request,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        file_record = services.file_service.get_file_for_actor(
            actor_user_id=user.user_id,
            actor_role=user.role,
            thread_id=payload.thread_id,
            file_id=payload.file_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return {
        "thread_id": payload.thread_id,
        "file_id": payload.file_id,
        "object_key": None,
        "url": str(
            request.url_for(
                "get_file_content", thread_id=payload.thread_id, file_id=payload.file_id
            )
        ),
        "required_headers": {},
        "expires_at": file_record["created_at"],
    }


@router.get("/{thread_id}/{file_id}")
async def get_file_content(
    thread_id: str,
    file_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        filename, content_type, content = (
            services.file_service.get_file_content_for_actor(
                actor_user_id=user.user_id,
                actor_role=user.role,
                thread_id=thread_id,
                file_id=file_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": _build_content_disposition(
                disposition="inline",
                filename=filename,
            ),
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{thread_id}/{file_id}/download")
async def download_file(
    thread_id: str,
    file_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        filename, content_type, content = (
            services.file_service.get_file_content_for_actor(
                actor_user_id=user.user_id,
                actor_role=user.role,
                thread_id=thread_id,
                file_id=file_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": _build_content_disposition(
                disposition="attachment",
                filename=filename,
            ),
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _build_content_disposition(*, disposition: str, filename: str) -> str:
    ascii_filename = filename.encode("ascii", "ignore").decode("ascii") or "download"
    return (
        f'{disposition}; filename="{ascii_filename}"'
        f"; filename*=UTF-8''{quote(filename)}"
    )
