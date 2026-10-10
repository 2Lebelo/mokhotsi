# Architecture

## Components

```
┌──────────────────────────── Android phone (Expo dev build) ────────────────────────────┐
│                                                                                       │
│  app/ (screens) ──► src/features/ (hooks, feature components)                         │
│                         │            │              │                                 │
│                         ▼            ▼              ▼                                 │
│                    src/db/      src/sync/       src/ml/ ◄── VisionCamera frame output │
│              (Drizzle+SQLite)  (worker, push,  (detect → crop → embed → VectorIndex)  │
│               WAL, outbox)      pull, client)   runs in worklets, LiteRT via          │
│                         ▲            │          react-native-fast-tflite              │
│                         └────────────┘                                                │
└──────────────────────────────────────────┬────────────────────────────────────────────┘
                                           │ HTTPS, JSON: /api/v1 REST (management, online)
                                           │ + sync push/pull (sales, offline-first)
                                           ▼  never during checkout
                         ┌──────────── api/ (FastAPI) ────────────┐
                         │ routers → services → repositories ─────┼──► MongoDB 8 (replica set)
                         │ auth · RBAC · rate limits · audit log ─┼──► Redis (rate limits)
                         └────────────────────────────────────────┘
```

| Part | Responsibility |
| --- | --- |
| `mobile/app/` | expo-router screens: `(auth)/login`, `(tabs)/sell · catalogue · sales · debug`, `enrol/[productId]` |
| `mobile/src/features/` | Hooks and feature components that screens use (auth, checkout, catalogue, sales, debug, sync) |
| `mobile/src/db/` | The only SQLite access: connection (WAL), Drizzle schema, migrations gate, repositories |
| `mobile/src/sync/` | API client, push/pull, background sync worker |
| `mobile/src/ml/` | Framework-free recognition: manifest, model loading, detector, crop, embedder, vector index |
| `mobile/src/providers/` | `AppProviders`: migrations gate → auth → sync |
| `mobile/src/contracts/` | TypeScript mirror of the sync contract |
| `api/` | Versioned REST API (`/api/v1`): users, sessions, roles, shops, members, audit logs; sync push/pull. One `AsyncMongoClient` (and Redis client) per process (lifespan) |
| `ml/` | Export YOLOv8n and MobileNetV2 to LiteRT, parity checks, threshold evaluation |
| `contracts/` | JSON Schema + examples: the single source of truth for the wire format |

## Recognition data flow (all on the phone)

1. `useFrameOutput` delivers each camera frame to a **worklet** (never the JS thread).
2. The GPU resizer (`react-native-vision-camera-resizer`) produces a 640×640×3 float32 buffer, and **YOLOv8n** (`detect`) returns the single main product box.
3. `crop` resamples the box to 224×224×3, and **MobileNetV2** (`embed`) returns an L2-normalised 1280-d vector.
4. `VectorIndex.topK` scans one contiguous `Float32Array` (rows = enrolled vectors) with dot products. A match is accepted when its score ≥ `match_threshold` (manifest, placeholder 0.75).
5. The result goes back to JS. The cashier confirms, and the sale is written locally.

Models and their shapes are described by `mobile/assets/models/manifest.json`, written by `ml/scripts/_manifest.py` and validated by `src/ml/manifest.ts`. Missing `.tflite` files are reported, not fatal.

## Write path and sync

```
checkout ─► sales.recordSale()  ── one SQLite transaction ──►  sales + sale_items + outbox row
                                                                     │
sync worker (triggers below), each run = pull then push:
  1. pull: cursor − 50, ≤500 per page ─► GET  /api/v1/shops/{shop_id}/sync/pull?cursor&limit
                                       ◄─ { changes, next_cursor, has_more }   (page + cursor
                                          applied in ONE SQLite transaction)
  2. push: outbox oldest-first, ≤200  ─► POST /api/v1/shops/{shop_id}/sync/push
                                       ◄─ { acked, rejected }  (acked rows deleted; rejected
                                          rows parked under "needs attention")
```

