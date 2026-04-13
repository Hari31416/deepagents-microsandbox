from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.auth import UserContext, get_current_user
from app.api.dependencies import get_services

router = APIRouter(prefix="/threads", tags=["threads"])


class CreateThreadRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_thread(
    payload: CreateThreadRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    return services.thread_service.create_thread(owner_id=user.user_id, title=payload.title)


@router.get("")
async def list_threads(
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    return {"threads": services.thread_service.list_threads(owner_id=user.user_id)}


@router.get("/{thread_id}")
async def get_thread(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.get_thread_for_owner(owner_id=user.user_id, thread_id=thread_id)
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    return thread


@router.get("/{thread_id}/files")
async def list_thread_files(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        return {"files": services.file_service.list_files(owner_id=user.user_id, thread_id=thread_id)}
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
