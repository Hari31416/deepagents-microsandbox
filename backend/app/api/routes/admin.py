from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.auth import UserContext, require_admin
from app.api.dependencies import get_services
from app.security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])


class CreateUserRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=120)
    role: str = Field(default="user")


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    role: str | None = None
    status: str | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=256)


@router.get("/users")
async def list_users(user: Annotated[UserContext, Depends(require_admin)]):
    services = get_services()
    return {"users": services.user_service.list_users()}


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    user: Annotated[UserContext, Depends(require_admin)],
):
    services = get_services()
    try:
        return services.user_service.create_user(
            actor_id=user.user_id,
            actor_role=user.role,
            email=payload.email,
            display_name=payload.display_name,
            password_hash=hash_password(payload.password),
            role=payload.role,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    user: Annotated[UserContext, Depends(require_admin)],
):
    services = get_services()
    try:
        return services.user_service.update_user(
            actor_id=user.user_id,
            actor_role=user.role,
            user_id=user_id,
            display_name=payload.display_name,
            role=payload.role,
            status=payload.status,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    payload: ResetPasswordRequest,
    user: Annotated[UserContext, Depends(require_admin)],
):
    services = get_services()
    try:
        return services.user_service.reset_password(
            actor_id=user.user_id,
            actor_role=user.role,
            user_id=user_id,
            password_hash=hash_password(payload.password),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
