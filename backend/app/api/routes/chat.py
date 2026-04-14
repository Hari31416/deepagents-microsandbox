from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.auth import UserContext, get_current_user
from app.api.dependencies import get_services

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatStreamRequest(BaseModel):
    thread_id: str
    message: str = Field(min_length=1)
    selected_file_ids: list[str] = Field(default_factory=list)


@router.post("/stream")
async def stream_chat(
    payload: ChatStreamRequest,
    user: Annotated[UserContext, Depends(get_current_user)],
):
    services = get_services()
    stream = services.stream_service.stream_chat(
        owner_id=user.user_id,
        thread_id=payload.thread_id,
        message=payload.message,
        selected_file_ids=payload.selected_file_ids,
    )
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
