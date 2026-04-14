from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.api.dependencies import get_services
from app.security import ROLE_ADMIN, ROLE_SUPER_ADMIN


class UserContext(BaseModel):
    user_id: str
    email: str
    display_name: str | None = None
    role: str
    status: str

    @property
    def is_admin(self) -> bool:
        return self.role in {ROLE_ADMIN, ROLE_SUPER_ADMIN}

    @property
    def is_super_admin(self) -> bool:
        return self.role == ROLE_SUPER_ADMIN


def get_current_user(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    access_cookie: Annotated[str | None, Cookie(alias="deepagent_access_token")] = None,
) -> UserContext:
    services = get_services()
    token = _extract_bearer_token(authorization) or access_cookie
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    try:
        user = services.auth_service.get_user_from_access_token(token)
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token") from exc

    return UserContext(**user)


def require_admin(user: Annotated[UserContext, Depends(get_current_user)]) -> UserContext:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_super_admin(user: Annotated[UserContext, Depends(get_current_user)]) -> UserContext:
    if not user.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token
