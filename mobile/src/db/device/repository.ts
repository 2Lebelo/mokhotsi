import type { SQLiteDatabase } from "expo-sqlite";

import type { RosterOut, TokenUser } from "../../api/types.ts";
import type { LockoutState } from "../../auth/lockout.ts";
import { isPermission, type Permission } from "../../domain/permissions.ts";
import type { RememberedCameraMode } from "../../features/vision/camera-ladder.ts";
import { DATABASE_NAME, shopDatabaseName } from "../schema.ts";

export type ShopStatus = "active" | "suspended";

export type DeviceShop = {
  id: string;
  name: string;
  status: ShopStatus;
  rosterVersion: number;
  dataClaimedByDevice: string | null;
};

export type Member = {
  shopId: string;
  userId: string;
  name: string;
  role: "owner" | "cashier";
  permissions: Permission[];
  pinTag: string | null;
  mustChangePin: boolean;
};

/** The person signed in online on this phone (owner or admin), as the server last said. */
export type Account = Pick<
  TokenUser,
  "id" | "name" | "phone" | "role" | "status" | "must_change_pin"
>;

type MemberRow = {
  shop_id: string;
  user_id: string;
  name: string;
  role: "owner" | "cashier";
  permissions: string;
  pin_tag: string | null;
  must_change_pin: number;
};

type ShopRow = {
  id: string;
  name: string;
  status: ShopStatus;
  roster_version: number;
  data_claimed_by_device: string | null;
};

function toMember(row: MemberRow): Member {
  const granted = JSON.parse(row.permissions) as string[];
  return {
    shopId: row.shop_id,
    userId: row.user_id,
    name: row.name,
    role: row.role,
    permissions: granted.filter(isPermission),
    pinTag: row.pin_tag,
    mustChangePin: row.must_change_pin === 1,
  };
}

function toShop(row: ShopRow): DeviceShop {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    rosterVersion: row.roster_version,
    dataClaimedByDevice: row.data_claimed_by_device,
  };
}

/**
 * Everything this phone keeps about itself in device.db (see migrations.ts). Synchronous like
 * the shop store, so the lock screen and the root layout read it without waiting.
 */
export class DeviceRepository {
  private db: SQLiteDatabase;

  constructor(db: SQLiteDatabase) {
    this.db = db;
  }

  private read(key: string): string | null {
    return (
      this.db.getFirstSync<{ value: string }>(
        "SELECT value FROM device_state WHERE key = ?",
        key,
      )?.value ?? null
    );
  }

  private write(key: string, value: string | null): void {
    if (value === null)
      this.db.runSync("DELETE FROM device_state WHERE key = ?", key);
    else
      this.db.runSync(
        "INSERT INTO device_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
  }

  /** The id this phone registered under; null until someone signs in or registers on it. */
  deviceId(): string | null {
    return this.read("device_id");
  }

  setDeviceId(deviceId: string): void {
    this.db.withTransactionSync(() => {
      this.write("device_id", deviceId);
      this.write("revoked", null);
    });
  }

  /** The phone was revoked by its owner or the admin: its credential no longer works. */
  isRevoked(): boolean {
    return this.read("revoked") === "1";
  }

  markRevoked(): void {
    this.db.withTransactionSync(() => {
      this.write("revoked", "1");
      this.write("roster_etag", null);
      this.db.runSync("DELETE FROM roster_members");
      this.db.runSync("DELETE FROM device_shops");
    });
  }

  /** How the identify camera last worked on this phone (see features/vision/camera-ladder). */
  visionCameraMode(): RememberedCameraMode | null {
    const raw = this.read("vision_camera_mode");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RememberedCameraMode;
    } catch {
      return null;
    }
  }

  setVisionCameraMode(value: RememberedCameraMode): void {
    this.write("vision_camera_mode", JSON.stringify(value));
  }

  account(): Account | null {
    const raw = this.read("account");
    return raw ? (JSON.parse(raw) as Account) : null;
  }

  setAccount(account: Account | null): void {
    this.write(
      "account",
      account &&
        JSON.stringify({
          id: account.id,
          name: account.name,
          phone: account.phone,
          role: account.role,
          status: account.status,
          must_change_pin: account.must_change_pin,
        } satisfies Account),
    );
  }

  shops(): DeviceShop[] {
    return this.db
      .getAllSync<ShopRow>(
        "SELECT id, name, status, roster_version, data_claimed_by_device FROM device_shops ORDER BY position",
      )
      .map(toShop);
  }

  shop(shopId: string): DeviceShop | null {
    const row = this.db.getFirstSync<ShopRow>(
      "SELECT id, name, status, roster_version, data_claimed_by_device FROM device_shops WHERE id = ?",
      shopId,
    );
    return row ? toShop(row) : null;
  }

  members(shopId: string): Member[] {
    return this.db
      .getAllSync<MemberRow>(
        "SELECT * FROM roster_members WHERE shop_id = ? ORDER BY name COLLATE NOCASE",
        shopId,
      )
      .map(toMember);
  }

  member(shopId: string, userId: string): Member | null {
    const row = this.db.getFirstSync<MemberRow>(
      "SELECT * FROM roster_members WHERE shop_id = ? AND user_id = ?",
      shopId,
      userId,
    );
    return row ? toMember(row) : null;
  }

