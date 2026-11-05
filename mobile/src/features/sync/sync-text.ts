import type { ShopSyncStatus } from "../../sync/scheduler.ts";

function changes(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `on ${new Date(iso).toLocaleDateString()}`;
}

/** One line for the menu: is this shop's data safe on the server? */
export function syncStatusText(status: ShopSyncStatus | null, now = Date.now()): string {
  if (!status) return "Checking…";
  const waiting = status.pending > 0 ? ` · ${changes(status.pending)} waiting` : "";
  switch (status.state) {
    case "syncing":
      return "Syncing…";
    case "offline":
      return `Offline${waiting}`;
    case "update_required":
      return "Update the app to keep syncing";
    case "paused":
      return `Shop suspended${waiting}`;
    case "revoked":
      return "This phone no longer syncs with the shop";
    case "error":
      return `Sync failed, retrying soon${waiting}`;
    default:
      if (status.pending > 0) return `${changes(status.pending)} waiting to sync`;
      return status.lastSyncedAt ? `Synced ${ago(status.lastSyncedAt, now)}` : "Up to date";
  }
}
