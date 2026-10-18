from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import CallerDep, DbDep, IfMatchDep, etag
from app.core.errors import error_responses
from app.core.idempotency import IDEMPOTENCY_OPTIONAL, IdempotentRoute
from app.core.pagination import Page, PageParams, make_page, page_params
from app.schemas.shops import ShopCreate, ShopOut, ShopStatus, ShopUpdate
from app.services import shop_service

router = APIRouter(prefix="/shops", tags=["shops"], route_class=IdempotentRoute)


@router.get(
    "",
    response_model=Page[ShopOut],
    responses=error_responses(400, 401, 403),
    summary="Shops you belong to (admins: every shop)",
)
async def list_shops(
    db: DbDep,
    caller: CallerDep,
    params: Annotated[PageParams, Depends(page_params)],
    owner_id: UUID | None = None,
    status: ShopStatus | None = None,
    q: Annotated[str | None, Query(max_length=100, description="Name contains")] = None,
) -> Page[ShopOut]:
    items, next_cursor = await shop_service.list_shops(db, caller, params, owner_id, status, q)
    return make_page(items, next_cursor, params.limit)


@router.post(
    "",
    response_model=ShopOut,
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(401, 403, 422),
    openapi_extra=IDEMPOTENCY_OPTIONAL,
    summary="Create a shop (keepers: owned by themselves; admins: set owner_id)",
)
async def create_shop(
    db: DbDep, caller: CallerDep, body: ShopCreate, response: Response
) -> ShopOut:
    doc = await shop_service.create_shop(db, caller, body)
    response.headers["Location"] = f"/api/v1/shops/{doc['_id']}"
    response.headers["ETag"] = etag(doc["version"])
    return await shop_service.get_shop(db, caller, doc["_id"])


@router.get(
    "/{shop_id}",
    response_model=ShopOut,
    responses=error_responses(401, 403, 404),
    summary="Get a shop",
)
async def get_shop(shop_id: UUID, db: DbDep, caller: CallerDep, response: Response) -> ShopOut:
    shop = await shop_service.get_shop(db, caller, shop_id)
    response.headers["ETag"] = etag(shop.version)
    return shop


@router.patch(
    "/{shop_id}",
    response_model=ShopOut,
    responses=error_responses(401, 403, 404, 412, 422),
    summary="Rename or archive a shop",
)
async def update_shop(
    shop_id: UUID,
    db: DbDep,
    caller: CallerDep,
    body: ShopUpdate,
    expected_version: IfMatchDep,
    response: Response,
) -> ShopOut:
    shop = await shop_service.update_shop(db, caller, shop_id, body, expected_version)
    response.headers["ETag"] = etag(shop.version)
    return shop
