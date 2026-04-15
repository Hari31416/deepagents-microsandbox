from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from app.api.auth import UserContext, get_current_user
from app.api.dependencies import get_services
from app.services.login_throttle_service import LoginRateLimitError

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


@router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response):
    services = get_services()
    try:
        session = services.auth_service.authenticate(
            email=payload.email,
            password=payload.password,
            client_ip=request.client.host if request.client else None,
        )
    except LoginRateLimitError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc
    _set_auth_cookies(response, session["access_token"], session["refresh_token"])
    return {"user": session["user"]}


@router.post("/refresh")
async def refresh(
    response: Response,
    refresh_cookie: Annotated[
        str | None, Cookie(alias="deepagent_refresh_token")
    ] = None,
):
    if not refresh_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token required"
        )
    services = get_services()
    try:
        session = services.auth_service.refresh_session(refresh_cookie)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from exc
    _set_auth_cookies(response, session["access_token"], session["refresh_token"])
    return {"user": session["user"]}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    refresh_cookie: Annotated[
        str | None, Cookie(alias="deepagent_refresh_token")
    ] = None,
):
    services = get_services()
    services.auth_service.logout(refresh_cookie)
    _clear_auth_cookies(response)


@router.get("/me")
async def me(user: Annotated[UserContext, Depends(get_current_user)]):
    services = get_services()
    payload = services.user_service.get_active_user_by_id(user.user_id)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    return {"user": payload}


def _set_auth_cookies(
    response: Response, access_token: str, refresh_token: str
) -> None:
    settings = get_services().settings
    cookie_options = {
        "httponly": True,
        "secure": settings.auth_cookie_secure,
        "samesite": "lax",
        "path": "/",
    }
    response.set_cookie(
        settings.auth_access_cookie_name,
        access_token,
        max_age=settings.auth_access_token_ttl_seconds,
        **cookie_options,
    )
    response.set_cookie(
        settings.auth_refresh_cookie_name,
        refresh_token,
        max_age=settings.auth_refresh_token_ttl_seconds,
        **cookie_options,
    )


def _clear_auth_cookies(response: Response) -> None:
    settings = get_services().settings
    response.delete_cookie(settings.auth_access_cookie_name, path="/")
    response.delete_cookie(settings.auth_refresh_cookie_name, path="/")