  /** Who in the shop has this PIN tag (unique per shop on the server). */
  memberByTag(shopId: string, pinTag: string): Member | null {
    const row = this.db.getFirstSync<MemberRow>(
      "SELECT * FROM roster_members WHERE shop_id = ? AND pin_tag = ?",
      shopId,
      pinTag,
    );
    return row ? toMember(row) : null;
  }

  rosterEtag(): string | null {
    return this.read("roster_etag");
  }

  /** When the roster was last confirmed with the server (epoch ms). */
  rosterCheckedAt(): number | null {
    const raw = this.read("roster_checked_at");
    return raw === null ? null : Number(raw);
  }

  markRosterChecked(now: number): void {
    this.write("roster_checked_at", String(now));
  }

  /**
   * Replace the roster with the server's, in one transaction. A shop that left the roster
   * takes its members with it; its data file stays, unused.
   *
   * If the server says this phone holds a shop's data claim but the phone never recorded it
   * (it stopped between the two), the claim is recorded now: the step can't be lost.
   */
  applyRoster(roster: RosterOut, etag: string | null, now: number): void {
    this.db.withTransactionSync(() => {
      const ids = roster.shops.map((shop) => shop.id);
      const placeholders = ids.map(() => "?").join(", ");
      // Explicit rather than by cascade: it must not depend on the connection's pragmas.
      for (const table of ["roster_members", "device_shops"] as const) {
        const column = table === "device_shops" ? "id" : "shop_id";
        this.db.runSync(
          ids.length
            ? `DELETE FROM ${table} WHERE ${column} NOT IN (${placeholders})`
            : `DELETE FROM ${table}`,
          ...ids,
        );
      }
      roster.shops.forEach((shop, position) => {
        this.db.runSync(
          `INSERT INTO device_shops (id, name, status, roster_version, data_claimed_by_device, position)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, status = excluded.status,
             roster_version = excluded.roster_version,
             data_claimed_by_device = excluded.data_claimed_by_device, position = excluded.position`,
          shop.id,
          shop.name,
          shop.status,
          shop.roster_version,
          shop.data_claimed_by_device,
          position,
        );
        this.db.runSync("DELETE FROM roster_members WHERE shop_id = ?", shop.id);
        for (const member of shop.members)
          this.db.runSync(
            `INSERT INTO roster_members (shop_id, user_id, name, role, permissions, pin_tag, must_change_pin)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            shop.id,
            member.user_id,
            member.name,
            member.role,
            JSON.stringify(member.permissions),
            member.pin_tag,
            member.must_change_pin ? 1 : 0,
          );
        if (
          shop.data_claimed_by_device === roster.device_id &&
          this.claimedShopId() === null
        )
          this.recordClaim(shop.id);
      });
      this.write("roster_etag", etag);
      this.write("roster_checked_at", String(now));
      if (roster.shops.length) this.write("signed_out", null);
    });
  }

  /** The shop that took over this phone's original data file, if one did. */
  claimedShopId(): string | null {
    return (
      this.db.getFirstSync<{ shop_id: string }>(
        "SELECT shop_id FROM shop_files WHERE db_name = ?",
        DATABASE_NAME,
      )?.shop_id ?? null
    );
  }

  /** The original file now holds `shopId`'s data. Once only: the file has one owner. */
  recordClaim(shopId: string): void {
    const claimed = this.claimedShopId();
    if (claimed === shopId) return;
    if (claimed !== null)
      throw new Error("This phone's data already belongs to another shop.");
    this.db.runSync(
      "INSERT INTO shop_files (shop_id, db_name) VALUES (?, ?) ON CONFLICT (shop_id) DO UPDATE SET db_name = excluded.db_name",
      shopId,
      DATABASE_NAME,
    );
  }

  /** The SQLite file for the shop's data (assigned the first time it is asked for). */
  databaseFor(shopId: string): string {
    const known = this.db.getFirstSync<{ db_name: string }>(
      "SELECT db_name FROM shop_files WHERE shop_id = ?",
      shopId,
    )?.db_name;
    if (known) return known;
    const name = shopDatabaseName(shopId);
    this.db.runSync(
      "INSERT INTO shop_files (shop_id, db_name) VALUES (?, ?)",
      shopId,
      name,
    );
    return name;
  }

  hasShops(): boolean {
    return this.db.getFirstSync("SELECT 1 FROM device_shops LIMIT 1") !== null;
  }

  /**
   * The phone served a shop but has none now: it was blocked, or removed from its shop. Its
   * data stays on it, locked, until the owner sets it up again.
   */
  wasRemoved(): boolean {
    return !this.hasShops() && (this.isRevoked() || this.claimedShopId() !== null);
  }

  /** The owner signed this phone out of their shops (see SignOutPhoneSheet). */
  wasSignedOut(): boolean {
    return !this.hasShops() && this.read("signed_out") === "1";
  }

  markSignedOut(): void {
    this.write("signed_out", "1");
  }

  lockout(): LockoutState {
    const row = this.db.getFirstSync<{
      failures: number;
      lockouts: number;
      locked_until: number | null;
    }>("SELECT failures, lockouts, locked_until FROM pin_lockout WHERE id = 1");
    return {
      failures: row?.failures ?? 0,
      lockouts: row?.lockouts ?? 0,
      lockedUntil: row?.locked_until ?? null,
    };
  }

  saveLockout(state: LockoutState): void {
    this.db.runSync(
      "UPDATE pin_lockout SET failures = ?, lockouts = ?, locked_until = ? WHERE id = 1",
      state.failures,
      state.lockouts,
      state.lockedUntil,
    );
  }
}
