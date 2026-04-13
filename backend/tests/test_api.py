from fastapi.testclient import TestClient

from app.api.main import create_app


def test_health_route() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["service"] == "deepagent-sandbox-backend"


def test_create_and_get_thread() -> None:
    client = TestClient(create_app())

    create_response = client.post("/api/threads", json={"title": "First thread"})
    assert create_response.status_code == 201
    thread_id = create_response.json()["thread_id"]

    get_response = client.get(f"/api/threads/{thread_id}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "First thread"
