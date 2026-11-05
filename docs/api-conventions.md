# API conventions

These rules apply to every endpoint under `/api/v1`. The OpenAPI document is served at `/docs` (Swagger UI) and `/openapi.json`, and committed as [contracts/openapi.json](../contracts/openapi.json): the mobile app's request and response types are generated from it (`npm run api:types`), and an API test fails when it is stale (`uv run python -m app.cli export-openapi`). Why these choices were made: [ADR 0002](adr/0002-roles-tenancy-hybrid-connectivity.md) and [ADR 0005](adr/0005-users-tenancy-offline-sync.md).

## Versioning

- Every public route lives under **`/api/v1`**. Breaking changes (removing or renaming a field, changing a meaning or a status code) go to `/api/v2`.
- Adding optional request fields, new response fields or new endpoints is not breaking. Clients must ignore unknown response fields.
- `/health` is unversioned and unauthenticated.

## Resources and methods

Resources are **plural nouns**. Actions are expressed as resources, never as verbs in the path. For example, an owner's approval is `POST /users/{id}/reviews`, not `/users/{id}/approve`.

| Method | Meaning | Success |
| --- | --- | --- |
| `GET` | List or read | 200 |
| `POST` | Create | **201** with `Location` (and `ETag`). Token grants return 200 (RFC 6749). |
| `PATCH` | Partial update; only the fields sent change | 200 with the updated resource and new `ETag` |
| `PUT` | Replace or set (e.g. `PUT /users/me/pin`, `PUT /shops/{id}/devices/{device_id}`) | 200 or 204 |
| `DELETE` | Remove, deactivate or soft-delete. Deactivating an already disabled user is still 204; a resource that does not exist is 404. | 204 |

Shop-owned resources are nested under their shop: `/api/v1/shops/{shop_id}/members`, `.../devices`, and the sync endpoints.

### Current endpoints

| Resource | Endpoints | Who |
| --- | --- | --- |
| Registrations | `POST /registrations` | anyone (a shop owner signing up) |
| Tokens | `POST /tokens` (`grant_type` = `pin`, `device_pin`, `device` or `refresh_token`) | anyone |
| Sessions | `GET /sessions`, `DELETE /sessions/current`, `DELETE /sessions/{id}` | yourself |
| Me | `GET /users/me`, `PUT /users/me/pin` | yourself, also while pending approval |
| Users | `GET, POST /users`; `GET, PATCH, DELETE /users/{id}`; `POST /users/{id}/reviews`; `POST /users/{id}/pin-resets` | system admin |
| Roles | `GET /roles`, `GET /permissions` | signed in |
| Shops | `GET, POST /shops`; `GET, PATCH /shops/{id}` | approved owners open and rename their own; the admin lists all and suspends |
| Members | `GET, POST /shops/{id}/members`; `GET, PATCH, DELETE .../members/{user_id}`; `PUT .../members/{user_id}/pin` | owner (`members:manage`); admin can read |
| Phones | `GET /shops/{id}/devices`, `PUT, DELETE /shops/{id}/devices/{device_id}`, `PUT /shops/{id}/data-claim` | owner (`devices:manage`) |
| | `DELETE /devices/{id}` (revoke) | whoever registered it, its shop's owner, the admin |
| | `GET /devices` | system admin |
| | `GET /devices/me/roster` | a registered phone (device token) |
| Audit logs | `GET /audit-logs` (admin), `GET /shops/{id}/audit-logs` (owner; admin can read) | see column |
| Sync | `POST /shops/{id}/sync/push`, `GET .../sync/pull`, `GET .../sync/snapshot` ([contract](../contracts/sync.v2.schema.json)) | a registered phone of that shop (device token) |
| Photos | `POST /shops/{id}/sync/photos/uploads`, `.../photos/confirm`, `.../photos/urls` | a registered phone of that shop (device token) |

## Authentication and sessions

Everyone signs in with a **5-digit PIN**. Owners and the system admin are identified by their phone number; cashiers have no phone number, and their PIN alone identifies them within their shop. A PIN is only ever accepted together with a registered phone.

