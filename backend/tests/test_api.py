from fastapi.testclient import TestClient

from app.api.dependencies import get_services
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

    update_response = client.patch(
        f"/api/threads/{thread_id}", json={"title": "Renamed thread"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Renamed thread"

    delete_response = client.delete(f"/api/threads/{thread_id}")
    assert delete_response.status_code == 204

    get_response = client.get(f"/api/threads/{thread_id}")
    assert get_response.status_code == 404


def test_file_routes_stream_backend_owned_content(monkeypatch) -> None:
    client = TestClient(create_app())
    _login_as_super_admin(client)
    current_user = client.get("/api/auth/me").json()["user"]

    create_response = client.post("/api/threads", json={"title": "Artifacts"})
    assert create_response.status_code == 201
    thread_id = create_response.json()["thread_id"]

    services = get_services()
    stored_objects: dict[str, bytes] = {}

    def fake_put_object(
        object_key: str, content: bytes, content_type: str | None = None
    ) -> None:
        stored_objects[object_key] = content

    def fake_get_object(object_key: str) -> bytes:
        return stored_objects[object_key]

    monkeypatch.setattr(services.file_service._storage, "put_object", fake_put_object)
    monkeypatch.setattr(services.file_service._storage, "get_object", fake_get_object)

    artifact = services.file_service.import_artifact(
        actor_user_id=current_user["user_id"],
        actor_role="super_admin",
        thread_id=thread_id,
        relative_path="report.html",
        content=b"<html><body>artifact</body></html>",
        content_type="text/html",
    )

    compatibility_response = client.post(
        "/api/files/presign-download",
        json={"thread_id": thread_id, "file_id": artifact["file_id"]},
    )
    assert compatibility_response.status_code == 200, compatibility_response.text
    assert compatibility_response.json()["url"].endswith(
        f"/api/files/{thread_id}/{artifact['file_id']}"
    )

    content_response = client.get(f"/api/files/{thread_id}/{artifact['file_id']}")
    assert content_response.status_code == 200, content_response.text
    assert content_response.text == "<html><body>artifact</body></html>"
    assert content_response.headers["content-type"].startswith("text/html")

    download_response = client.get(
        f"/api/files/{thread_id}/{artifact['file_id']}/download"
    )
    assert download_response.status_code == 200, download_response.text
    assert "attachment;" in download_response.headers["content-disposition"]


def test_file_upload_route_stores_content_via_backend(monkeypatch) -> None:
    client = TestClient(create_app())
    _login_as_super_admin(client)

    create_response = client.post("/api/threads", json={"title": "Uploads"})
    assert create_response.status_code == 201
    thread_id = create_response.json()["thread_id"]

    services = get_services()
    stored_objects: dict[str, bytes] = {}

    def fake_put_object_stream(
        object_key,
        stream,
        *,
        length: int,
        content_type: str | None = None,
    ) -> None:
        stored_objects[object_key] = stream.read(length)

    def fake_stat_object(object_key: str):
        return type(
            "ObjectMetadata",
            (),
            {
                "object_key": object_key,
                "size": len(stored_objects[object_key]),
                "content_type": "text/csv",
            },
        )()

    monkeypatch.setattr(
        services.file_service._storage,
        "put_object_stream",
        fake_put_object_stream,
    )
    monkeypatch.setattr(
        services.file_service._storage,
        "stat_object",
        fake_stat_object,
    )

    upload_response = client.post(
        f"/api/files/upload?thread_id={thread_id}&filename=iris.csv&purpose=upload",
        content=b"sepal_length,sepal_width\n5.1,3.5\n",
        headers={"Content-Type": "text/csv"},
    )
    assert upload_response.status_code == 201, upload_response.text
    payload = upload_response.json()
    assert payload["original_filename"] == "iris.csv"
    assert payload["content_type"] == "text/csv"
    assert stored_objects
