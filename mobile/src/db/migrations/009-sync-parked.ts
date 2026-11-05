import type { Migration } from "./types.ts";

// Pulled records that arrive before what they refer to (a sale before its product, a view
// before its product) wait in `sync_parked` until it arrives, instead of being dropped. The
// server sends each record at its latest change, and a new phone downloads each kind of
// record separately, so this order is normal, not an error.
//
// Repair: before this step such records were dropped with a FOREIGN KEY issue and the cursor
// moved past them, so the phone lacks them for good. A bound file with such an issue
// downloads the shop again on top of what it has (applying a record twice is harmless), and
// the issue goes: it was never a problem with the data.
export const syncParked: Migration = {
  version: 9,
  name: "sync-parked",
  up: (db) =>
    db.execSync(`
      CREATE TABLE sync_parked (
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record TEXT NOT NULL CHECK(json_valid(record)),
        reason TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        escalated INTEGER NOT NULL DEFAULT 0 CHECK(escalated IN (0, 1)),
        PRIMARY KEY (entity, record_id)
      );

      INSERT INTO sync_state (key, value)
        SELECT 'snapshot',
          '{"remaining":["products","stock_levels","sales","reversals","embeddings"],"after":null,"seq":null}'
        WHERE EXISTS (SELECT 1 FROM sync_state WHERE key = 'mode' AND value = 'bound')
          AND EXISTS (
            SELECT 1 FROM sync_issues
            WHERE kind = 'conflict' AND message LIKE '%FOREIGN KEY%'
          )
        ON CONFLICT (key) DO UPDATE SET value = excluded.value;
      DELETE FROM sync_issues WHERE kind = 'conflict' AND message LIKE '%FOREIGN KEY%';
    `),
};
