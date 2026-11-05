import { fromBase64 } from "../lib/hmac.ts";
import { parseSavedUnlock, type SavedUnlock } from "./resume.ts";

/** The phone's keystore, behind an interface so node tests can use memory. See secure.ts. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type DeviceCredential = { device_id: string; device_secret: string };

const CREDENTIAL = "device.credential";
const REFRESH = "session.refresh";
const UNLOCKED = "session.unlocked";
const pinKeyName = (shopId: string) => `shop.${shopId}.pinkey`;

/**
 * The secrets a registered phone holds: its own credential, each shop's PIN key, and the
 * refresh token of a personal phone's session, plus who unlocked the till (see resume.ts).
 * None of them is ever written to SQLite or logs.
 * PIN keys are cached in memory once read, so the lock screen checks a PIN without waiting
 * on the keystore.
 */
export class Secrets {
  private store: KeyValueStore;
  private keys = new Map<string, Uint8Array>();

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async deviceCredential(): Promise<DeviceCredential | null> {
    const raw = await this.store.get(CREDENTIAL);
    return raw ? (JSON.parse(raw) as DeviceCredential) : null;
  }

  async setDeviceCredential(credential: DeviceCredential): Promise<void> {
    await this.store.set(CREDENTIAL, JSON.stringify(credential));
  }

  async pinKey(shopId: string): Promise<Uint8Array | null> {
    const cached = this.keys.get(shopId);
    if (cached) return cached;
    const raw = await this.store.get(pinKeyName(shopId));
    if (!raw) return null;
    const key = fromBase64(raw);
    this.keys.set(shopId, key);
    return key;
  }

  async setPinKey(shopId: string, base64: string): Promise<void> {
    await this.store.set(pinKeyName(shopId), base64);
    this.keys.set(shopId, fromBase64(base64));
  }

  async deletePinKey(shopId: string): Promise<void> {
    this.keys.delete(shopId);
    await this.store.delete(pinKeyName(shopId));
  }

  async refreshToken(): Promise<string | null> {
    return this.store.get(REFRESH);
  }

  async setRefreshToken(token: string | null): Promise<void> {
    if (token === null) await this.store.delete(REFRESH);
    else await this.store.set(REFRESH, token);
  }

  async unlocked(): Promise<SavedUnlock | null> {
    return parseSavedUnlock(await this.store.get(UNLOCKED));
  }

  async setUnlocked(value: SavedUnlock | null): Promise<void> {
    if (value === null) await this.store.delete(UNLOCKED);
    else await this.store.set(UNLOCKED, JSON.stringify(value));
  }
}

export class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
  }

  async delete(key: string) {
    this.values.delete(key);
  }
}
