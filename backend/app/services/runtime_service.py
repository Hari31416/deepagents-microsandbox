from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, Protocol

from app.agent.graph import build_langgraph_app
from app.config import Settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


class GraphApp(Protocol):
    def astream(self, *args: Any, **kwargs: Any): ...


class RuntimeService:
    def __init__(
        self,
        settings: Settings,
        graph_factory=build_langgraph_app,
    ) -> None:
        self._settings = settings
        self._graph_factory = graph_factory
        self._checkpoint_setup_complete = False
        self._checkpoint_setup_lock = asyncio.Lock()

    @asynccontextmanager
    async def graph(self) -> AsyncIterator[GraphApp]:
        checkpoint_uri = self._settings.runtime_postgres_uri
        if checkpoint_uri is None:
            yield self._graph_factory()
            return

        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        async with AsyncPostgresSaver.from_conn_string(checkpoint_uri) as checkpointer:
            await self._ensure_checkpointer_setup(checkpointer)
            yield self._graph_factory(checkpointer=checkpointer)

    async def _ensure_checkpointer_setup(self, checkpointer: "AsyncPostgresSaver") -> None:
        if self._checkpoint_setup_complete:
            return
        async with self._checkpoint_setup_lock:
            if self._checkpoint_setup_complete:
                return
            await checkpointer.setup()
            self._checkpoint_setup_complete = True
