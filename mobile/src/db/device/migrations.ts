import type { Migration } from "../migrations/types.ts";

/**
 * device.db: what this phone knows about itself, apart from any one shop's data.
 * - device_state: the phone's id, the signed-in account, the roster's ETag and sync time.
 * - device_shops / roster_members: the roster (ADR 0005). PIN tags are useless without the
 *   shop keys, which live in the keystore, never here.
 * - shop_files: which SQLite file holds each shop's data. Kept when a shop leaves the roster,
 *   so its data is never reused for anything else.
 * - pin_lockout: wrong PINs on this phone's lock screen.
 */
export const DEVICE_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "device-roster",
    up(db) {
      db.execSync(`
        CREATE TABLE device_state (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        CREATE TABLE device_shops (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
          roster_version INTEGER NOT NULL,
          data_claimed_by_device TEXT,
          position INTEGER NOT NULL
        );

        CREATE TABLE roster_members (
          shop_id TEXT NOT NULL REFERENCES device_shops (id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('owner', 'cashier')),
          permissions TEXT NOT NULL,
          pin_tag TEXT,
          must_change_pin INTEGER NOT NULL DEFAULT 0 CHECK (must_change_pin IN (0, 1)),
          PRIMARY KEY (shop_id, user_id)
        );
        CREATE INDEX roster_members_pin_tag ON roster_members (shop_id, pin_tag);

        CREATE TABLE shop_files (
          shop_id TEXT PRIMARY KEY NOT NULL,
          db_name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE pin_lockout (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          failures INTEGER NOT NULL,
          lockouts INTEGER NOT NULL,
          locked_until INTEGER
        );
        INSERT INTO pin_lockout (id, failures, lockouts, locked_until) VALUES (1, 0, 0, NULL);
      `);
    },
  },
];