1. **Register a business:** `POST /registrations` with `{"name","phone","pin","device":{"name","platform"}}`. The owner is signed in at once with `status: "pending"` and no permissions; `GET /users/me` shows the status. The system admin approves or rejects them.
2. **Sign in with phone + PIN:** `POST /tokens` with `{"grant_type":"pin","phone","pin","device"}`, where `device` is either a registered phone's `{"device_id","device_secret"}` or `{"name","platform"}` to register this one. A phone registered by this request gets its secret **once**, in the response's `device`. Keep it in the phone's keystore.
3. **Sign in at a shop's phone:** `{"grant_type":"device_pin","device_id","device_secret","shop_id","pin"}`. The PIN is matched within that shop.
4. **A phone on its own** (roster, sync): `{"grant_type":"device","device_id","device_secret"}` returns a 15-minute device token. It works only on device endpoints; a revoked phone gets **401 `device_revoked`** on its next request.
5. Send `Authorization: Bearer <access_token>` on every request.
6. When you get **401 `invalid_token`**, refresh: `{"grant_type":"refresh_token","refresh_token"}`. **Refresh tokens are single use.** Store the new one before using it. If the response was lost, retrying with the previous token works until the new one is used (for up to 7 days). Any older token revokes the whole session (`refresh_token_reused`), so clients must never run two refreshes at once. A system admin's session lasts 12 hours, everyone else's 30 days, renewed by use.
7. If `user.must_change_pin` is true (a PIN reset by the admin), every endpoint except `GET /users/me`, `PUT /users/me/pin` and `DELETE /sessions/current` returns **403 `pin_change_required`**. A pending owner gets **403 `registration_pending`** on the same endpoints.
8. Logout is `DELETE /sessions/current`. Changing your PIN signs out your other phones. Deactivating a user, resetting their PIN or revoking a phone signs them out on their very next request.

The roster (`GET /devices/me/roster`) gives a phone each of its shops' PIN key and every active member's `pin_tag` (`HMAC-SHA256(pin_key, PIN)`), so it can check PINs offline. Poll it with `If-None-Match`: an unchanged roster is a **304**.

## Authorization

- **System permissions** come from the role (`system_admin`, `owner`, `cashier`), once the user is approved.
- **Shop permissions** come from the caller's membership in the shop named in the path.
  - Owners have all of them.
  - Cashiers have `catalogue:read` and `sales:create`, plus any of `sales:read`, `sales:refund`, `catalogue:write`, `stock:write`, `costs:read` and `reports:read` granted by the owner.
  - `GET /roles` and `GET /permissions` return the live catalogue; [contracts/permissions.json](../contracts/permissions.json) is the same, checked by both test suites.
- A shop you are not a member of returns **404** (not 403). Missing a permission inside your own shop returns **403 `permission_denied`**.
- A **suspended** shop can still be read (team, activity, catalogue, sales, reports); any change returns **403 `shop_suspended`**. Only the system admin suspends and reactivates shops.
- Permission changes apply on the next request; there is no need to sign in again.

## Lists: filtering, sorting, pagination

```
GET /api/v1/users?role=owner&status=pending&q=5812&sort=-created_at,name&limit=50&cursor=...
```

```json
{ "data": [ ... ], "page": { "next_cursor": "eyJzIjoi...", "limit": 50 } }
```

- **Filters** are plain query parameters named after the field. `q` is free-text search where it is offered (users: name, or phone digits), and `from`/`to` are ISO 8601 time windows (`from` included, `to` excluded).
- **Sort** is a comma-separated list of fields; prefix `-` for descending. Each resource has an allowlist of sort fields, and anything else is **400 `invalid_sort`**. Every resource has a sensible default order (audit logs: newest first).
- **Pagination** uses opaque keyset cursors.
  - Pass `page.next_cursor` back as `cursor`. `null` means this is the last page.
  - A cursor only works with the sort it was issued for (otherwise **400 `invalid_cursor`**).
  - `limit` is 1–100 and defaults to 50.

## Concurrency: ETag and If-Match

Single-resource responses carry `ETag: "<version>"`. Send it back as `If-Match` on `PATCH` to avoid overwriting someone else's change. If the resource changed in the meantime, the API returns **412 `version_mismatch`**: re-read it and re-apply the change. Without `If-Match` the last write wins.

## Idempotency

Send `Idempotency-Key: <uuid>` on a `POST` to make retries safe:

| Situation | Result |
| --- | --- |
| First request | Runs. A 2xx response is stored for 24 h. |
| Same key, same body | The stored response, with `Idempotent-Replayed: true` |
| Same key, different body | **422 `idempotency_key_reused`** |
| Same key while the first is still running | **409 `idempotency_in_progress`** (retry shortly) |
| First request failed (4xx/5xx) | Nothing is stored; a retry runs again |

