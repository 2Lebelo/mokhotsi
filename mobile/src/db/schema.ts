import type { SQLiteDatabase } from "expo-sqlite";

import { MIGRATIONS } from "./migrations/index.ts";

export const DATABASE_NAME = "mokhotsi.db";
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function userVersion(db: SQLiteDatabase): number {
  return (
    db.getFirstSync<{ user_version: number }>("PRAGMA user_version")
      ?.user_version ?? 0
  );
}

export function migrateDatabase(db: SQLiteDatabase): void {
  db.execSync(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
  );
  const version = userVersion(db);
  if (version > SCHEMA_VERSION) {
    throw new Error(
      "This database was created by a newer Mokhotsi app. Install the newer app to continue.",
    );
  }
  // Table rebuilds need foreign keys off, and the pragma is ignored inside a
  // transaction, so it is switched around the steps and integrity is checked per step.
  db.execSync("PRAGMA foreign_keys = OFF");
  try {
    for (const migration of MIGRATIONS) {
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
