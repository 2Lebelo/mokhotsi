import type { DeviceShop, Member } from "../db/device/repository.ts";
import { hmacSha256, toHex, utf8, type Sha256 } from "../lib/hmac.ts";

export type PinMatch = { shop: DeviceShop; member: Member };

/** HMAC-SHA256(shop pin_key, PIN), hex: what the server stores as the member's pin_tag. */
export async function pinTag(
  pinKey: Uint8Array,
  pin: string,
  sha256: Sha256,
): Promise<string> {
  return toHex(await hmacSha256(pinKey, utf8(pin), sha256));
}

/**
 * Who `pin` belongs to, offline: the tag is computed with each shop's key and looked up in
 * that shop's roster. One person, one shop is the usual answer; an owner of several shops
 * on this phone gets one match per shop and picks. A shop whose key is missing is skipped.
 */
export async function matchPin(
  pin: string,
  shops: readonly DeviceShop[],
  deps: {
    pinKey: (shopId: string) => Promise<Uint8Array | null>;
    memberByTag: (shopId: string, tag: string) => Member | null;
    sha256: Sha256;
  },
): Promise<PinMatch[]> {
  const matches: PinMatch[] = [];
  for (const shop of shops) {
    const key = await deps.pinKey(shop.id);
    if (!key) continue;
    const member = deps.memberByTag(shop.id, await pinTag(key, pin, deps.sha256));
    if (member) matches.push({ shop, member });
  }
  return matches;
}
