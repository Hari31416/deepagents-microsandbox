from fastapi.testclient import TestClient

from app.api.main import create_app
from app.config import get_settings


def _login_as_super_admin(client: TestClient) -> None:
    settings = get_settings()
    response = client.post(
        "/api/auth/login",
        json={
            "email": settings.super_admin_email,
            "password": settings.super_admin_password,
        },
    )
    assert response.status_code == 200


def test_health_route() -> None:
    client = TestClient(create_app())

    response = client.get("/api/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["service"] == "deepagent-sandbox-backend"


def test_create_and_get_thread() -> None:
    client = TestClient(create_app())
    _login_as_super_admin(client)

    create_response = client.post("/api/threads", json={"title": "First thread"})
    assert create_response.status_code == 201
    thread_id = create_response.json()["thread_id"]

    get_response = client.get(f"/api/threads/{thread_id}")
    assert get_response.status_code == 200
    assert get_response.json()["title"] == "First thread"

    messages_response = client.get(f"/api/threads/{thread_id}/messages")
    assert messages_response.status_code == 200
    assert messages_response.json() == {"messages": []}

    events_response = client.get(f"/api/threads/{thread_id}/events")
    assert events_response.status_code == 200
    assert events_response.json() == {"events": []}

    runs_response = client.get(f"/api/threads/{thread_id}/runs")
    assert runs_response.status_code == 200
    assert runs_response.json() == {"runs": []}


def test_update_and_delete_thread() -> None:
    client = TestClient(create_app())
    _login_as_super_admin(client)

    create_response = client.post("/api/threads", json={"title": "Original title"})
    assert create_response.status_code == 201
    thread_id = create_response.json()["thread_id"]

    update_response = client.patch(f"/api/threads/{thread_id}", json={"title": "Renamed thread"})
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Renamed thread"

    delete_response = client.delete(f"/api/threads/{thread_id}")
    assert delete_response.status_code == 204

    get_response = client.get(f"/api/threads/{thread_id}")
    assert get_response.status_code == 404
