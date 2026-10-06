export type Attempt<T> = { ok: true; value: T } | { ok: false; error: Error };

/** Run `fn`, capturing a thrown error as a value (used to render stubbed features safely). */
export function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
