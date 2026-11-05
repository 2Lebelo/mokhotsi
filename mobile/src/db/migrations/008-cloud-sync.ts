import type { Migration } from "./types.ts";

// What a shop file needs to sync with the server (sync v2, ADR 0005 amendment 2).
// - Images travel by content hash: product photos (`photo_hash`, `photo2_hash`) and the
//   image a stored view was computed from (`image_sha256`). `files` maps each hash to its
//   file on this phone and tracks its upload or download.
// - Embedding views are synced too, so the outbox is rebuilt to accept them (SQLite cannot
//   change a CHECK in place). Queued ops keep their `seq`, so their order is unchanged.
// - Sales and reversals made before the shop was registered are uploaded once, `imported`:
//   the server records them without moving stock again.
// - `acked_ops` remembers ops the server accepted until a pull brings the stock that
//   includes them, so the projection never counts a movement twice or drops it early.
// - `sync_issues` lists what the owner should look at: refused ops, flagged facts, and
//   pulled records that clashed with this phone's data.
export const cloudSync: Migration = {
  version: 8,
  name: "cloud-sync",
  up: (db) =>
    db.execSync(`
      ALTER TABLE products ADD COLUMN photo_hash TEXT;
      ALTER TABLE products ADD COLUMN photo2_hash TEXT;
      ALTER TABLE product_embeddings ADD COLUMN image_sha256 TEXT;
      ALTER TABLE sales ADD COLUMN imported INTEGER NOT NULL DEFAULT 0 CHECK(imported IN (0, 1));
      ALTER TABLE sale_reversals ADD COLUMN imported INTEGER NOT NULL DEFAULT 0
        CHECK(imported IN (0, 1));

      CREATE TABLE outbox_v8 (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op_id TEXT NOT NULL UNIQUE,
        entity TEXT NOT NULL
          CHECK(entity IN ('products', 'sales', 'reversals', 'stock_movements', 'embeddings')),
        entity_id TEXT NOT NULL,
        op TEXT NOT NULL DEFAULT 'upsert' CHECK(op IN ('upsert', 'delete')),
        payload TEXT NOT NULL CHECK(json_valid(payload)),
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'rejected')),
        reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO outbox_v8 (seq, op_id, entity, entity_id, op, payload, status, reason, attempts, last_error, created_at)
        SELECT seq, op_id, entity, entity_id, op, payload, status, reason, attempts, last_error, created_at FROM outbox;
      DROP TABLE outbox;
      ALTER TABLE outbox_v8 RENAME TO outbox;
      CREATE INDEX outbox_status ON outbox(status, seq);
      CREATE UNIQUE INDEX outbox_coalesce ON outbox(entity, entity_id)
        WHERE status = 'pending' AND entity = 'products';

      CREATE TABLE acked_ops (
        op_id TEXT PRIMARY KEY NOT NULL,
        acked_seq INTEGER NOT NULL
      );

      CREATE TABLE files (
        sha256 TEXT PRIMARY KEY NOT NULL CHECK(length(sha256) = 64),
        kind TEXT NOT NULL CHECK(kind IN ('photo', 'crop')),
        uri TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('local', 'uploaded', 'missing')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX files_state ON files(state);

      CREATE TABLE sync_issues (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('rejected', 'flagged', 'conflict')),
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op_id TEXT,
        code TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX sync_issues_created ON sync_issues(created_at);
    `),
};
