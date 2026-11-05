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

Sync v2: [ADR 0005](adr/0005-users-tenancy-offline-sync.md), amendment 2.

```
checkout ─► sales.checkout()  ── one SQLite transaction ──►  sales + sale_items + outbox row
                                                                     │
sync engine (device token; triggers below), each run:
  1. images: hash → POST .../sync/photos/uploads ─► upload to Cloudinary ─► .../photos/confirm
  2. push: outbox oldest-first, ≤200 ─► POST /api/v1/shops/{shop_id}/sync/push
                                    ◄─ { acked, rejected, flagged, seq }
  3. pull: by cursor, ≤500 / ~1 MB   ─► GET  /api/v1/shops/{shop_id}/sync/pull?cursor&limit
                                    ◄─ { changes, next_cursor, has_more }   (page + cursor
                                       applied in ONE SQLite transaction; 410 → snapshot)
  a new phone first pages GET .../sync/snapshot?entity=…, then pulls from its snapshot_seq
```

- **Every local write pairs the entity row with an outbox row in the same transaction** (expo driver transactions are synchronous). See [ADR 0001](adr/0001-offline-first-sqlite-outbox.md).
- **Ids** are UUID v4 generated on the phone, so entities exist before the server knows about them.
- **Money** is integer cents everywhere (SQLite, JSON, Mongo).
- **Ordering** comes from the shop's change feed (`changes`: `{shop_id, seq, entity, entity_id}`), numbered by a per-shop counter. A push reserves its seqs at the very end of its transaction, so seq order is commit order and the feed has no gaps. Pull reads the feed in a snapshot session and sends each changed record's current state once. Device clocks are never used for ordering.
- **Pending local changes win until pushed**: pull skips any record that has an outbox row on the phone, except stock levels; a later pull brings the server's version back once the op is acked.
- **Idempotency**: `op_id` is recorded in `applied_ops` (TTL 180 days, as long as the feed), checked inside the push transaction. A re-sent op is acked without being applied again.
- **Conflict rules**: products are replaced whole, and the last write to reach the server wins. Sales, reversals, stock movements and embeddings are insert-only. A deleted embedding keeps a tombstone, so it never comes back.
- **Per-op checks** (a bad op is rejected with a `code`, never failing the batch): payload shape and totals, ids that belong to another shop (`id_conflict`), a product edit without `catalogue:write` (`permission_denied`), someone who never worked at the shop (`unknown_actor`), and references the server has not seen (`unknown_sale`, `unknown_variant`, `unknown_product`). Facts by a removed or no-longer-allowed person are acked and **flagged**.
- **Stock**: phones never send a figure. The server keeps the ledger (`stock_movements`, including movements derived from sales and restocked reversals) and the sums (`stock_levels`), which every phone pulls.
- **Every push** writes one `sync.pushed` audit entry (counts, flagged and rejected ops) in the same MongoDB transaction as its data.
- **Sync triggers**: app start, network regained, 30 s after the last sale, manual "Sync now", and retry with exponential backoff from 30 s up to 15 min.
- **Auth**: a person's access token identifies the *user*. Shop access is decided per request by the caller's membership in the shop in the path (`require_shop_permission`), never by a `shop_id` in a request body. Sync authenticates the *phone* with its device token (`require_device_shop`): the shop must be in its `shop_ids`.

## Roles, tenancy and the management API

- **Roles** ([ADR 0005](adr/0005-users-tenancy-offline-sync.md)):
  - `system_admin` approves owners, manages users, shops and phones, and reads every audit log.
  - `owner` registers (pending until approved), then opens and runs shops.
  - `cashier` sells in one shop, with what their owner grants.
- **Permissions**: code checks permissions, never role names (`app/core/permissions.py`, mirrored by `contracts/permissions.json` and `mobile/src/domain/permissions.ts`). A cashier's shop permissions are the defaults (`catalogue:read`, `sales:create`) plus what their owner grants. A pending owner has none.
- **Tenancy**: every shop-owned document has `shop_id`. `memberships` links users to shops. Shop routes are nested under `/api/v1/shops/{shop_id}`. Non-members get 404. A suspended shop is read-only.
- **Writes**: every service mutation runs in `in_transaction(db, write)`, which writes the entity **and** its `audit_logs` entry together. That is why MongoDB runs as a replica set. Slow work (Argon2) runs before the transaction, in a worker thread.
- **Identity**: everyone signs in with a 5-digit PIN, only ever together with a registered phone. Owners and the admin are found by phone number; a cashier by `pin_tag = HMAC(shop pin_key, PIN)`, unique per shop (`memberships`, partial unique index). The server stores PINs only as Argon2 hashes and each shop's key in `shop_secrets`, which no shop response includes.
- **Phones** (`devices`): a registered phone holds a 256-bit secret (the server keeps its sha256) and the shops it serves (`shop_ids`). A device token lets it fetch its roster and sync with nobody signed in; revoking it signs out everyone on it.
- **Roster** (`GET /devices/me/roster`): each linked shop's PIN key and active members' tags, names and permissions. Its ETag is built from `shops.roster_version` (bumped in the same transaction as any member, PIN, permission, name or status change) and the device's own version, so an unchanged roster is a 304 after one covered read.
- **Sessions**: a short-lived access JWT plus a rotating refresh token stored as a hash in `sessions`, bound to a phone. Each request checks the session and the user, so revocation is immediate.
- **Request pipeline**: access log (request id) → rate limit (Redis; per user, phone or IP) → idempotency (`IdempotentRoute`, POST only) → authentication → permission dependency → service.

