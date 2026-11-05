"""Roles and permissions. Code checks permissions, never role names (except to derive them here).

Two layers:
- System permissions come from the user's role (users, shops, the global audit log).
- Shop permissions come from the caller's membership in the shop named in the path. Owners get
  every shop permission; cashiers get CASHIER_DEFAULTS plus whatever the owner granted from
  CASHIER_GRANTABLE.

This module is the source of truth. The `roles` collection mirrors it (synced at startup, see
app.repositories.roles) and `contracts/permissions.json` must match it (checked by the tests).
"""

from enum import StrEnum


class Role(StrEnum):
    SYSTEM_ADMIN = "system_admin"
    OWNER = "owner"
    CASHIER = "cashier"


class MemberRole(StrEnum):
    OWNER = "owner"
    CASHIER = "cashier"


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
    DEVICES_MANAGE = "devices:manage"
    AUDIT_LOGS_READ = "audit_logs:read"
    CATALOGUE_READ = "catalogue:read"
    CATALOGUE_WRITE = "catalogue:write"
    STOCK_WRITE = "stock:write"
    COSTS_READ = "costs:read"
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
    Role.OWNER: frozenset({Perm.SHOPS_CREATE_OWN}),
    Role.CASHIER: frozenset(),
}

SYSTEM_SCOPE: frozenset[Perm] = frozenset().union(*SYSTEM_PERMISSIONS.values())
SHOP_SCOPE: frozenset[Perm] = frozenset(Perm) - SYSTEM_SCOPE

OWNER_SHOP_PERMISSIONS: frozenset[Perm] = SHOP_SCOPE
CASHIER_DEFAULTS: frozenset[Perm] = frozenset({Perm.CATALOGUE_READ, Perm.SALES_CREATE})
CASHIER_GRANTABLE: frozenset[Perm] = frozenset(
    {
        Perm.SALES_READ,
        Perm.SALES_REFUND,
        Perm.CATALOGUE_WRITE,
        Perm.STOCK_WRITE,
        Perm.COSTS_READ,
        Perm.REPORTS_READ,
    }
)

# Read-only shop permissions a system admin has on every shop (support and oversight).
ADMIN_SHOP_OVERSIGHT: frozenset[Perm] = frozenset({Perm.MEMBERS_READ, Perm.AUDIT_LOGS_READ})

# What still works in a suspended shop: looking, never changing. The admin lifts a suspension.
SUSPENDED_SHOP_ALLOWED: frozenset[Perm] = frozenset(
    {
        Perm.MEMBERS_READ,
        Perm.AUDIT_LOGS_READ,
        Perm.CATALOGUE_READ,
        Perm.COSTS_READ,
        Perm.SALES_READ,
        Perm.REPORTS_READ,
    }
)

# The shop permissions a role starts with in a shop it belongs to (none for the admin).
ROLE_SHOP_DEFAULTS: dict[Role, frozenset[Perm]] = {
    Role.SYSTEM_ADMIN: frozenset(),
    Role.OWNER: OWNER_SHOP_PERMISSIONS,
    Role.CASHIER: CASHIER_DEFAULTS,
}
ROLE_SHOP_GRANTABLE: dict[Role, frozenset[Perm]] = {
    Role.SYSTEM_ADMIN: frozenset(),
    Role.OWNER: frozenset(),
    Role.CASHIER: CASHIER_GRANTABLE,
}

ROLE_NAMES: dict[Role, str] = {
    Role.SYSTEM_ADMIN: "System admin",
    Role.OWNER: "Owner",
    Role.CASHIER: "Cashier",
}

ROLE_DESCRIPTIONS: dict[Role, str] = {
    Role.SYSTEM_ADMIN: (
        "Approves new owners; manages owners, shops, users and devices; reads every audit log. "
        "Always online. Does not sell."
    ),
    Role.OWNER: "Owns one or more shops: catalogue, stock, sales, reports, cashiers and devices.",
    Role.CASHIER: "Sells in one shop. Extra permissions are granted per cashier by the owner.",
}

PERMISSION_DESCRIPTIONS: dict[Perm, str] = {
    Perm.USERS_READ: "List and view users",
    Perm.USERS_WRITE: "Approve owners, create, update and deactivate users, reset their PINs",
    Perm.SHOPS_READ_ALL: "View every shop",
    Perm.SHOPS_WRITE_ALL: "Suspend and reactivate any shop",
    Perm.SHOPS_CREATE_OWN: "Create shops owned by yourself",
    Perm.AUDIT_LOGS_READ_ALL: "View the system-wide audit log",
    Perm.SHOP_MANAGE: "Rename the shop",
    Perm.MEMBERS_READ: "View the shop's team",
    Perm.MEMBERS_MANAGE: "Create cashiers, set their PINs and permissions, remove them",
    Perm.DEVICES_MANAGE: "Register and revoke the shop's phones",
    Perm.AUDIT_LOGS_READ: "View the shop's activity log",
    Perm.CATALOGUE_READ: "View items and categories",
    Perm.CATALOGUE_WRITE: "Create and edit items and categories",
    Perm.STOCK_WRITE: "Record restocks, damage, losses and stock counts",
    Perm.COSTS_READ: "See cost prices, profit and margins",
    Perm.SALES_CREATE: "Sell",
    Perm.SALES_READ: "View every sale in the shop, not only your own",
    Perm.SALES_REFUND: "Reverse sales",
    Perm.REPORTS_READ: "View reports",
}


def shop_permissions(member_role: MemberRole, granted: list[str]) -> frozenset[Perm]:
    if member_role is MemberRole.OWNER:
        return OWNER_SHOP_PERMISSIONS
    return CASHIER_DEFAULTS | {Perm(p) for p in granted if p in CASHIER_GRANTABLE}
