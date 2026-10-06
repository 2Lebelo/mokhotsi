"""FastAPI dependencies shared by routers."""

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.db import Database
from app.core.errors import NotImplementedFeature


def get_db(request: Request) -> Database:
    """The database handle created once in the lifespan (one client per process)."""
    return request.app.state.db


DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentShop:
    shop_id: UUID
    device_id: UUID


async def get_current_shop(
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentShop:
    """Resolve the caller's shop from `Authorization: Bearer <access token>`.

    shop_id comes ONLY from the verified token's `sub` claim, never from the request body,
    so a device can only ever read or write its own shop's data.
    """
    # TODO(feature): if credentials is None → raise Unauthorized; claims = decode_token(settings,
    # credentials.credentials, "access"); return CurrentShop(shop_id=claims.sub, device_id=claims.device_id).
    raise NotImplementedFeature("auth dependency get_current_shop")


CurrentShopDep = Annotated[CurrentShop, Depends(get_current_shop)]
