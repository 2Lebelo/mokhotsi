/**
 * SQLite stores epoch milliseconds; the wire format uses ISO 8601 UTC strings. Both are
 * informational only: sync order always comes from the server's per-shop `seq`.
 */
export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Throws on an unparseable timestamp so a malformed pull page fails as a whole. */
export function isoToMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new TypeError(`invalid timestamp: ${iso}`);
  return ms;
}
