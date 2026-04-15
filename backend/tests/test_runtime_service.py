from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from app.config import Settings
from app.services.runtime_service import RuntimeService


class StubCheckpointer:
    def __init__(self) -> None:
        self.setup_calls = 0

    async def setup(self) -> None:
        self.setup_calls += 1


class StubAsyncPostgresSaver:
    instances: list[StubCheckpointer] = []

    @classmethod
    @asynccontextmanager
    async def from_conn_string(cls, conn_string: str):
        checkpointer = StubCheckpointer()
        cls.instances.append(checkpointer)
        yield checkpointer


def test_runtime_service_uses_checkpointer_once(monkeypatch) -> None:
    observed: list[object] = []

    def graph_factory(*, checkpointer=None):
        observed.append(checkpointer)
        return object()

    StubAsyncPostgresSaver.instances = []
    monkeypatch.setattr(
        "langgraph.checkpoint.postgres.aio.AsyncPostgresSaver",
        StubAsyncPostgresSaver,
    )

    service = RuntimeService(
        settings=Settings(
            database_url="postgresql+psycopg://user:pass@localhost:5432/app"
        ),
        graph_factory=graph_factory,
    )

    async def run() -> None:
        async with service.graph():
            pass
        async with service.graph():
            pass

    asyncio.run(run())

    assert len(observed) == 2
    assert StubAsyncPostgresSaver.instances[0].setup_calls == 1
    assert StubAsyncPostgresSaver.instances[1].setup_calls == 0


def test_runtime_service_falls_back_without_postgres() -> None:
    observed: list[object] = []

    def graph_factory(*, checkpointer=None):
        observed.append(checkpointer)
        return object()

    service = RuntimeService(
        settings=Settings(database_url="sqlite+pysqlite:///:memory:"),
        graph_factory=graph_factory,
    )

    async def run() -> None:
        async with service.graph():
            pass

    asyncio.run(run())

    assert observed == [None]
