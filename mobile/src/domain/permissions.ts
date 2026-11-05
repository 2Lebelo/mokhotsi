/**
 * Shop permissions (contracts/permissions.json; tests check this copy against it). Code checks
 * permissions, never role names: see `can()` in the session.
 */

export const SHOP_PERMISSIONS = {
  "shop:manage": "Rename the shop",
  "members:read": "View the shop's team",
  "members:manage": "Create cashiers, set their PINs and permissions, remove them",
  "devices:manage": "Register and revoke the shop's phones",
  "audit_logs:read": "View the shop's activity log",
  "catalogue:read": "View items and categories",
  "catalogue:write": "Create and edit items and categories",
  "stock:write": "Record restocks, damage, losses and stock counts",
  "costs:read": "See cost prices, profit and margins",
  "sales:create": "Sell",
  "sales:read": "View every sale in the shop, not only your own",
  "sales:refund": "Reverse sales",
  "reports:read": "View reports",
} as const;

export type Permission = keyof typeof SHOP_PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(SHOP_PERMISSIONS) as Permission[];

export const CASHIER_DEFAULTS: readonly Permission[] = [
  "catalogue:read",
  "sales:create",
];

/** What an owner may grant a cashier, in the order the toggles are shown. */
export const CASHIER_GRANTABLE = [
  "sales:read",
  "sales:refund",
  "catalogue:write",
  "stock:write",
  "costs:read",
  "reports:read",
] as const satisfies readonly Permission[];

export type Grantable = (typeof CASHIER_GRANTABLE)[number];

/** Short labels for the owner's toggles; the description says the rest. */
export const GRANT_LABELS: Record<Grantable, string> = {
  "sales:read": "See all sales",
  "sales:refund": "Reverse sales",
  "catalogue:write": "Edit items",
  "stock:write": "Change stock",
  "costs:read": "See costs and profit",
  "reports:read": "See reports",
};

export function isGrantable(value: string): value is Grantable {
  return (CASHIER_GRANTABLE as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return value in SHOP_PERMISSIONS;
}
