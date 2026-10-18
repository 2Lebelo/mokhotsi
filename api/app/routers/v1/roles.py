from fastapi import APIRouter

from app.core.deps import CallerDep
from app.core.errors import error_responses
from app.core.pagination import Page, make_page
from app.core.permissions import (
    KEEPER_SHOP_PERMISSIONS,
    PERMISSION_DESCRIPTIONS,
    ROLE_DESCRIPTIONS,
    SITTER_DEFAULTS,
    SITTER_GRANTABLE,
    SYSTEM_PERMISSIONS,
    Perm,
    Role,
)
from app.schemas.audit import PermissionOut, RoleOut

router = APIRouter(tags=["roles"])

_SYSTEM_SCOPE = frozenset().union(*SYSTEM_PERMISSIONS.values())

_ROLES = [
    RoleOut(
        name=role,
        description=ROLE_DESCRIPTIONS[role],
        system_permissions=sorted(SYSTEM_PERMISSIONS[role]),
        default_shop_permissions=sorted(
            {Role.SHOP_KEEPER: KEEPER_SHOP_PERMISSIONS, Role.SHOP_SITTER: SITTER_DEFAULTS}.get(
                role, frozenset()
            )
        ),
        grantable_shop_permissions=sorted(SITTER_GRANTABLE) if role is Role.SHOP_SITTER else [],
    )
    for role in Role
]
_PERMISSIONS = [
    PermissionOut(
        name=p,
        scope="system" if p in _SYSTEM_SCOPE else "shop",
        description=PERMISSION_DESCRIPTIONS[p],
    )
    for p in Perm
]


@router.get(
    "/roles",
    response_model=Page[RoleOut],
    responses=error_responses(401, 403),
    summary="The fixed roles and what each can do",
)
async def list_roles(_: CallerDep) -> Page[RoleOut]:
    return make_page(_ROLES, None, len(_ROLES))


@router.get(
    "/permissions",
    response_model=Page[PermissionOut],
    responses=error_responses(401, 403),
    summary="Every permission, with its scope",
)
async def list_permissions(_: CallerDep) -> Page[PermissionOut]:
    return make_page(_PERMISSIONS, None, len(_PERMISSIONS))