Keys are scoped to the caller (user, phone, or IP when anonymous) and the endpoint. The OpenAPI document marks each POST with `x-idempotency-key: optional | required | unsupported`. **Unsupported** means the response holds a secret (a temporary PIN), which is never stored for replay; registrations and token grants hold secrets too and take no key. From Phase 2, endpoints that move money or stock (sales, refunds, stock movements) **require** it.

## Rate limiting

| Scope | Default |
| --- | --- |
| PIN sign-in and shop opening, per IP + phone (or phone + shop) | 5 / minute, checked before any PIN is hashed |
| PIN sign-in at a shop's phone, per phone across every IP | 20 / hour |
| Wrong PINs, per account | 5 (the admin: 3), then the account locks for 1 minute, doubling with each further lockout up to 24 hours (**423 `account_locked`**). A right PIN resets it. |
| Registrations, per IP | 10 / hour |
| PIN changes, per user | 10 / hour (a `pin_taken` answer tells someone a colleague uses that PIN) |
| Signed-in requests, per user or per phone | 300 / minute |
| Anonymous requests, per IP | 60 / minute |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. Going over the limit returns **429 `rate_limited`** with `Retry-After` in seconds. The limits are configurable (`RATE_LIMIT_*` and `PIN_*` in `api/.env.example`). Phones with a device token are limited on their own, not by their (often shared, carrier) IP.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "pin_taken", "message": "Choose another PIN", "details": null } }
```

Clients branch on `code` (stable) and show `message` (for people). Validation errors (422 `validation_error`) list the failing fields in `details`, without echoing the values that were sent.

| Status | Codes |
| --- | --- |
| 400 | `bad_request`, `invalid_sort`, `invalid_cursor`, `invalid_if_match`, `idempotency_key_required`, `invalid_idempotency_key` |
| 401 | `unauthorized`, `invalid_token`, `invalid_credentials`, `session_revoked`, `account_disabled`, `registration_rejected`, `refresh_token_reused`, `invalid_device`, `device_revoked` |
| 403 | `forbidden`, `permission_denied`, `registration_pending`, `pin_change_required`, `shop_suspended` |
| 404 | `not_found` |
| 409 | `phone_taken`, `pin_taken`, `membership_exists`, `not_pending`, `review_required`, `cannot_modify_self`, `last_admin`, `not_a_cashier`, `shop_limit_reached`, `device_not_linked`, `data_already_claimed`, `idempotency_in_progress` |
| 410 | `cursor_expired` (sync: download a snapshot again) |
| 412 | `version_mismatch` |
| 413 | `payload_too_large` (sync push over 2 MB: split the batch) |
| 422 | `validation_error`, `invalid_phone`, `invalid_current_pin`, `pin_reused`, `idempotency_key_reused` |
| 423 | `account_locked` |
| 426 | `client_update_required` (sync `schema_version` too old) |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | `database_unavailable` (transient; retry after `Retry-After` seconds), `photos_unavailable` (no Cloudinary account configured) |

Sync push rejects single ops (never the batch) with a `code` in `rejected`: `invalid_op`, `invalid_payload`, `total_mismatch`, `id_conflict`, `op_conflict`, `permission_denied`, `unknown_actor`, `unknown_sale`, `unknown_variant`, `unknown_product`. The request itself can fail with `device_mismatch` (403), `shop_suspended` (403), `payload_too_large` (413) or `client_update_required` (426).

`pin_taken` never says whose PIN it is.

Every response carries `x-request-id` (or echoes the one you sent). Quote it when reporting a problem. It is also stored on audit entries.

## Audit log

Every change writes one entry **in the same transaction** as the change: who (`actor_id`, `actor_role`, `actor_phone`), what (`action` such as `member.updated`, plus `entity` and `entity_id`), where (`shop_id`), the field-level `changes` (`{"field": {"from", "to"}}`, never secrets: PINs, PIN tags and keys, device secrets), and `request_id`, `ip`, `user_agent` and `device_id`. Registrations (`user.registered`), reviews (`user.approved`, `user.rejected`), sign-ins (`session.created`), failed sign-ins (`auth.login_failed`, and `auth.admin_login_failed` for the admin), lockouts (`user.locked`), PIN resets and changes, and phone registrations, links and revocations are recorded too. Entries are never edited or deleted by the application.
