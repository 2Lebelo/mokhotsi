/** Friendly names for the API's types, generated from contracts/openapi.json (npm run api:types). */
import type { components } from "./schema.d.ts";

type Schemas = components["schemas"];

export type TokenResponse = Schemas["TokenResponse"];
export type TokenUser = Schemas["TokenUser"];
export type DeviceTokenResponse = Schemas["DeviceTokenResponse"];
export type IssuedDevice = Schemas["IssuedDevice"];
export type NewDevice = Schemas["NewDevice"];
export type MeOut = Schemas["MeOut"];
export type MyMembership = Schemas["MyMembership"];
export type UserOut = Schemas["UserOut"];
export type UserCreated = Schemas["UserCreated"];
export type UserStatus = UserOut["status"];
export type ShopOut = Schemas["ShopOut"];
export type MemberOut = Schemas["MemberOut"];
export type DeviceOut = Schemas["DeviceOut"];
export type RosterOut = Schemas["RosterOut"];
export type RosterShop = Schemas["RosterShop"];
export type RosterMember = Schemas["RosterMember"];
export type ReviewDecision = Schemas["ReviewCreate"]["decision"];

// Sync (contracts/sync.v2.schema.json) and photo storage.
export type PushRequest = Schemas["PushRequest"];
export type PushResponse = Schemas["PushResponse"];
export type PullResponse = Schemas["PullResponse"];
export type SnapshotResponse = Schemas["SnapshotResponse"];
export type SnapshotEntity = SnapshotResponse["entity"];
export type PhotoUpload = Schemas["PhotoUpload"];
export type PhotoUploadsResponse = Schemas["PhotoUploadsResponse"];
export type PhotoConfirm = Schemas["PhotoConfirm"];
export type PhotoConfirmResponse = Schemas["PhotoConfirmResponse"];
export type PhotoUrlsResponse = Schemas["PhotoUrlsResponse"];
export type SyncIssueIn = Schemas["SyncIssueIn"];
export type SyncIssuesReported = Schemas["SyncIssuesReported"];
export type SyncIssueOut = Schemas["SyncIssueOut"];
export type SyncIssueCount = Schemas["SyncIssueCount"];

/** Every list endpoint: keyset pages with an opaque cursor. */
export type Page<T> = {
  data: T[];
  page: { next_cursor: string | null; limit: number };
};
