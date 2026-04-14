from fastapi.testclient import TestClient

from app.api.main import create_app
from app.config import get_settings


def _login(client: TestClient, *, email: str, password: str) -> None:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text


def _login_super_admin(client: TestClient) -> None:
    settings = get_settings()
    _login(client, email=settings.super_admin_email, password=settings.super_admin_password)


def test_seeded_super_admin_can_login_and_read_profile() -> None:
    client = TestClient(create_app())
    _login_super_admin(client)

    me_response = client.get("/api/auth/me")

    assert me_response.status_code == 200
    payload = me_response.json()["user"]
    assert payload["email"] == get_settings().super_admin_email
    assert payload["role"] == "super_admin"
    assert payload["status"] == "active"


def test_super_admin_can_create_admin_and_admin_cannot_create_admin() -> None:
    app = create_app()
    super_admin_client = TestClient(app)
    _login_super_admin(super_admin_client)

    create_admin_response = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "admin@example.com",
            "password": "AdminPass123!",
            "display_name": "Admin User",
            "role": "admin",
        },
    )
    assert create_admin_response.status_code == 201, create_admin_response.text

    admin_client = TestClient(app)
    _login(admin_client, email="admin@example.com", password="AdminPass123!")

    forbidden_response = admin_client.post(
        "/api/admin/users",
        json={
            "email": "another-admin@example.com",
            "password": "AnotherAdmin123!",
            "display_name": "Another Admin",
            "role": "admin",
        },
    )
    assert forbidden_response.status_code == 403

    create_user_response = admin_client.post(
        "/api/admin/users",
        json={
            "email": "user-from-admin@example.com",
            "password": "UserPass123!",
            "display_name": "Managed User",
            "role": "user",
        },
    )
    assert create_user_response.status_code == 201, create_user_response.text


def test_user_cannot_access_admin_routes_or_other_user_threads() -> None:
    app = create_app()
    super_admin_client = TestClient(app)
    _login_super_admin(super_admin_client)

    first_user = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "user-one@example.com",
            "password": "UserOne123!",
            "display_name": "User One",
            "role": "user",
        },
    )
    second_user = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "user-two@example.com",
            "password": "UserTwo123!",
            "display_name": "User Two",
            "role": "user",
        },
    )
    assert first_user.status_code == 201, first_user.text
    assert second_user.status_code == 201, second_user.text

    user_one_client = TestClient(app)
    _login(user_one_client, email="user-one@example.com", password="UserOne123!")
    thread_response = user_one_client.post("/api/threads", json={"title": "Private thread"})
    assert thread_response.status_code == 201, thread_response.text
    thread_id = thread_response.json()["thread_id"]

    user_two_client = TestClient(app)
    _login(user_two_client, email="user-two@example.com", password="UserTwo123!")

    admin_route_response = user_two_client.get("/api/admin/users")
    assert admin_route_response.status_code == 403

    cross_thread_response = user_two_client.get(f"/api/threads/{thread_id}")
    assert cross_thread_response.status_code == 404
