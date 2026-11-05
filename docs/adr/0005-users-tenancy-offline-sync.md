# ADR 0005: Users, tenancy, and offline sync to MongoDB

- Status: Accepted by the product owner; amended 2026-10-24 (see "Amendment")
- Date: 2026-10-23
- Supersedes: the authentication and role parts of ADR 0002, and the "no sync"
  part of ADR 0003
- Keeps: ADR 0001's outbox, server `seq` ordering and idempotent `op_id`s

## Context

Every feature so far works offline on one phone with no accounts. Owners now
need to create cashiers, own several shops, and have their records backed up to
MongoDB. Shops in Lesotho lose signal for days, so selling, stock, reports and
reversals must keep working offline. Only staff management needs internet.

## Decision

**Roles.** A *system admin* is always online. They approve an owner when a business
registers, and manage owners, shops, users and devices, from an admin mode in the
mobile app. An *owner* owns one or more shops and has every shop permission. A
*cashier* sells in one shop, with extra permissions granted by the owner
(`contracts/permissions.json`). Code checks permissions, never role names. Cost
and profit visibility (`costs:read`) and reversals (`sales:refund`) are separate
permissions.

**Sign-in.** Owners and cashiers sign in with a five-digit PIN only. PINs are
unique within a shop, so the PIN identifies the person, and an owner with several
shops on the phone then picks one. On a phone with no shop yet, owners and the admin
sign in with their phone number and PIN. There is no phone-number check (SMS) for now.

**Devices.** Registering a phone (online) gives it a long random secret, kept in
the Android Keystore. Sync is authenticated as the *device*, so it runs without
anyone signed in. A PIN is only accepted together with a registered device, which
makes a five-digit PIN workable. Each shop has a server-generated PIN key. The
roster on a phone holds `HMAC(pin_key, pin)` per member, never the PIN, so PINs
are checked offline. The phone locks for a growing time after five wrong PINs.

**Tenancy.** Every shop-owned document in MongoDB carries `shop_id`, every index
starts with it, and a device can only reach shops it is registered to. On the
phone each shop is its own SQLite file, so data from two shops cannot mix.

**Where data lives.**
- Sales, reversals and stock movements are facts made on a phone. They are
  insert-only and never rejected for being stale. A sale by a cashier removed
  while the till was offline is accepted and flagged for the owner.
- Products are last-write-wins by server `seq`.
- Stock is a ledger. Devices send movements, sales and reversals, never a stock
  figure, and receive `stock_levels`. A phone's stock is the server's figure plus
  its own unacknowledged movements. With several tills it can go below zero, which
  is shown as out of stock. Checkout still blocks on low stock, as today.
- Embedding vectors are derived on each phone from photos and taught views, and
  are never synced.
- A new phone downloads the catalogue and the last 90 days of sales. Older history
  stays on the server.

**The outbox.** Every repository write queues its op in the same SQLite
transaction (`outbox`). A product's pending op is replaced by its latest state, in
its original place in the queue and under a new op id. A sale is one op, and its
stock movements are derived from it. A stock edit is saved as the difference from
what the editor showed, so sales made meanwhile are never overwritten.

**Unregistered phones.** Until the owner registers, the app behaves exactly as
before: nothing is queued, and changes are made by `local`. Registering moves the
data into the shop's file and queues one snapshot of it. Earlier sales and
reversals are marked `imported`, so they are recorded without moving stock a
second time (the opening stock already reflects them). A pending shop keeps
working locally, and its queue is pushed once the admin approves it.

**The wire.** `contracts/sync.v2.schema.json`. Pull reads a per-shop changes feed
by `seq`, which is one indexed query per page. A cursor past the feed's retention
re-runs the snapshot. A phone is told when it hasn't synced for 30 days, and so is
the owner about any of their phones. Nobody is ever locked out for not syncing.

## Consequences

- Sales, reversals and stock edits record who made them on which phone.
- `product_variants.stock` may be negative. Stock edits no longer overwrite the
  figure, and every change is a row in `stock_movements`.