- **Every local write pairs the entity row with an outbox row in the same transaction** (expo driver transactions are synchronous). See [ADR 0001](adr/0001-offline-first-sqlite-outbox.md).
- **Ids** are UUID v4 generated on the phone, so entities exist before the server knows about them.
- **Money** is integer cents everywhere (SQLite, JSON, Mongo).
- **Ordering** comes from a server-assigned, per-shop, strictly increasing `seq` (`counters` collection). Every accepted change (including a soft delete) gets a new `seq`. The pull cursor is the last `seq` seen, as a decimal string; the phone asks for `cursor − 50` so a page is re-read with a small overlap (applying a page is idempotent). Device clocks are never used for ordering.
- **Pending local changes win until pushed**: pull skips any record that has an outbox row on the phone; a later pull brings the server's version back once the op is acked.
- **Idempotency**: `op_id` is recorded in `applied_ops` (TTL 30 days), checked inside the push transaction. A re-sent op is acked without being applied again.
- **Conflict rules**: products — the last write to reach the server wins, deletes are soft and also soft-delete the product's embeddings; embeddings — insert-only, deleted only with their product or for re-enrolment; sales — insert-only (a re-sent sale is acked unchanged, a delete is rejected).
- **Per-op checks** (a bad op is rejected with `<code>: <message>`, never failing the batch): payload shape, `catalogue:write` for products/embeddings and `sales:create` for sales, ids that belong to another shop (`id_conflict`), sale items and embeddings that reference an unknown product, and sale totals that do not add up.
- **Every accepted op** writes its audit entry (`product.upserted`, `sale.created`, …, with the device id) in the same MongoDB transaction.
- **Sync triggers**: app start, network regained, 30 s after the last sale, manual "Sync now", and retry with exponential backoff from 30 s up to 15 min.
- **Auth**: the access token identifies the *user*. Shop access is decided per request by the caller's membership in the shop in the path (`require_shop_permission`), never by a `shop_id` in a request body. See [ADR 0002](adr/0002-roles-tenancy-hybrid-connectivity.md).

## Roles, tenancy and the management API

- **Roles**:
  - `system_admin` manages users and shops and reads every audit log.
  - `shop_keeper` owns shops.
  - `shop_sitter` sells in one shop.
- **Permissions**: code checks permissions, never role names (`app/core/permissions.py`). A sitter's shop permissions are the defaults (`catalogue:read`, `sales:create`) plus what their keeper grants.
- **Tenancy**: every shop-owned document has `shop_id`. `memberships` links users to shops. Shop routes are nested under `/api/v1/shops/{shop_id}`. Non-members get 404.
- **Writes**: every service mutation runs in `in_transaction(db, write)`, which writes the entity **and** its `audit_logs` entry together. That is why MongoDB runs as a replica set.
- **Sessions**: a short-lived access JWT plus a rotating refresh token stored as a hash in `sessions`. Each request checks the session and the user, so revocation is immediate.
- **Request pipeline**: access log (request id) → rate limit (Redis; per user or IP) → idempotency (`IdempotentRoute`, POST only) → authentication → permission dependency → service.

The full REST rules (naming, filters, sorting, cursors, ETags, idempotency, rate limits, error codes) are in [api-conventions.md](api-conventions.md).

## Sync contract summary

Full schema: [`contracts/sync.schema.json`](../contracts/sync.schema.json). Examples: [`contracts/examples/`](../contracts/examples/).

| Message | Shape |
| --- | --- |
| Push request | `{ device_id, ops: [{ op_id, entity: products\|embeddings\|sales, entity_id, op: upsert\|delete, payload }] }`, 1–200 ops |
| Push response | `{ acked: [op_id], rejected: [{ op_id, reason }] }` |
| Pull response | `{ changes: { products, embeddings, sales }, next_cursor, has_more }`, ≤500 records per page |

Records carry `seq` and `deleted` (soft delete). Embedding vectors travel as base64 little-endian float32 (`vector_b64`). Sales embed their items.

## Layering rules (enforced)

| Rule | Enforced by |
| --- | --- |
| Screens (`mobile/app/`) import only from `@/features/*` (root layout may mount `AppProviders`) | ESLint `no-restricted-imports` |
| Only `mobile/src/db/` imports `expo-sqlite` / `drizzle-orm` | ESLint `no-restricted-imports` |
| `mobile/src/ml/` imports nothing from React, React Native, the DB or app layers | ESLint `no-restricted-imports` |
| API: routers → services → repositories; only `app/repositories/` touches MongoDB | Folder convention + review |
| One MongoDB client per API process, opened and closed in the FastAPI `lifespan` | `app/main.py` |
| Every API mutation writes its audit entry in the same transaction | `in_transaction` + review |
| Authorization is by permission (`require_permission` / `require_shop_permission`), never by role name | `app/core/deps.py` + review |

## Efficiency decisions

- SQLite in WAL mode with indexes declared in the Drizzle schema. The API creates MongoDB indexes at startup (`app/repositories/indexes.py`).
- Vector index = one contiguous `Float32Array`, with no per-vector objects.
- Push batches are capped at 200 ops and pull pages at 500 records (schema + constants on both sides).
- Camera work runs in worklets. The GPU resizer is checked with `isResizerAvailable()` (shown on the Debug tab). A CPU fallback is future feature work.
