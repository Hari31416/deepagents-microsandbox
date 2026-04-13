import asyncio
import json

from app.services.thread_service import ThreadService


def _sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class StreamService:
    def __init__(self, thread_service: ThreadService) -> None:
        self._thread_service = thread_service

    async def stream_chat(
        self,
        owner_id: str,
        thread_id: str,
        message: str,
        selected_file_ids: list[str],
    ):
        if self._thread_service.get_thread_for_owner(owner_id=owner_id, thread_id=thread_id) is None:
            yield _sse("error", {"detail": "Thread not found"})
            return

        yield _sse("status", {"state": "accepted", "thread_id": thread_id})
        await asyncio.sleep(0)
        yield _sse("message", {"role": "assistant", "delta": "Streaming placeholder response."})
        await asyncio.sleep(0)
        yield _sse(
            "message",
            {
                "role": "assistant",
                "delta": f" Received message of length {len(message)} with {len(selected_file_ids)} selected files.",
            },
        )
        await asyncio.sleep(0)
        yield _sse("done", {"thread_id": thread_id})
