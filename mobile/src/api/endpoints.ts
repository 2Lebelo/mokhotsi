/** The API calls the app makes, typed from the contract. Screens call these, never `fetch`. */

import type { DeviceCredential } from "../auth/secrets.ts";
import type { Permission } from "../domain/permissions.ts";
import type { ApiClient } from "./client.ts";
import type {
  DeviceOut,
  MeOut,
  MemberOut,
  NewDevice,
  Page,
  PhotoConfirm,
  PhotoConfirmResponse,
  PhotoUpload,
  PhotoUploadsResponse,
  PhotoUrlsResponse,
  PullResponse,
  PushRequest,
  PushResponse,
  ReviewDecision,
  RosterOut,
  ShopOut,
  SnapshotEntity,
  SnapshotResponse,
  SyncIssueCount,
  SyncIssueIn,
  SyncIssueOut,
  SyncIssuesReported,
  TokenResponse,
  UserCreated,
  UserOut,
  UserStatus,
} from "./types.ts";

const V1 = "/api/v1";
const NO_RETRY = { auth: "none", retry: false } as const;

/** The phone signing in: its credential if it has one, else a description to register it. */
export type DeviceRef = DeviceCredential | NewDevice;

// --- Signing in -------------------------------------------------------------------------

export function register(
  api: ApiClient,
  body: { name: string; phone: string; pin: string; device: NewDevice },
) {
  return api.post<TokenResponse>(`${V1}/registrations`, body, NO_RETRY);
}

export function signInWithPin(api: ApiClient, phone: string, pin: string, device: DeviceRef) {
  return api.post<TokenResponse>(
    `${V1}/tokens`,
    { grant_type: "pin", phone, pin, device },
    NO_RETRY,
  );
}

export function signInOnDevice(
  api: ApiClient,
  credential: DeviceCredential,
  shopId: string,
  pin: string,
) {
  return api.post<TokenResponse>(
    `${V1}/tokens`,
    { grant_type: "device_pin", ...credential, shop_id: shopId, pin },
    NO_RETRY,
  );
}

export function signOut(api: ApiClient) {
  return api.delete(`${V1}/sessions/current`, { retry: false });
}

// --- The signed-in person ---------------------------------------------------------------

export function me(api: ApiClient) {
  return api.get<MeOut>(`${V1}/users/me`);
}

export function changeMyPin(api: ApiClient, currentPin: string, newPin: string) {
  return api.put<null>(`${V1}/users/me/pin`, {
    current_pin: currentPin,
    new_pin: newPin,
  });
}

// --- The phone --------------------------------------------------------------------------

/** 304 (null) when the roster is unchanged since `etag`. */
export async function roster(
  api: ApiClient,
  etag: string | null,
): Promise<{ roster: RosterOut; etag: string | null } | null> {
  const response = await api.request<RosterOut>("GET", `${V1}/devices/me/roster`, {
    auth: "device",
    headers: etag ? { "If-None-Match": etag } : undefined,
  });
  if (response.status === 304) return null;
  return { roster: response.data, etag: response.headers.get("etag") };
}

// --- Shops, staff and phones (owners) ---------------------------------------------------

export function myShops(api: ApiClient) {
  return api.get<Page<ShopOut>>(`${V1}/shops`, { query: { sort: "name", limit: 100 } });
}

export function createShop(api: ApiClient, name: string, pin: string) {
  return api.post<ShopOut>(`${V1}/shops`, { name, pin });
}

export function renameShop(api: ApiClient, shopId: string, name: string) {
  return api.patch<ShopOut>(`${V1}/shops/${shopId}`, { name });
}

export function claimShopData(api: ApiClient, shopId: string) {
  return api.put<{ device_id: string }>(`${V1}/shops/${shopId}/data-claim`);
}

export function members(api: ApiClient, shopId: string) {
  return api.get<Page<MemberOut>>(`${V1}/shops/${shopId}/members`, {
    query: { limit: 100 },
  });
}

export function addCashier(
  api: ApiClient,
  shopId: string,
  body: { name: string; pin: string; permissions: Permission[] },
) {
  return api.post<MemberOut>(`${V1}/shops/${shopId}/members`, body);
}

export function setCashierPermissions(
  api: ApiClient,
  shopId: string,
  userId: string,
  permissions: Permission[],
) {
  return api.patch<MemberOut>(`${V1}/shops/${shopId}/members/${userId}`, {
    permissions,
  });
}

export function setCashierPin(api: ApiClient, shopId: string, userId: string, pin: string) {
  return api.put<null>(`${V1}/shops/${shopId}/members/${userId}/pin`, { pin });
}

export function removeCashier(api: ApiClient, shopId: string, userId: string) {
  return api.delete(`${V1}/shops/${shopId}/members/${userId}`);
}

export function shopDevices(api: ApiClient, shopId: string) {
  return api.get<Page<DeviceOut>>(`${V1}/shops/${shopId}/devices`, {
    query: { limit: 100 },
  });
}

export function linkDevice(api: ApiClient, shopId: string, deviceId: string) {
  return api.put<DeviceOut>(`${V1}/shops/${shopId}/devices/${deviceId}`);
}

