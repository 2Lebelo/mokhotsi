/**
 * In-process change notifications. Repositories call `notifyChanged` after a transaction
 * commits; hooks `subscribe` to re-read. Cheaper and more predictable than native SQLite
 * change listeners, and it works the same in Jest.
 */
export type Table = 'products' | 'embeddings' | 'product_images' | 'sales' | 'outbox' | 'sync_state';

type Listener = (tables: ReadonlySet<Table>) => void;

const listeners = new Set<{ tables: ReadonlySet<Table>; listener: Listener }>();

export function notifyChanged(...tables: Table[]): void {
  if (tables.length === 0) return;
  const changed = new Set(tables);
  for (const entry of [...listeners]) {
    if (tables.some((t) => entry.tables.has(t))) entry.listener(changed);
  }
}

/** Returns an unsubscribe function (use it as a useEffect cleanup). */
export function subscribe(tables: readonly Table[], listener: Listener): () => void {
  const entry = { tables: new Set(tables), listener };
  listeners.add(entry);
  return () => {
    listeners.delete(entry);
  };
}
