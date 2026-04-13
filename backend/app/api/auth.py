from typing import Annotated

from fastapi import Header
from pydantic import BaseModel

from app.config import get_settings


class UserContext(BaseModel):
    user_id: str


def get_current_user(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> UserContext:
    settings = get_settings()
    return UserContext(user_id=x_user_id or settings.default_user_id)