export function unlinkDevice(api: ApiClient, shopId: string, deviceId: string) {
  return api.delete(`${V1}/shops/${shopId}/devices/${deviceId}`);
}

export function revokeDevice(api: ApiClient, deviceId: string) {
  return api.delete(`${V1}/devices/${deviceId}`);
}

// --- System admin -----------------------------------------------------------------------

export function users(
  api: ApiClient,
  filters: {
    role?: "owner" | "system_admin";
    status?: UserStatus;
    q?: string;
    cursor?: string | null;
  },
) {
  return api.get<Page<UserOut>>(`${V1}/users`, { query: { ...filters, limit: 50 } });
}

export function user(api: ApiClient, userId: string) {
  return api.get<UserOut>(`${V1}/users/${userId}`);
}

export function reviewOwner(
  api: ApiClient,
  userId: string,
  decision: ReviewDecision,
  note: string | null,
) {
  return api.post<UserOut>(`${V1}/users/${userId}/reviews`, { decision, note });
}

export function setUserStatus(api: ApiClient, userId: string, status: "active" | "disabled") {
  return api.patch<UserOut>(`${V1}/users/${userId}`, { status });
}

export function resetUserPin(api: ApiClient, userId: string) {
  // Never retried: each attempt would issue a different temporary PIN.
  return api.post<{ temporary_pin: string }>(`${V1}/users/${userId}/pin-resets`, undefined, {
    retry: false,
  });
}

export function addOwner(api: ApiClient, name: string, phone: string) {
  return api.post<UserCreated>(
    `${V1}/users`,
    { name, phone, role: "owner" },
    { retry: false },
  );
}

export function ownerShops(api: ApiClient, ownerId: string) {
  return api.get<Page<ShopOut>>(`${V1}/shops`, {
    query: { owner_id: ownerId, sort: "name", limit: 100 },
  });
}

export function setShopStatus(api: ApiClient, shopId: string, status: "active" | "suspended") {
  return api.patch<ShopOut>(`${V1}/shops/${shopId}`, { status });
}

export function syncIssues(
  api: ApiClient,
  filters: { status: "open" | "resolved"; cursor?: string | null },
) {
  return api.get<Page<SyncIssueOut>>(`${V1}/sync-issues`, { query: { ...filters, limit: 50 } });
}

export function syncIssueCount(api: ApiClient) {
  return api.get<SyncIssueCount>(`${V1}/sync-issues/count`);
}

/** Idempotent on the server, so a retry after a lost response is safe. */
export function resolveSyncIssue(api: ApiClient, issueId: string) {
  return api.post<SyncIssueOut>(`${V1}/sync-issues/${issueId}/resolve`);
}

export function devicesOf(api: ApiClient, ownerId: string) {
  return api.get<Page<DeviceOut>>(`${V1}/devices`, {
    query: { registered_by: ownerId, limit: 100 },
  });
}

// --- Sync (the phone itself, with its device token) ---------------------------------------

const DEVICE = { auth: "device" } as const;

/** Push is idempotent by op id, so a lost response is simply sent again. */
export function syncPush(api: ApiClient, shopId: string, body: PushRequest) {
  return api.post<PushResponse>(`${V1}/shops/${shopId}/sync/push`, body, DEVICE);
}

export function syncPull(api: ApiClient, shopId: string, cursor: string, limit = 500) {
  return api.get<PullResponse>(`${V1}/shops/${shopId}/sync/pull`, {
    ...DEVICE,
    query: { cursor, limit },
  });
}

export function syncSnapshot(
  api: ApiClient,
  shopId: string,
  entity: SnapshotEntity,
  after: string | null,
  modelVersion: string,
  limit = 500,
) {
  return api.get<SnapshotResponse>(`${V1}/shops/${shopId}/sync/snapshot`, {
    ...DEVICE,
    query: {
      entity,
      after,
      limit,
      model_version: entity === "embeddings" ? modelVersion : undefined,
    },
  });
}

export function photoTickets(api: ApiClient, shopId: string, items: PhotoUpload[]) {
  return api.post<PhotoUploadsResponse>(
    `${V1}/shops/${shopId}/sync/photos/uploads`,
    { items },
    DEVICE,
  );
}

export function confirmPhotos(api: ApiClient, shopId: string, items: PhotoConfirm[]) {
  return api.post<PhotoConfirmResponse>(
    `${V1}/shops/${shopId}/sync/photos/confirm`,
    { items },
    DEVICE,
  );
}

export function photoUrls(api: ApiClient, shopId: string, sha256s: string[]) {
  return api.post<PhotoUrlsResponse>(
    `${V1}/shops/${shopId}/sync/photos/urls`,
    { sha256s },
    DEVICE,
  );
}

/** What this phone could not sync as asked; idempotent by issue id. */
export function reportSyncIssues(api: ApiClient, shopId: string, issues: SyncIssueIn[]) {
  return api.post<SyncIssuesReported>(`${V1}/shops/${shopId}/sync/issues`, { issues }, DEVICE);
}
