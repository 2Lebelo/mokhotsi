import type { SQLiteDatabase } from "expo-sqlite";

import { MIGRATIONS } from "./migrations/index.ts";
import type { Migration } from "./migrations/types.ts";

/** The phone's original shop file. A registered shop keeps it if its data came from here. */
export const DATABASE_NAME = "mokhotsi.db";
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** The file of a shop that started on the server rather than on this phone. */
export function shopDatabaseName(shopId: string): string {
  return `shop-${shopId}.db`;
}

function userVersion(db: SQLiteDatabase): number {
  return (
    db.getFirstSync<{ user_version: number }>("PRAGMA user_version")
      ?.user_version ?? 0
  );
}

/** Brings `db` up to the last of `migrations`, one transaction per step. */
export function runMigrations(
  db: SQLiteDatabase,
  migrations: readonly Migration[],
): void {
  db.execSync(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
  );
  const version = userVersion(db);
  if (version > migrations[migrations.length - 1].version) {
    throw new Error(
      "This database was created by a newer Mokhotsi app. Install the newer app to continue.",
    );
  }
  // Table rebuilds need foreign keys off, and the pragma is ignored inside a
  // transaction, so it is switched around the steps and integrity is checked per step.
  db.execSync("PRAGMA foreign_keys = OFF");
  try {
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      db.withTransactionSync(() => {
        migration.up(db);
        if (db.getFirstSync("PRAGMA foreign_key_check"))
          throw new Error(
            `Upgrading your shop data failed a consistency check (${migration.name}). Your saved data has not been changed.`,
          );
        db.execSync(`PRAGMA user_version = ${migration.version}`);
      });
    }
  } finally {
    db.execSync("PRAGMA foreign_keys = ON");
  }
}

export function migrateDatabase(db: SQLiteDatabase): void {
  runMigrations(db, MIGRATIONS);
}
