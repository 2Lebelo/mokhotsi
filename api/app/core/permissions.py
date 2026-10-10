"""Roles and permissions. Code checks permissions, never role names (except to derive them here).

Two layers:
- System permissions come from the user's role (users, shops, the global audit log).
- Shop permissions come from the caller's membership in the shop named in the path. Keepers get
  every shop permission; sitters get SITTER_DEFAULTS plus whatever the keeper granted from
  SITTER_GRANTABLE.
"""

from enum import StrEnum


class Role(StrEnum):
    SYSTEM_ADMIN = "system_admin"
    SHOP_KEEPER = "shop_keeper"
    SHOP_SITTER = "shop_sitter"


class MemberRole(StrEnum):
    KEEPER = "keeper"
    SITTER = "sitter"


class Perm(StrEnum):
    # System scope.
    USERS_READ = "users:read"
    USERS_WRITE = "users:write"
    SHOPS_READ_ALL = "shops:read_all"
    SHOPS_WRITE_ALL = "shops:write_all"
    SHOPS_CREATE_OWN = "shops:create_own"
    AUDIT_LOGS_READ_ALL = "audit_logs:read_all"

    # Shop scope.
    SHOP_MANAGE = "shop:manage"
    MEMBERS_READ = "members:read"
    MEMBERS_MANAGE = "members:manage"
    AUDIT_LOGS_READ = "audit_logs:read"
    CATALOGUE_READ = "catalogue:read"
    CATALOGUE_WRITE = "catalogue:write"
    STOCK_WRITE = "stock:write"
    SALES_CREATE = "sales:create"
    SALES_READ = "sales:read"
    SALES_REFUND = "sales:refund"
    REPORTS_READ = "reports:read"


SYSTEM_PERMISSIONS: dict[Role, frozenset[Perm]] = {
    Role.SYSTEM_ADMIN: frozenset(
        {
            Perm.USERS_READ,
            Perm.USERS_WRITE,
            Perm.SHOPS_READ_ALL,
            Perm.SHOPS_WRITE_ALL,
            Perm.AUDIT_LOGS_READ_ALL,
        }
    ),
    Role.SHOP_KEEPER: frozenset({Perm.SHOPS_CREATE_OWN}),
    Role.SHOP_SITTER: frozenset(),
}

KEEPER_SHOP_PERMISSIONS: frozenset[Perm] = frozenset(
    {
        Perm.SHOP_MANAGE,
        Perm.MEMBERS_READ,
        Perm.MEMBERS_MANAGE,
        Perm.AUDIT_LOGS_READ,
        Perm.CATALOGUE_READ,
        Perm.CATALOGUE_WRITE,
        Perm.STOCK_WRITE,
        Perm.SALES_CREATE,
        Perm.SALES_READ,
        Perm.SALES_REFUND,
        Perm.REPORTS_READ,
    }
)
SITTER_DEFAULTS: frozenset[Perm] = frozenset({Perm.CATALOGUE_READ, Perm.SALES_CREATE})
SITTER_GRANTABLE: frozenset[Perm] = frozenset(
    {Perm.SALES_READ, Perm.CATALOGUE_WRITE, Perm.STOCK_WRITE, Perm.SALES_REFUND, Perm.REPORTS_READ}
)

# Read-only shop permissions a system admin has on every shop (support and oversight).
ADMIN_SHOP_OVERSIGHT: frozenset[Perm] = frozenset({Perm.MEMBERS_READ, Perm.AUDIT_LOGS_READ})

ROLE_DESCRIPTIONS: dict[Role, str] = {
    Role.SYSTEM_ADMIN: "Creates users and shops and sees every audit log. Does not operate shops.",
    Role.SHOP_KEEPER: "Owns one or more shops: catalogue, stock, sales, reports and sitters.",
    Role.SHOP_SITTER: "Sells in one shop. Extra privileges are granted per sitter by the keeper.",
}

PERMISSION_DESCRIPTIONS: dict[Perm, str] = {
    Perm.USERS_READ: "List and view users",
    Perm.USERS_WRITE: "Create, update, deactivate users and reset their passwords",
    Perm.SHOPS_READ_ALL: "View every shop",
    Perm.SHOPS_WRITE_ALL: "Create and update any shop",
    Perm.SHOPS_CREATE_OWN: "Create shops owned by yourself",
    Perm.AUDIT_LOGS_READ_ALL: "View the system-wide audit log",
    Perm.SHOP_MANAGE: "Rename or archive the shop",
    Perm.MEMBERS_READ: "View the shop's team",
    Perm.MEMBERS_MANAGE: "Create sitters, change their privileges, remove them",
    Perm.AUDIT_LOGS_READ: "View the shop's activity log",
    Perm.CATALOGUE_READ: "View items and categories",
    Perm.CATALOGUE_WRITE: "Create, edit and delete items and categories",
    Perm.STOCK_WRITE: "Record restocks, damage, losses and stock counts",
    Perm.SALES_CREATE: "Sell",
    Perm.SALES_READ: "View all sales in the shop",
    Perm.SALES_REFUND: "Refund or void sales",
    Perm.REPORTS_READ: "View profit and loss and other reports",
}


def shop_permissions(member_role: MemberRole, granted: list[str]) -> frozenset[Perm]:
    if member_role is MemberRole.KEEPER:
        return KEEPER_SHOP_PERMISSIONS
    return SITTER_DEFAULTS | {Perm(p) for p in granted if p in SITTER_GRANTABLE}
