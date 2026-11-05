from fastapi import APIRouter

from app.core.deps import CallerDep, DbDep
from app.core.errors import error_responses
from app.core.pagination import Page, make_page
from app.core.permissions import PERMISSION_DESCRIPTIONS, SYSTEM_SCOPE, Perm
from app.schemas.audit import PermissionOut, RoleOut
from app.services import role_service

router = APIRouter(tags=["roles"])

_PERMISSIONS = [
    PermissionOut(
        name=p,
        scope="system" if p in SYSTEM_SCOPE else "shop",
        description=PERMISSION_DESCRIPTIONS[p],
    )
    for p in Perm
]


@router.get(
    "/roles",
    response_model=Page[RoleOut],
    responses=error_responses(401, 403),
    summary="The roles and what each can do",
)
async def list_roles(_: CallerDep, db: DbDep) -> Page[RoleOut]:
    items = await role_service.list_roles(db)
    return make_page(items, None, len(items))


@router.get(
    "/permissions",
    response_model=Page[PermissionOut],
    responses=error_responses(401, 403),
    summary="Every permission, with its scope",
)
async def list_permissions(_: CallerDep) -> Page[PermissionOut]:
    return make_page(_PERMISSIONS, None, len(_PERMISSIONS))
