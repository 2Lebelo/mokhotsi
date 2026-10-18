# ADR 0002: Roles, multi-shop tenancy and hybrid connectivity

- **Status:** Accepted
- **Date:** 2026-10-06
- **Updates:** [ADR 0001](0001-offline-first-sqlite-outbox.md). Selling stays offline-first; the "single editor per shop" assumption is withdrawn.

## Context

The scaffold modelled one owner per shop who signed in with a phone number. The product now needs:

- **Three roles.**
  - A **system admin** creates users and sees every audit log.
  - A **shop-keeper** owns one or more shops and runs the catalogue, stock, sales and reports.
  - A **shop-sitter** sells in one shop and gets more only if the keeper grants it.
- **Email + password sign-in.**
- **A full audit trail.** Keepers see every operation in their shops, including what their sitters did.
- **A versioned REST API** with filtering, sorting, pagination, idempotency, rate limits and role-based access.

Shops can now have several people editing them, so ADR 0001's "products have a single editor" no longer holds. Server-side permission checks and audit entries also need a server in the loop.

## Decision

1. **Hybrid connectivity.**
   - **Selling stays offline-first** (ADR 0001 is unchanged for sales). A sale, its lines and an outbox row are written in one SQLite transaction and pushed later. On push, the server validates the seller's permission, snapshots the cost, adjusts stock and writes the audit entry.
   - **Management is online.** That covers catalogue, stock adjustments, refunds, users, permissions and logs. These go through `/api/v1` REST endpoints that check permissions and write audit entries **in the same MongoDB transaction** as the change. Devices receive the results through sync pull.
2. **Tenancy.**
   - Every shop-owned document carries `shop_id`.
   - A `memberships` collection (user, shop, `keeper|sitter`, granted permissions) decides access.
   - Shop-scoped routes put the shop in the path (`/api/v1/shops/{shop_id}/...`) and resolve it against the caller's membership.
   - Callers who aren't members get **404**, so shop ids can't be probed.
   - This replaces ADR 0001's "`shop_id` comes only from the token": the token now identifies the *user*, and membership decides which shops they can reach.
3. **Permissions, not role names.**
   - The role sets the system permissions.
   - The membership sets the shop permissions: a keeper has every one; a sitter has `catalogue:read`, `sales:create`, plus grants from a fixed list.
   - Code only ever checks permissions (`require_permission`, `require_shop_permission`), so custom roles can be added later without touching endpoints.
4. **Sessions behind short-lived tokens.**
   - The access JWT lasts 15 minutes.
   - The refresh token is opaque and rotates on every use. It is stored only as a hash in a `sessions` document. Presenting a spent one revokes the session (reuse detection).
   - Every request loads the session and the user, so logout, deactivation and role changes apply immediately.
   - Cookies are not used while the only client is the phone app.
5. **MongoDB runs as a replica set** (one node in development) so that multi-document transactions are available.
6. **Redis holds rate-limit state** so limits are shared across API workers. The limiter fails open if Redis is down.
7. **No public sign-up.** The first admin is created with `python -m app.cli create-admin`. Admins create keepers (optionally with a first shop), and keepers create sitters. Created accounts must change their initial password before doing anything else.

## Alternatives considered

- **Everything online (no outbox).** Rejected: shops lose signal, and checkout must never wait for the network.
- **Everything offline, including catalogue edits by several devices.** Rejected for now: it needs real conflict resolution and makes permission checks advisory. Catalogue edits are rare and done by the keeper, who can wait for signal.
- **A role claim in the JWT, trusted for 15 minutes.** Rejected: a demoted or removed sitter would keep access until expiry. One indexed read per request is cheap.
- **Offset pagination.** Rejected: it gets slower with depth and skips or repeats rows while new rows arrive (audit logs grow constantly). We use keyset cursors.

## Consequences

- Local development and CI need a replica set and Redis (`docker compose up -d mongo redis`; the CI workflow starts both).
- Every mutation in a service is written as `in_transaction(db, write)`, with the entity write and `audit.record(...)` in the same callback. Reviewers check this.
- A sitter's sale made offline can be rejected at push time if their permission was removed in the meantime. The device must show rejected ops (Phase 3).
- Stock can go negative after offline sales from several devices. That is accepted and flagged to the keeper rather than blocking a sale (Phase 2).
