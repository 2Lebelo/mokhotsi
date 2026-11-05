"""Registered phones: a phone's own roster, a shop's phones, and revocation (ADR 0005)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Response, status

from app.core.deps import (
    Caller,
    CallerDep,
    DbDep,
    DeviceDep,
    ShopAccess,
    require_permission,
    require_shop_permission,
)
from app.core.errors import error_responses
from app.core.pagination import Page, PageParams, make_page, page_params
from app.core.permissions import Perm
from app.schemas.devices import DeviceOut, RosterOut
from app.schemas.shops import DataClaimOut
from app.services import device_service

router = APIRouter(tags=["devices"])

ReadUsers = Annotated[Caller, Depends(require_permission(Perm.USERS_READ))]
ManageDevices = Annotated[ShopAccess, Depends(require_shop_permission(Perm.DEVICES_MANAGE))]


@router.get(
    "/devices/me/roster",
    response_model=RosterOut,
    responses={**error_responses(401), 304: {"description": "Unchanged since If-None-Match"}},
    summary="This phone's shops, their PIN keys and who may sign in (device token)",
    description=(
        "Poll with `If-None-Match`: an unchanged roster is a 304 with no body. The ETag changes "
        "whenever a member, PIN, permission, shop name or status, or this phone's shops change."
    ),
)
async def get_roster(
    db: DbDep,
    device: DeviceDep,
    response: Response,
    if_none_match: Annotated[str | None, Header()] = None,
) -> RosterOut | Response:
    # The ETag is read before the roster, so a change in between makes the next poll refetch.
    tag = await device_service.current_roster_etag(db, device.device)
    headers = {"ETag": tag, "Cache-Control": "no-cache"}
    if if_none_match is not None and if_none_match.strip() == tag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    response.headers.update(headers)
    return await device_service.roster(db, device)


@router.get(
    "/devices",
    response_model=Page[DeviceOut],
    responses=error_responses(400, 401, 403),
    summary="Every registered phone (system admin)",
)
async def list_devices(
    db: DbDep,
    _: ReadUsers,
    params: Annotated[PageParams, Depends(page_params)],
    registered_by: UUID | None = None,
    shop_id: UUID | None = None,
) -> Page[DeviceOut]:
    items, next_cursor = await device_service.list_devices(db, params, registered_by, shop_id)
    return make_page(items, next_cursor, params.limit)


@router.delete(
    "/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 404),
    summary="Revoke a phone: it stops syncing and everyone on it is signed out",
)
async def revoke_device(device_id: UUID, db: DbDep, caller: CallerDep) -> None:
    await device_service.revoke_device(db, caller, device_id)


@router.get(
    "/shops/{shop_id}/devices",
    response_model=Page[DeviceOut],
    responses=error_responses(400, 401, 403, 404),
    summary="The shop's phones, with when each last synced",
)
async def list_shop_devices(
    db: DbDep, access: ManageDevices, params: Annotated[PageParams, Depends(page_params)]
) -> Page[DeviceOut]:
    items, next_cursor = await device_service.list_shop_devices(db, access, params)
    return make_page(items, next_cursor, params.limit)


@router.put(
    "/shops/{shop_id}/devices/{device_id}",
    response_model=DeviceOut,
    responses=error_responses(401, 403, 404),
    summary="Register a phone to the shop (the phone you are using, or one you registered)",
    description="Idempotent. The phone then receives the shop's roster, so its cashiers can sign in.",
)
async def link_device(device_id: UUID, db: DbDep, access: ManageDevices) -> DeviceOut:
    return await device_service.link_device(db, access, device_id)


@router.delete(
    "/shops/{shop_id}/devices/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=error_responses(401, 403, 404),
    summary="Remove a phone from the shop (it keeps any other shops)",
)
async def unlink_device(device_id: UUID, db: DbDep, access: ManageDevices) -> None:
    await device_service.unlink_device(db, access, device_id)


@router.put(
    "/shops/{shop_id}/data-claim",
    response_model=DataClaimOut,
    responses=error_responses(401, 403, 404, 409),
    summary="Let this phone seed the shop with the data it kept offline (once per shop)",
    description=(
        "The first phone to ask holds the claim; asking again from it is fine. Any other phone "
        "gets `data_already_claimed` and starts from the shop's synced data instead."
    ),
)
async def claim_data(db: DbDep, access: ManageDevices) -> DataClaimOut:
    return DataClaimOut(device_id=await device_service.claim_data(db, access))
