import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

export const DATABASE_NAME = 'mokhotsi.db';

/**
 * The only SQLite connection in the app. Nothing outside src/db/ may import expo-sqlite
 * or drizzle-orm (enforced by ESLint).
 */
const sqlite = openDatabaseSync(DATABASE_NAME);

// WAL: readers don't block the writer, and commits are cheaper (expo-sqlite docs).
// `synchronous` stays at the default (FULL) because a completed sale must survive power loss.
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite);

export type Db = typeof db;
/**
 * Transaction handle. The expo driver is synchronous: `db.transaction((tx) => { ... })`
 * must not be async, so a repository writes its entity row and outbox row back to back
 * with `.run()` inside one callback.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
