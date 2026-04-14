import sys
import types

from app.agent.graph import build_langgraph_app


def test_build_langgraph_app_uses_runtime_persistence(monkeypatch) -> None:
    captured: dict[str, object] = {}

    deepagents_module = types.ModuleType("deepagents")

    def fake_create_deep_agent(**kwargs):
        captured.update(kwargs)
        return "graph-app"

    deepagents_module.create_deep_agent = fake_create_deep_agent

    langchain_module = types.ModuleType("langchain")
    chat_models_module = types.ModuleType("langchain.chat_models")

    def fake_init_chat_model(*, model: str, temperature: int):
        captured["model_config"] = {"model": model, "temperature": temperature}
        return "chat-model"

    chat_models_module.init_chat_model = fake_init_chat_model

    monkeypatch.setitem(sys.modules, "deepagents", deepagents_module)
    monkeypatch.setitem(sys.modules, "langchain", langchain_module)
    monkeypatch.setitem(sys.modules, "langchain.chat_models", chat_models_module)
    monkeypatch.setenv("AGENT_MODEL", "openai:test-model")

    app = build_langgraph_app()

    assert app == "graph-app"
    assert captured["model_config"] == {"model": "openai:test-model", "temperature": 0}
    assert captured["backend"].__name__ == "create_backend"
    assert "checkpointer" not in captured
