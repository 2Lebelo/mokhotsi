import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";

import type { Applied } from "./repositories/remote.ts";
import { migrateDatabase } from "./schema.ts";

/** What a sync run changed in a shop's file. */
export type RemoteChange = Applied;

type Entry = { db: Promise<SQLiteDatabase>; refs: number };

const open = new Map<string, Entry>();
const localWrites = new Set<(name: string) => void>();
const remoteChanges = new Map<string, Set<(change: RemoteChange) => void>>();

/**
 * One connection per shop file, shared by the till (ShopProvider) and sync, so their writes
 * are serialised on one connection instead of competing for the file. Opened and migrated
 * once; closed when the last user releases it.
 */
export function acquireShopDatabase(name: string): Promise<SQLiteDatabase> {
  let entry = open.get(name);
  if (!entry) {
    const db = openDatabaseAsync(name, { useNewConnection: true }).then((connection) => {
      try {
        migrateDatabase(connection);
        return connection;
      } catch (cause) {
        void connection.closeAsync().catch(() => {});
        throw cause;
      }
    });
    entry = { db, refs: 0 };
    open.set(name, entry);
    const opened = entry;
    db.catch(() => {
      if (open.get(name) === opened) open.delete(name);
    });
  }
  entry.refs++;
  return entry.db;
}

export function releaseShopDatabase(name: string): void {
  const entry = open.get(name);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  open.delete(name);
  void entry.db.then((db) => db.closeAsync()).catch(() => {});
}

/** The till changed the shop's data (sync sends it soon). */
export function notifyLocalWrite(name: string): void {
  for (const listener of localWrites) listener(name);
}

export function onLocalWrite(listener: (name: string) => void): () => void {
  localWrites.add(listener);
  return () => localWrites.delete(listener);
}

/** Sync applied changes from other phones (open screens refresh). */
export function notifyRemoteChange(name: string, change: RemoteChange): void {
  for (const listener of remoteChanges.get(name) ?? []) listener(change);
}

export function onRemoteChange(
  name: string,
  listener: (change: RemoteChange) => void,
): () => void {
  const listeners = remoteChanges.get(name) ?? new Set();
  listeners.add(listener);
  remoteChanges.set(name, listeners);
  return () => listeners.delete(listener);
}
