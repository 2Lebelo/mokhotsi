/**
 * Resuming the till after Android killed the app (low memory, a crash). Without it, every
 * restart lands on the PIN pad, even seconds after the cashier last touched the phone.
 *
 * Who is at the till is kept in the keystore with the time of their last activity. Within
 * RESUME_WINDOW_MS of it the phone opens straight on the till again; after that, or when the
 * person or shop is gone from the roster, it shows the PIN pad as usual. The idle lock still
 * counts from that last activity.
 */

export const RESUME_WINDOW_MS = 2 * 60_000;

export type SavedUnlock = { shopId: string; userId: string; at: number };

export function parseSavedUnlock(raw: string | null): SavedUnlock | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedUnlock>;
    if (
      typeof value.shopId === "string" &&
      typeof value.userId === "string" &&
      typeof value.at === "number" &&
      Number.isFinite(value.at)
    )
      return { shopId: value.shopId, userId: value.userId, at: value.at };
  } catch {
    // A corrupt entry just means no resume.
  }
  return null;
}

/** Whether `saved` may reopen the till at `now` (`isMember` reads the current roster). */
export function canResume(
  saved: SavedUnlock | null,
  now: number,
  isMember: (shopId: string, userId: string) => boolean,
): saved is SavedUnlock {
  if (!saved) return false;
  const elapsed = now - saved.at;
  // A clock set backwards must not stretch the window.
  if (elapsed < 0 || elapsed >= RESUME_WINDOW_MS) return false;
  return isMember(saved.shopId, saved.userId);
}
