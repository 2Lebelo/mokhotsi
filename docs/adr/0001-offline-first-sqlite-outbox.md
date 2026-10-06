# ADR 0001: Offline-first with on-device SQLite and a transactional outbox

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

Mokhotsi runs in small shops in Lesotho where mobile data is expensive, coverage drops, and phones are low-end Android devices. A sale must complete in about a second whether or not there is signal. Product recognition already runs on the phone. The backend exists for backup, for several devices sharing one shop, and for reporting. It must never sit on the checkout path.

We need:

1. **Local durability.** A completed sale survives an app kill or power loss.
2. **Exactly-once sync.** Every local change reaches the server eventually, with no loss and no duplicates, after any number of crashes and retries.
3. **A deterministic order.** Several devices in one shop must converge on the same state without trusting phone clocks.

## Decision

1. **SQLite is the system of record on the phone** (expo-sqlite, Drizzle ORM, WAL mode). Screens read from and write to SQLite only.
2. **Transactional outbox.** Every local write inserts the entity row(s) **and** one `outbox` row (`op_id`, entity, entity_id, `upsert|delete`, JSON payload) in **the same transaction**. The expo driver runs transactions synchronously, so the pair commits or rolls back together.
3. **Push** drains the outbox oldest-first in batches of at most 200. The server records each `op_id` in `applied_ops` (TTL 30 days) and acknowledges it. The phone deletes acknowledged rows. Re-sending an op is harmless because `op_id` is the idempotency key.
4. **Pull** pages (at most 500 records) through changes with `seq > cursor`. The server assigns `seq` from a per-shop counter when it applies an op. The phone stores the cursor in `sync_state` in the same transaction as the applied page.
5. **Client-generated UUIDs** let entities exist and be referenced (sale → items → product) before the server has seen them.

## Alternatives considered

- **Online-first with a local cache.** Rejected: checkout would depend on connectivity and latency.
- **Write locally, then sync with a separate "dirty" flag or by diffing tables.** Rejected: a crash between the write and the flag update loses or duplicates changes, and diffing is slow on large tables. The outbox makes "what still needs sending" an explicit, append-only queue.
- **Order by device timestamps (last-write-wins on `updated_at`).** Rejected: phone clocks drift and get changed by users. A server-assigned `seq` gives one total order per shop.
- **A sync framework or CRDT database** (e.g. WatermelonDB sync, PowerSync, Realm/Atlas Device Sync). Rejected for now: these add a vendor or native dependency, and our data model is small (products, embeddings, sales). Sales are append-only and products have a single editor (the owner), so conflicts are rare. We can revisit this if multi-editor conflicts become real.

## Consequences

- Every repository write function must take part in a transaction with `outbox.enqueue`. Reviewers check this, and the repository signatures in `mobile/src/db/repositories/` document it.
- The outbox grows while offline. That is acceptable at retail volumes, and `pendingCount()` is shown on the Debug tab.
- The server must stay idempotent and must reject bad ops individually (in `rejected`) instead of failing the whole batch.
- Remote changes applied by pull must **not** create outbox rows, or they would echo back to the server.
- Conflict policy for the same product edited on two devices is "highest `seq` wins" on pull. That is simple, but it means the later sync overwrites the earlier one. Feature work should surface this if it matters.
