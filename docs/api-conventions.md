# API conventions

These rules apply to every endpoint under `/api/v1`. The OpenAPI document is served at `/docs` (Swagger UI) and `/openapi.json`. Why these choices were made: [ADR 0002](adr/0002-roles-tenancy-hybrid-connectivity.md).

## Versioning

- Every public route lives under **`/api/v1`**. Breaking changes (removing or renaming a field, changing a meaning or a status code) go to `/api/v2`.
- Adding optional request fields, new response fields or new endpoints is not breaking. Clients must ignore unknown response fields.
- `/health` is unversioned and unauthenticated.

## Resources and methods

Resources are **plural nouns**. Actions are expressed as resources, never as verbs in the path. For example, a password reset is `POST /users/{id}/password-resets`, not `/users/{id}/reset`.

| Method | Meaning | Success |
| --- | --- | --- |
| `GET` | List or read | 200 |
| `POST` | Create | **201** with `Location` (and `ETag`). Token grants return 200 (RFC 6749). |
| `PATCH` | Partial update; only the fields sent change | 200 with the updated resource and new `ETag` |
| `PUT` | Replace (e.g. `PUT /users/me/password`) | 200 or 204 |
| `DELETE` | Remove, deactivate or soft-delete. Deactivating an already disabled user is still 204; a resource that does not exist is 404. | 204 |

Shop-owned resources are nested under their shop: `/api/v1/shops/{shop_id}/members`, and in Phase 2 `.../products`, `.../sales` and so on.

### Current endpoints (Phase 1)

| Resource | Endpoints | Who |
| --- | --- | --- |
| Tokens | `POST /tokens` (`grant_type=password` or `refresh_token`) | anyone |
| Sessions | `GET /sessions`, `DELETE /sessions/current`, `DELETE /sessions/{id}` | yourself |
| Me | `GET /users/me`, `PUT /users/me/password` | yourself |
| Users | `GET, POST /users`; `GET, PATCH, DELETE /users/{id}`; `POST /users/{id}/password-resets` | system admin |
| Roles | `GET /roles`, `GET /permissions` | signed in |
| Shops | `GET, POST /shops`; `GET, PATCH /shops/{id}` | admin (all shops), keeper (own shops), members (read) |
| Members | `GET, POST /shops/{id}/members`; `GET, PATCH, DELETE .../members/{user_id}`; `POST .../members/{user_id}/password-resets` | keeper (`members:manage`); admin can read |
| Audit logs | `GET /audit-logs` (admin), `GET /shops/{id}/audit-logs` (keeper; admin can read) | see column |

## Authentication and sessions

1. Sign in: `POST /api/v1/tokens` with `{"grant_type":"password","email","password","device_id"}`. The response contains `access_token` (a JWT, 15 minutes), `refresh_token` and `user`.
2. Send `Authorization: Bearer <access_token>` on every request.
3. When you get **401**, refresh: `POST /api/v1/tokens` with `{"grant_type":"refresh_token","refresh_token"}`. **Refresh tokens are single use.** Store the new one straight away. If a spent token is used again, the whole session is revoked (`refresh_token_reused`), so clients must never run two refreshes at once.
4. If `user.must_change_password` is true, every endpoint except `GET /users/me`, `PUT /users/me/password` and `DELETE /sessions/current` returns **403 `password_change_required`**.
5. Logout is `DELETE /sessions/current`. Changing your password signs out your other devices. Deactivating a user or resetting their password signs them out everywhere, and it takes effect on their very next request.

## Authorization

- **System permissions** come from the role (`system_admin`, `shop_keeper`, `shop_sitter`).
- **Shop permissions** come from the caller's membership in the shop named in the path.
  - Keepers have all of them.
  - Sitters have `catalogue:read` and `sales:create`, plus any of `sales:read`, `catalogue:write`, `stock:write`, `sales:refund` and `reports:read` granted by the keeper.
  - `GET /roles` and `GET /permissions` return the live catalogue.
- A shop you are not a member of returns **404** (not 403). Missing a permission inside your own shop returns **403 `permission_denied`**.
- Permission changes apply on the next request; there is no need to sign in again.

## Lists: filtering, sorting, pagination

```
GET /api/v1/users?role=shop_keeper&status=active&q=tha&sort=-created_at,name&limit=50&cursor=...
```

```json
{ "data": [ ... ], "page": { "next_cursor": "eyJzIjoi...", "limit": 50 } }
```

- **Filters** are plain query parameters named after the field. `q` is free-text search where it is offered, and `from`/`to` are ISO 8601 time windows (`from` included, `to` excluded).
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

Keys are scoped to the caller and the endpoint. The OpenAPI document marks each POST with `x-idempotency-key: optional | required`. From Phase 2, endpoints that move money or stock (sales, refunds, stock movements) **require** it.

## Rate limiting

| Scope | Default |
| --- | --- |
| Password sign-in, per IP + email | 5 / minute. After 10 failures the account is locked for 15 minutes (**423 `account_locked`**). |
| Signed-in requests, per user | 300 / minute |
| Anonymous requests, per IP | 60 / minute |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. Going over the limit returns **429 `rate_limited`** with `Retry-After` in seconds. The limits are configurable (`RATE_LIMIT_*` in `api/.env.example`).

## Errors

Every error has the same shape:

```json
{ "error": { "code": "email_taken", "message": "A user with this email already exists", "details": null } }
```

Clients branch on `code` (stable) and show `message` (for people). Validation errors (422 `validation_error`) list the failing fields in `details`, without echoing the values that were sent.

| Status | Codes |
| --- | --- |
| 400 | `bad_request`, `invalid_sort`, `invalid_cursor`, `invalid_if_match`, `idempotency_key_required`, `invalid_idempotency_key` |
| 401 | `unauthorized`, `invalid_token`, `invalid_credentials`, `session_revoked`, `account_disabled`, `refresh_token_reused` |
| 403 | `forbidden`, `permission_denied`, `password_change_required` |
| 404 | `not_found` |
| 409 | `email_taken`, `membership_exists`, `cannot_modify_self`, `role_change_blocked`, `last_admin`, `not_a_sitter`, `idempotency_in_progress` |
| 412 | `version_mismatch` |
| 422 | `validation_error`, `idempotency_key_reused`, `invalid_current_password`, `password_reused`, `owner_required`, `invalid_owner`, `shop_not_found` |
| 423 | `account_locked` |
| 429 | `rate_limited` |
| 500 | `internal_error` |

Every response carries `x-request-id` (or echoes the one you sent). Quote it when reporting a problem. It is also stored on audit entries.

## Audit log

Every change writes one entry **in the same transaction** as the change: who (`actor_id`, `actor_role`, `actor_email`), what (`action` such as `member.updated`, plus `entity` and `entity_id`), where (`shop_id`), the field-level `changes` (`{"field": {"from", "to"}}`, never secrets), and `request_id`, `ip`, `user_agent` and `device_id`. Sign-ins (`session.created`), failed sign-ins (`auth.login_failed`) and lockouts (`user.locked`) are recorded too. Entries are never edited or deleted by the application.
