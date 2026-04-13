import asyncio

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.config import Settings
from app.services.stream_service import StreamService


class StubThreadService:
    def get_thread_for_owner(self, owner_id: str, thread_id: str):
        if owner_id == "user-1" and thread_id == "thread-1":
            return {"thread_id": thread_id, "owner_id": owner_id}
        return None


def test_stream_service_proxies_langgraph_stream() -> None:
    observed: dict[str, dict[str, object]] = {}
    app = FastAPI()

    @app.post("/threads")
    async def create_thread(request: Request):
        observed["create_thread"] = {
            "headers": dict(request.headers),
            "payload": await request.json(),
        }
        return JSONResponse({"thread_id": "thread-1"}, status_code=201)

    @app.post("/threads/thread-1/runs/stream")
    async def stream_run(request: Request):
        observed["stream_run"] = {
            "headers": dict(request.headers),
            "payload": await request.json(),
        }

        async def event_stream():
            yield b"event: message\ndata: {\"delta\":\"hello\"}\n\n"
            yield b"event: done\ndata: {\"thread_id\":\"thread-1\"}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    service = StreamService(
        thread_service=StubThreadService(),
        settings=Settings(
            database_url="sqlite+pysqlite:///:memory:",
            langgraph_base_url="http://langgraph.test",
            langgraph_assistant_id="data-analyst",
            langgraph_stream_mode="updates",
        ),
        transport=httpx.ASGITransport(app=app),
    )

    async def consume_stream() -> str:
        chunks: list[str] = []
        async for chunk in service.stream_chat(
            owner_id="user-1",
            thread_id="thread-1",
            message="Create a chart",
            selected_file_ids=["file-1"],
        ):
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
        return "".join(chunks)

    output = asyncio.run(consume_stream())

    assert "event: message" in output
    assert observed["create_thread"]["payload"] == {
        "thread_id": "thread-1",
        "metadata": {"owner_id": "user-1"},
    }
    assert observed["stream_run"]["headers"]["x-user-id"] == "user-1"
    assert observed["stream_run"]["headers"]["x-thread-id"] == "thread-1"
    assert observed["stream_run"]["payload"] == {
        "assistant_id": "data-analyst",
        "input": {
            "messages": [{"role": "user", "content": "Create a chart"}],
            "selected_file_ids": ["file-1"],
        },
        "context": {
            "user_id": "user-1",
            "thread_id": "thread-1",
            "selected_file_ids": ["file-1"],
        },
        "stream_mode": "updates",
    }
