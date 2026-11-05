import type { DeviceShop, Member } from "../../db/device/repository.ts";
import type { FlushResult } from "../../sync/scheduler.ts";

/** The shops on this phone that `userId` may remove it from (devices:manage). */
export function shopsToLeave(
  shops: readonly DeviceShop[],
  member: (shopId: string, userId: string) => Member | null,
  userId: string,
): DeviceShop[] {
  return shops.filter((shop) =>
    member(shop.id, userId)?.permissions.includes("devices:manage"),
  );
}

export type SyncCheck =
  /** Everything those shops had on this phone reached the server. */
  | { kind: "clear" }
  /** `pending` changes are still on this phone (`unknown`: some shop could not be checked). */
  | { kind: "waiting"; pending: number; unknown: boolean };

/** What a flush says about the shops being left. */
export function checkSync(result: FlushResult, shopIds: readonly string[]): SyncCheck {
  let pending = 0;
  let unknown = false;
  for (const id of shopIds) {
    const run = result[id];
    if (run?.pending === undefined || run.state !== "synced") unknown = true;
    pending += run?.pending ?? 0;
  }
  return pending === 0 && !unknown ? { kind: "clear" } : { kind: "waiting", pending, unknown };
}

/** The sheet's words for a check. */
export function syncCheckText(check: SyncCheck): string {
  if (check.kind === "clear") return "Everything from this phone is on the server.";
  const kept = "They stay on this phone and are sent when it is set up for the shop again.";
  if (check.pending > 0) {
    const what = check.pending === 1 ? "1 change has" : `${check.pending} changes have`;
    return `${what} not reached the server yet. ${kept}`;
  }
  return `This phone could not reach the server, so some changes may not have been sent. ${kept}`;
}