- The API changes: roles are renamed to owner and cashier, PIN and device grants
  are added, shops get approval statuses, and sync moves to v2. The v1 contract
  stays until the API serves v2.
- A restock done on another phone is only seen after this phone syncs, so a till
  may block a sale it could have made.
- PIN uniqueness tells someone who picks a taken PIN that a colleague uses it.
  This is accepted. Changes are rate-limited and audited.

## Amendment (2026-10-24)

Decided by the product owner while planning the identity release:

1. **The admin approves the owner, not each shop.** Registration is name, phone number
   and PIN, with no shop. A pending owner is signed in but holds no permissions and keeps
   selling on the phone as before. Once approved, an owner opens shops that are live at
   once. The admin can still suspend a shop (read-only: `shop_suspended`) or disable a user.
2. **The admin signs in with phone number + PIN**, not a password and authenticator code.
   Because that PIN reaches every shop, it is guarded harder than anyone else's: it locks
   after three wrong tries (others: five), each lockout doubles (up to 24 hours), every
   failure is audited as `auth.admin_login_failed`, and admin sessions last 12 hours.
   Guesses are rate-limited per IP and phone number before any PIN is hashed.
3. **Owners are identified by phone number** (E.164, unique). Cashiers have no phone
   number: a name and a PIN unique within their shop.
4. **Opening a shop asks for the owner's PIN again.** It proves it is them on that phone,
   and it is how the server computes their PIN tag with the new shop's key (it stores only
   an Argon2 hash of the PIN).
5. **Claiming a phone's data moves no files.** Each shop's data is its own SQLite file,
   recorded per phone in `device.db`; the shop that claims the phone's existing data keeps
   using `mokhotsi.db`. The server lets one phone claim per shop
   (`data_claimed_by_device`), so two phones never upload two catalogues. If the app stops
   between the server's claim and the phone's record, the next roster finishes it.
6. **Delivery in two releases.** Release A: registration, approval, shops, cashiers,
   phones, the roster and the PIN lock screen. Changes are not queued yet. Release B: data
   sync (v2), at which point the claimed data is uploaded as one snapshot.

## Amendment 2 (2026-10-26/27): sync v2 as built

Decided by the product owner while planning Release B:

1. **Embedding vectors and images sync.** This replaces "embedding vectors are never synced".
   Vectors travel as float16 tagged with `model_version`, so a new phone identifies products
   at once. A phone re-derives vectors from the images only when its model differs. Product
   photos and till correction crops are stored in **Cloudinary**:
   - the phone uploads straight to Cloudinary with fields the API signs, fixing
     `public_id = shops/<shop_id>/<sha256>`, `type=authenticated` and `overwrite=false`;
   - the API checks Cloudinary's signed upload response before recording the image;
   - other phones download through signed, non-expiring CDN URLs.
2. **Sync authenticates the phone** (device token) only. The shop comes from the path and
   the phone's `shop_ids`. A suspended shop can be read but takes no new data.
3. **Lost rights: facts are kept, edits are refused.** A sale, refund or stock change by
   someone removed from the shop, or no longer allowed to make it, already happened. It is
   kept and flagged for the owner (`member_history` remembers former members). A product edit
   by someone without `catalogue:write` is refused (`permission_denied`). `"local"` (changes
   made before registration) is accepted only from the phone holding the shop's data claim
   and is attributed to the owner.
4. **The change feed is gap-free.** Each push reserves its block of seqs at the very end of
   its transaction, so the counter is locked only for the commit, concurrent pushes from
   tills of the same shop retry in turn, and seq order is commit order. Pull reads in a
   snapshot session. A cursor whose history was pruned (180 days) gets
   `410 cursor_expired`, and the phone downloads a snapshot again.
5. **Stock is a ledger on the server too.** Sales, restocked reversal lines and movements
   write `stock_movements`, and `stock_levels` holds the sums, except for `imported` sales
   and reversals, which are already in the opening stock.
