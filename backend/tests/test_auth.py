from fastapi.testclient import TestClient

from app.api.dependencies import get_services
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


def test_admin_visibility_excludes_super_admin_and_other_admin_threads() -> None:
    app = create_app()
    super_admin_client = TestClient(app)
    _login_super_admin(super_admin_client)

    admin_one = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "admin-one@example.com",
            "password": "AdminOne123!",
            "display_name": "Admin One",
            "role": "admin",
        },
    )
    admin_two = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "admin-two@example.com",
            "password": "AdminTwo123!",
            "display_name": "Admin Two",
            "role": "admin",
        },
    )
    managed_user = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "managed-user@example.com",
            "password": "ManagedUser123!",
            "display_name": "Managed User",
            "role": "user",
        },
    )
    assert admin_one.status_code == 201, admin_one.text
    assert admin_two.status_code == 201, admin_two.text
    assert managed_user.status_code == 201, managed_user.text

    super_admin_thread = super_admin_client.post(
        "/api/threads",
        json={"title": "Leadership"},
    ).json()

    admin_one_client = TestClient(app)
    _login(admin_one_client, email="admin-one@example.com", password="AdminOne123!")
    admin_one_thread = admin_one_client.post(
        "/api/threads",
        json={"title": "Admin One Private"},
    ).json()

    admin_two_client = TestClient(app)
    _login(admin_two_client, email="admin-two@example.com", password="AdminTwo123!")
    admin_two_thread = admin_two_client.post(
        "/api/threads",
        json={"title": "Admin Two Private"},
    ).json()

    user_client = TestClient(app)
    _login(user_client, email="managed-user@example.com", password="ManagedUser123!")
    user_thread = user_client.post(
        "/api/threads",
        json={"title": "User Support Thread"},
    ).json()

    list_response = admin_one_client.get("/api/threads")
    assert list_response.status_code == 200, list_response.text
    visible_titles = {thread["title"] for thread in list_response.json()["threads"]}
    assert visible_titles == {"Admin One Private", "User Support Thread"}

    assert admin_one_client.get(f"/api/threads/{user_thread['thread_id']}").status_code == 200
    assert admin_one_client.get(f"/api/threads/{super_admin_thread['thread_id']}").status_code == 404
    assert admin_one_client.get(f"/api/threads/{admin_two_thread['thread_id']}").status_code == 404
    assert admin_one_client.get(f"/api/threads/{admin_one_thread['thread_id']}").status_code == 200


def test_password_reset_revokes_existing_refresh_tokens() -> None:
    app = create_app()
    super_admin_client = TestClient(app)
    _login_super_admin(super_admin_client)

    create_user_response = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "reset-target@example.com",
            "password": "InitialPass123!",
            "display_name": "Reset Target",
            "role": "user",
        },
    )
    assert create_user_response.status_code == 201, create_user_response.text
    user_id = create_user_response.json()["user_id"]

    user_client = TestClient(app)
    _login(user_client, email="reset-target@example.com", password="InitialPass123!")

    reset_response = super_admin_client.post(
        f"/api/admin/users/{user_id}/reset-password",
        json={"password": "UpdatedPass123!"},
    )
    assert reset_response.status_code == 200, reset_response.text

    refresh_response = user_client.post("/api/auth/refresh")
    assert refresh_response.status_code == 401

    relogin_response = user_client.post(
        "/api/auth/login",
        json={"email": "reset-target@example.com", "password": "UpdatedPass123!"},
    )
    assert relogin_response.status_code == 200, relogin_response.text


def test_disabling_user_revokes_sessions_and_blocks_access() -> None:
    app = create_app()
    super_admin_client = TestClient(app)
    _login_super_admin(super_admin_client)

    create_user_response = super_admin_client.post(
        "/api/admin/users",
        json={
            "email": "disable-target@example.com",
            "password": "DisableMe123!",
            "display_name": "Disable Target",
            "role": "user",
        },
    )
    assert create_user_response.status_code == 201, create_user_response.text
    user_id = create_user_response.json()["user_id"]

    user_client = TestClient(app)
    _login(user_client, email="disable-target@example.com", password="DisableMe123!")

    disable_response = super_admin_client.patch(
        f"/api/admin/users/{user_id}",
        json={"status": "disabled"},
    )
    assert disable_response.status_code == 200, disable_response.text

    me_response = user_client.get("/api/auth/me")
    assert me_response.status_code == 401

    refresh_response = user_client.post("/api/auth/refresh")
    assert refresh_response.status_code == 401


def test_login_rate_limit_blocks_repeated_failures(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_LOGIN_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("AUTH_LOGIN_WINDOW_SECONDS", "3600")
    monkeypatch.setenv("AUTH_LOGIN_LOCKOUT_SECONDS", "3600")
    get_settings.cache_clear()
    get_services.cache_clear()

    client = TestClient(create_app())

    first = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "WrongPass123!"},
    )
    second = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "WrongPass123!"},
    )
    third = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "WrongPass123!"},
    )

    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 429
