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
                                           │ HTTPS, JSON (contracts/sync.schema.json)
                                           ▼  only when online, never during checkout
                         ┌──────────── api/ (FastAPI) ────────────┐
                         │ routers → services → repositories ─────┼──► MongoDB 8
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
| `api/` | Auth, sync push/pull, backup in MongoDB. One `AsyncMongoClient` per process (lifespan) |
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
sync worker (triggers below) ─► push: outbox oldest-first, ≤200 ops ─► POST /sync/push
                                                                     ◄─ { acked, rejected }
                               ─► pull: cursor, ≤500 per page ──────► GET /sync/pull?cursor&limit
                                                                     ◄─ { changes, next_cursor, has_more }
```

- **Every local write pairs the entity row with an outbox row in the same transaction** (expo driver transactions are synchronous). See [ADR 0001](adr/0001-offline-first-sqlite-outbox.md).
- **Ids** are UUID v4 generated on the phone, so entities exist before the server knows about them.
- **Money** is integer cents everywhere (SQLite, JSON, Mongo).
- **Ordering** comes from a server-assigned, per-shop, strictly increasing `seq` (`counters` collection). The pull cursor is the last `seq` seen. Device clocks are never used for ordering.
- **Idempotency**: `op_id` is recorded in `applied_ops` (TTL 30 days). A re-sent op is acked without being applied again.
- **Sync triggers**: app start, network regained, 30 s after the last sale, manual "Sync now", and retry with exponential backoff from 30 s up to 15 min.
- **Auth**: `shop_id` comes only from the verified access token's `sub` claim (`get_current_shop`), never from the request body.

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

## Efficiency decisions

- SQLite in WAL mode with indexes declared in the Drizzle schema. The API creates MongoDB indexes at startup (`app/repositories/indexes.py`).
- Vector index = one contiguous `Float32Array`, with no per-vector objects.
- Push batches are capped at 200 ops and pull pages at 500 records (schema + constants on both sides).
- Camera work runs in worklets. The GPU resizer is checked with `isResizerAvailable()` (shown on the Debug tab). A CPU fallback is future feature work.