## Identity on the phone

```
DeviceProvider   device.db (roster, shop files, lockout) · keystore (device secret, PIN keys)
  │              API client · roster refresh (start, foreground, network back, after changes)
  ▼
SessionProvider  phase = appPhase(...) (src/auth/phase.ts) · PIN checked offline · idle lock
  │              can(permission) · setUpPhone (first shop → straight into the till)
  ▼
Root Stack, one Stack.Protected per phase (only the current phase's screens exist):
  signed-out ──► sign-in, sign-up            phone number + PIN; register an owner
  setup ───────► setup                       waiting for approval → choose PIN → name shop
  admin ───────► admin/*                     the system admin (never the till)
  locked ──────► unlock                      the PIN pad (shop picker for several shops)
  open ────────► (app)/*                     ShopProvider(that shop's file, actor) ─► tabs
```

- One SQLite file per shop; `device.db` records which. The first shop a phone gets keeps the phone's original `mokhotsi.db`, so claiming its data moves nothing.
- Staff, shop, phone and admin screens are online only (React Query). The person at the till confirms their PIN once to get an online session, which ends when the phone locks.
- A waiting owner's phone checks for approval with backoff and jitter (15 s up to 5 min, paused in the background), so many waiting phones never poll in step. Sign-in and registration are never retried automatically; `Retry-After` drives a countdown instead.

The full REST rules (naming, filters, sorting, cursors, ETags, idempotency, rate limits, error codes) are in [api-conventions.md](api-conventions.md).

## Sync contract summary

Full schema: [`contracts/sync.v2.schema.json`](../contracts/sync.v2.schema.json). Examples: [`contracts/examples/`](../contracts/examples/).

| Message | Shape |
| --- | --- |
| Push request | `{ device_id, schema_version: 2, ops: [{ op_id, entity, entity_id, op: upsert\|delete, payload }] }`, 1–200 ops, ≤2 MB |
| Push response | `{ acked: [op_id], rejected: [{ op_id, code, message }], flagged: [op_id], seq }` |
| Pull response | `{ changes: [{ seq, entity, record }], next_cursor, has_more }`, ≤500 records and ~1 MB per page |
| Snapshot response | `{ entity, records, after, has_more, snapshot_seq }` |

Entities: `products`, `sales`, `reversals`, `stock_movements` and `embeddings` (pull also sends `stock_levels`). Products carry every size and their photos as content hashes. Sales embed their items. Embedding vectors travel as base64 little-endian float16 (`vector_f16`). A deleted embedding is pulled as `{id, product_id, deleted: true}`. `delete` is valid for embeddings only.

## Layering rules (enforced)

| Rule | Enforced by |
| --- | --- |
| Only `mobile/src/db/` (and the provider that opens `device.db`) imports `expo-sqlite` | ESLint `no-restricted-imports` |
| Only `mobile/src/auth/secure.ts` imports `expo-secure-store` | ESLint `no-restricted-imports` |
| Only `mobile/src/api/client.ts` calls `fetch` | ESLint `no-restricted-globals` |
| `mobile/src/lib/`, `src/sync/` and `src/api/` import nothing from React, React Native, SQLite or the keystore (testable in node) | ESLint `no-restricted-imports` |
| The app's API types are generated from `contracts/openapi.json`, which must match the API | `npm run api:types`; tests on both sides |
| API: routers → services → repositories; only `app/repositories/` touches MongoDB | Folder convention + review |
| One MongoDB client per API process, opened and closed in the FastAPI `lifespan` | `app/main.py` |
| Every API mutation writes its audit entry in the same transaction | `in_transaction` + review |
| Authorization is by permission (`require_permission` / `require_shop_permission`, `can()` on the phone), never by role name | `app/core/deps.py`, `src/auth/session-provider.tsx` + review |

## Efficiency decisions

- SQLite in WAL mode with indexes declared in the Drizzle schema. The API creates MongoDB indexes at startup (`app/repositories/indexes.py`).
- Vector index = one contiguous `Float32Array`, with no per-vector objects.
- Push batches are capped at 200 ops and pull pages at 500 records (schema + constants on both sides).
- Camera work runs in worklets. The GPU resizer is checked with `isResizerAvailable()` (shown on the Debug tab). The identify camera picks the best mode the phone can run with a fallback ladder (`src/features/vision/camera-ladder.ts`). On Android it first tries GPU (`PRIVATE`) frames, then YUV frames, then single photos. Some drivers refuse GPU frames for CameraX ImageAnalysis (for example the Samsung A32). A mode that fails before its first frame steps down. A format refusal is remembered in `device_state` until the app or OS build changes.
