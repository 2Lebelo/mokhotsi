import type { ApiClient } from "../api/client.ts";
import { ApiError, isOffline } from "../api/client.ts";
import { roster as fetchRoster } from "../api/endpoints.ts";
import type { Secrets } from "../auth/secrets.ts";
import type { DeviceRepository } from "../db/device/repository.ts";

export type RosterResult =
  | "updated"
  | "unchanged"
  | "offline"
  | "unregistered"
  | "revoked";

/**
 * Keeps the phone's roster (who may sign in, with which PIN tag) in step with the server.
 * Single-flight: overlapping triggers (start, foreground, network back, after a change) share
 * one request. Cheap to call often: an unchanged roster is a 304.
 *
 * Keys go to the keystore before the roster is committed, so a crash in between leaves at
 * worst an unused key, never a roster whose tags cannot be checked.
 */
export class RosterSync {
  private api: ApiClient;
  private device: DeviceRepository;
  private secrets: Secrets;
  private now: () => number;
  private running: Promise<RosterResult> | null = null;

  constructor(deps: {
    api: ApiClient;
    device: DeviceRepository;
    secrets: Secrets;
    now?: () => number;
  }) {
    this.api = deps.api;
    this.device = deps.device;
    this.secrets = deps.secrets;
    this.now = deps.now ?? Date.now;
  }

  refresh(): Promise<RosterResult> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<RosterResult> {
    if (this.device.deviceId() === null) return "unregistered";
    const before = this.device.shops().map((shop) => shop.id);
    try {
      const result = await fetchRoster(this.api, this.device.rosterEtag());
      if (result === null) {
        this.device.markRosterChecked(this.now());
        return "unchanged";
      }
      for (const shop of result.roster.shops)
        await this.secrets.setPinKey(shop.id, shop.pin_key);
      this.device.applyRoster(result.roster, result.etag, this.now());
      const kept = new Set(result.roster.shops.map((shop) => shop.id));
      for (const id of before)
        if (!kept.has(id)) await this.secrets.deletePinKey(id);
      return "updated";
    } catch (error) {
      if (isOffline(error)) return "offline";
      if (
        error instanceof ApiError &&
        (error.code === "device_revoked" || error.code === "invalid_device")
      ) {
        this.device.markRevoked();
        for (const id of before) await this.secrets.deletePinKey(id);
        return "revoked";
      }
      throw error;
    }
  }
}
