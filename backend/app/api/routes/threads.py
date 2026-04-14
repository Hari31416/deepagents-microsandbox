from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.auth import UserContext, get_current_user
from app.api.dependencies import get_services

router = APIRouter(prefix="/threads", tags=["threads"])


class CreateThreadRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class UpdateThreadRequest(BaseModel):
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
    return {"threads": services.thread_service.list_threads(actor_user_id=user.user_id, actor_role=user.role)}


@router.get("/{thread_id}")
async def get_thread(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.get_thread_for_actor(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    return thread


@router.patch("/{thread_id}")
async def update_thread(
    thread_id: str,
    payload: UpdateThreadRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.update_thread_title(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
        title=payload.title,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    return thread


@router.delete("/{thread_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thread(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    deleted = services.thread_service.delete_thread(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")


@router.get("/{thread_id}/files")
async def list_thread_files(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    try:
        return {
            "files": services.file_service.list_files(
                actor_user_id=user.user_id,
                actor_role=user.role,
                thread_id=thread_id,
            )
        }
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{thread_id}/messages")
async def list_thread_messages(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.get_thread_for_actor(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    owner_id = str(thread["owner_id"])
    return {
        "messages": services.message_service.list_messages(
            owner_id=owner_id if user.is_admin else user.user_id,
            thread_id=thread_id,
        )
    }


@router.get("/{thread_id}/events")
async def list_thread_events(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
    run_id: str | None = None,
):
    services = get_services()
    thread = services.thread_service.get_thread_for_actor(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    owner_id = str(thread["owner_id"])
    return {
        "events": services.run_event_service.list_events(
            owner_id=owner_id if user.is_admin else user.user_id,
            thread_id=thread_id,
            run_id=run_id,
        )
    }


@router.get("/{thread_id}/runs")
async def list_thread_runs(
    thread_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.get_thread_for_actor(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    owner_id = str(thread["owner_id"])
    return {"runs": services.run_service.list_runs(owner_id=owner_id if user.is_admin else user.user_id, thread_id=thread_id)}


@router.get("/{thread_id}/runs/{run_id}")
async def get_thread_run(
    thread_id: str,
    run_id: str,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    thread = services.thread_service.get_thread_for_actor(
        actor_user_id=user.user_id,
        actor_role=user.role,
        thread_id=thread_id,
    )
    if thread is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found")
    owner_id = str(thread["owner_id"])
    run = services.run_service.get_run(
        owner_id=owner_id if user.is_admin else user.user_id,
        thread_id=thread_id,
        run_id=run_id,
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run
