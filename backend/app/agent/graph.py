from __future__ import annotations

import atexit
from functools import lru_cache

from app.agent.backend import MicrosandboxBackend
from app.agent.models import AgentContext
from app.agent.prompts import SYSTEM_PROMPT
from app.agent.tools import DEFAULT_AGENT_TOOLS
from app.config import get_settings
from app.db.repositories import SandboxSessionRepository
from app.db.session import get_session_factory, init_database


def _context_value(context: object, key: str, default: str) -> str:
    if isinstance(context, dict):
        value = context.get(key)
        return str(value) if value else default
    value = getattr(context, key, None)
    return str(value) if value else default


def create_backend(runtime):
    settings = get_settings()
    init_database()
    context = runtime.context or {}
    thread_id = _context_value(context, "thread_id", "default-thread")
    user_id = _context_value(context, "user_id", settings.default_user_id)
    return MicrosandboxBackend(
        executor_base_url=settings.executor_base_url,
        thread_id=thread_id,
        user_id=user_id,
        session_repository=SandboxSessionRepository(get_session_factory()),
    )


@lru_cache(maxsize=1)
def get_checkpointer():
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
    except ImportError:  # pragma: no cover - dependency-level guard
        return None

    settings = get_settings()
    manager = PostgresSaver.from_conn_string(settings.database_url)
    checkpointer = manager.__enter__()
    checkpointer.setup()
    atexit.register(manager.__exit__, None, None, None)
    return checkpointer


def build_langgraph_app():
    try:
        from deepagents import create_deep_agent
        from langchain.chat_models import init_chat_model
    except ImportError as exc:  # pragma: no cover - dependency-level guard
        raise RuntimeError(
            "DeepAgents and LangChain provider dependencies must be installed to build the agent graph."
        ) from exc

    settings = get_settings()
    model = init_chat_model(model=settings.agent_model, temperature=0)

    return create_deep_agent(
        model=model,
        tools=DEFAULT_AGENT_TOOLS,
        system_prompt=SYSTEM_PROMPT,
        backend=create_backend,
        context_schema=AgentContext,
        checkpointer=get_checkpointer(),
        name="data-analyst",
    )
