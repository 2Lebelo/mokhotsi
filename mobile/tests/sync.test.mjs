import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ApiClient } from "../src/api/client.ts";
import { MIGRATIONS } from "../src/db/migrations/index.ts";
import { migrateDatabase } from "../src/db/schema.ts";
import { LOCAL_ACTOR, ShopStore } from "../src/db/store.ts";
import { decodeF16, encodeF16, fromHalf, toHalf } from "../src/ml/float16.ts";
import { l2Normalize } from "../src/ml/vector.ts";
import { describeIssue } from "../src/features/admin/sync-issue-text.ts";
import { syncStatusText } from "../src/features/sync/sync-text.ts";
import { derivedViewId } from "../src/sync/ids.ts";
import { retryDelay, SyncScheduler } from "../src/sync/scheduler.ts";
import { ShopSync } from "../src/sync/shop-sync.ts";

const MODEL = "test-model@1";
const SHOP = randomUUID();

// --- Local database (node:sqlite behind the synchronous expo-sqlite API) ------------------

function connect(filename) {
  const native = new DatabaseSync(filename);
  return {
    close: () => native.close(),
    execSync: (sql) => native.exec(sql),
    getFirstSync: (sql, ...params) => native.prepare(sql).get(...params) ?? null,
    getAllSync: (sql, ...params) => native.prepare(sql).all(...params),
    getEachSync: (sql, ...params) => native.prepare(sql).iterate(...params),
    runSync: (sql, ...params) => native.prepare(sql).run(...params),
    withTransactionSync(callback) {
      native.exec("BEGIN");
      try {
        callback();
        native.exec("COMMIT");
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** One phone: its shop file, its files, and a store acting as `actor`. */
function phone(t, server, { claimant = false, actor = LOCAL_ACTOR, migrate = true, clock = () => new Date() } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "mokhotsi-sync-"));
  const db = connect(join(folder, "shop.db"));
  if (migrate) migrateDatabase(db);
  t.after(() => {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  });
  const deviceId = randomUUID();
  const files = fakeFiles(server);
  const context = { newId: randomUUID, clock, actor };
  const store = () => new ShopStore(db, context);
  const sync = () =>
    new ShopSync({
      api: client(server, deviceId),
      store: new ShopStore(db, { ...context, actor: LOCAL_ACTOR }),
      files,
      shopId: SHOP,
      deviceId,
      claimant,
      modelVersion: MODEL,
    }).run();
  return { db, files, store, sync, deviceId };
}

function client(server, deviceId) {
  return new ApiClient({
    baseUrl: "https://api.test",
    newId: randomUUID,
    fetch: (url, init) => server.fetch(url, init),
    sleep: async () => {},
    random: () => 0.5,
    deviceCredential: async () => ({ device_id: deviceId, device_secret: "s".repeat(43) }),
  });
}

const sha = (text) => createHash("sha256").update(text).digest("hex");

/** Files as bytes in memory; uploads and downloads go through the fake server's cloud. */
function fakeFiles(server) {
  const contents = new Map();
  return {
    contents,
    uploads: [],
    async sha256(uri) {
      return sha(contents.get(uri));
    },
    exists: (uri) => contents.has(uri),
    size: (uri) => contents.get(uri)?.length ?? 0,
    async upload(uri, ticket) {
      this.uploads.push(ticket.fields.public_id);
      server.cloud.set(ticket.fields.public_id.split("/").at(-1), contents.get(uri));
      return { public_id: ticket.fields.public_id, version: 1, signature: "sig", format: "jpg", bytes: 1, width: 1, height: 1 };
    },
    async download(url, uri) {
      contents.set(uri, server.cloud.get(url.split("/").at(-1)));
    },
    uriFor: (hash) => `file:///synced/${hash}.jpg`,
  };
}

// --- A small fake of the API's sync (same rules as api/app/services/sync_*.py) ------------

function fakeServer() {
  const server = {
    seq: 0,
    feed: [],
    records: new Map(), // "entity:id" → record
    lines: new Map(), // sale item id → { variant_id, quantity }
    applied: new Set(),
    cloud: new Map(), // sha256 → bytes
    pushes: [],
    /** Issues phones reported, by id. */
    issues: new Map(),
    /** Changes per pull page (the phone asks for 500). */
    pageSize: null,
    /** (op) → rejection code, or null to accept. */
    refuse: () => null,
    /** (path, call) → a canned response, or undefined for the normal behaviour. */
    override: () => undefined,
    change(entity, id, record) {
      server.records.set(`${entity}:${id}`, record);
      server.feed.push({ seq: ++server.seq, entity, id });
    },
    stock(variantId) {
      return server.records.get(`stock_levels:${variantId}`)?.stock ?? 0;
    },
    move(variantId, delta) {
      server.change("stock_levels", variantId, { variant_id: variantId, stock: server.stock(variantId) + delta });
    },
    apply(op) {
      const p = op.payload;
      switch (op.entity) {
        case "products":
          return server.change("products", p.id, p);
        case "stock_movements":
          return server.move(p.variant_id, p.delta);
        case "sales":
          for (const item of p.items) {
            server.lines.set(item.id, item);
            if (!p.imported) server.move(item.variant_id, -item.quantity);
          }
          return server.change("sales", p.id, p);
        case "reversals":
          for (const item of p.items)
            if (item.restocked && !p.imported) server.move(server.lines.get(item.sale_item_id).variant_id, item.quantity);
          return server.change("reversals", p.id, p);
        case "embeddings":
          if (op.op === "delete") {
            const stored = server.records.get(`embeddings:${p.id}`);
            if (stored) server.change("embeddings", p.id, { id: p.id, product_id: stored.product_id, deleted: true });
            return;
          }
          if (!server.records.has(`embeddings:${p.id}`)) server.change("embeddings", p.id, p);
      }
    },
    respond(path, call, url) {
      if (path.endsWith("/tokens"))
        return { body: { access_token: "device-token", token_type: "bearer", expires_in: 900, device_id: call.body.device_id } };
      if (path.endsWith("/sync/push")) {
        server.pushes.push(call.body.ops.length);
        const acked = [];
        const rejected = [];
        for (const op of call.body.ops) {
          if (server.applied.has(op.op_id)) {
            acked.push(op.op_id);
            continue;
          }
          const code = server.refuse(op);
          if (code) {
            rejected.push({ op_id: op.op_id, code, message: `${code}!` });
            continue;
          }
          server.apply(op);
          server.applied.add(op.op_id);
          acked.push(op.op_id);
        }
        return { body: { acked, rejected, flagged: [], seq: String(server.seq) } };
      }
      if (path.endsWith("/sync/pull")) {
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        const limit = server.pageSize ?? Number(url.searchParams.get("limit") ?? 500);
        const page = server.feed.filter((entry) => entry.seq > cursor).slice(0, limit);
        const last = new Map(page.map((entry) => [`${entry.entity}:${entry.id}`, entry]));
        const changes = [...last.values()]
          .sort((a, b) => a.seq - b.seq)
          .map((entry) => ({ seq: entry.seq, entity: entry.entity, record: server.records.get(`${entry.entity}:${entry.id}`) }));
        const next = page.at(-1)?.seq ?? cursor;
        return { body: { changes, next_cursor: String(next), has_more: next < server.seq } };
      }
      if (path.endsWith("/sync/snapshot")) {
        const entity = url.searchParams.get("entity");
        const records = [...server.records]
          .filter(([key, record]) => key.startsWith(`${entity}:`) && !record.deleted)
          .map(([, record]) => record);
        return { body: { entity, records, after: null, has_more: false, snapshot_seq: String(server.seq) } };
      }
      if (path.endsWith("/sync/issues")) {
        for (const issue of call.body.issues) if (!server.issues.has(issue.id)) server.issues.set(issue.id, issue);
        return { body: { accepted: call.body.issues.map((issue) => issue.id) } };
      }
      if (path.endsWith("/photos/uploads"))
        return {
          body: {
            tickets: call.body.items.map((item) => ({
              sha256: item.sha256,
              existing: server.cloud.has(item.sha256),
              upload_url: "https://cloud.test/upload",
              fields: { public_id: `shops/${SHOP}/${item.sha256}`, signature: "s" },
              expires_at: new Date().toISOString(),
            })),
          },
        };
      if (path.endsWith("/photos/confirm"))
        return { body: { confirmed: call.body.items.map((item) => item.sha256), rejected: [] } };
      if (path.endsWith("/photos/urls"))
        return {
          body: {
            urls: Object.fromEntries(
              call.body.sha256s.map((hash) => [hash, server.cloud.has(hash) ? `https://cdn.test/${hash}` : null]),
            ),
          },
        };
      throw new Error(`unexpected ${path}`);
    },
    async fetch(raw, init) {
      const url = new URL(raw);
      const call = { url: raw, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
      const canned = server.override(url.pathname, call);
      if (canned instanceof Error) throw canned;
      const { status = 200, body = null } = canned ?? server.respond(url.pathname, call, url);
      return new Response(body === null ? null : JSON.stringify(body), { status });
    },
  };
  return server;
}

// --- Helpers ------------------------------------------------------------------------------

function saveProduct(store, { name = "Maize meal", stock = 10, barcode = null, photo = null, hash } = {}) {
  const productId = store.catalogue.saveProduct({
    name,
    category: "Groceries",
    photo_uri: photo,
    photo_hash: hash,
    variants: [{ size_milli: 1000, unit: "pcs", price_cents: 500, stock, barcode }],
  });
  return { productId, variantId: store.catalogue.product(productId).variants[0].id };
}

function sell(store, variantId, quantity) {
  store.cart.setQuantity(variantId, quantity);
  const saleId = randomUUID();
  store.sales.checkout(saleId);
  return saleId;
}

const unit = (...values) => l2Normalize(new Float32Array(values));
const stockOf = (store, variantId) => store.catalogue.variant(variantId).stock;

// --- Pure pieces --------------------------------------------------------------------------

test("float16 vectors round-trip within 1e-4 cosine and reject a wrong length", () => {
  assert.equal(fromHalf(toHalf(1)), 1);
  assert.equal(fromHalf(toHalf(-0.5)), -0.5);
  assert.equal(fromHalf(toHalf(65504)), 65504);
  assert.equal(fromHalf(toHalf(1e6)), Infinity);
  const vector = l2Normalize(Float32Array.from({ length: 1280 }, (_, i) => Math.abs(Math.sin(i * 7.3))));
  const back = decodeF16(encodeF16(vector), 1280);
  let cosine = 0;
  for (let i = 0; i < vector.length; i++) cosine += vector[i] * back[i];
  assert.ok(cosine > 0.9999, `cosine ${cosine}`);
  assert.throws(() => decodeF16(encodeF16(vector), 4), /4 values/);
});

test("derived view ids are the same on every phone, and differ by model, image and crop", async () => {
  const digest = async (data) => new Uint8Array(createHash("sha256").update(data).digest());
  const image = sha("photo");
  const a = await derivedViewId(digest, MODEL, image, 0);
  assert.equal(a, await derivedViewId(digest, MODEL, image, 0));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const others = await Promise.all([
    derivedViewId(digest, "next@2", image, 0),
    derivedViewId(digest, MODEL, sha("other"), 0),
    derivedViewId(digest, MODEL, image, 1),
  ]);
  assert.equal(new Set([a, ...others]).size, 4);
});

test("retries back off with jitter up to 15 minutes, never below 5 seconds", () => {
  assert.equal(retryDelay(1, () => 1), 30_000);
  assert.equal(retryDelay(3, () => 1), 120_000);
  assert.equal(retryDelay(20, () => 1), 900_000);
  assert.equal(retryDelay(4, () => 0), 5_000);
});

test("the scheduler runs once for a burst of triggers and backs off after a failure", async () => {
  const timers = [];
  let now = 0;
  const runs = [];
  let outcome = "offline";
  const scheduler = new SyncScheduler({
    shops: () => ["a", "b"],
    sync: async (shopId) => {
      runs.push(shopId);
      return { state: outcome, pending: 0, lastSyncedAt: null };
    },
    onStatus: () => {},
    now: () => now,
    random: () => 1,
    setTimer: (run, ms) => {
      const timer = { run, at: now + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => (timer.cleared = true),
  });
  const fire = async () => {
    const due = timers.filter((t) => !t.cleared).sort((a, b) => a.at - b.at)[0];
    due.cleared = true;
    now = due.at;
    await due.run();
    await new Promise((resolve) => setImmediate(resolve));
  };
  const armed = () => timers.filter((t) => !t.cleared);

  scheduler.nudge(); // In the background: nothing.
  assert.equal(armed().length, 0);
  scheduler.setActive(true);
  scheduler.nudge(); // A run is already due now; a later one is not added.
  scheduler.syncNow();
  assert.equal(armed().length, 1);
  await fire();
  assert.deepEqual(runs, ["a", "b"]);
  assert.equal(armed()[0].at - now, 30_000); // First failure: retry within 30 s.

  outcome = "synced";
  scheduler.networkBack(); // The network is back: try now.
  await fire();
  assert.equal(armed()[0].at - now, 5 * 60_000); // Fine: next check in 5 minutes.
  scheduler.setActive(false);
  assert.equal(armed().length, 0);
});

test("a flush waits for a run that started after it, even in the background", async () => {
  let pending = 3;
  let release;
  const runs = [];
  const scheduler = new SyncScheduler({
    shops: () => ["a"],
    sync: async (shopId) => {
      runs.push(shopId);
      const seen = pending;
      if (release === undefined) await new Promise((resolve) => (release = resolve));
      return { state: "synced", pending: seen, lastSyncedAt: null };
    },
    onStatus: () => {},
    setTimer: () => null,
    clearTimer: () => {},
  });
  const first = scheduler.flush(); // Inactive (in the background): it still runs.
  await new Promise((resolve) => setImmediate(resolve));
  pending = 0; // The sale queued before this call is sent by the next run only.
  const second = scheduler.flush();
  release();
  assert.deepEqual(await first, { a: { state: "synced", pending: 3, lastSyncedAt: null } });
  assert.deepEqual(await second, { a: { state: "synced", pending: 0, lastSyncedAt: null } });
  assert.deepEqual(runs, ["a", "a"]);
});

test("the menu explains the sync state in plain words", () => {
  const base = { pending: 0, lastSyncedAt: null };
  const now = Date.parse("2026-10-27T10:00:00Z");
  assert.equal(syncStatusText(null), "Checking…");
  assert.equal(syncStatusText({ ...base, state: "offline", pending: 3 }), "Offline · 3 changes waiting");
  assert.equal(syncStatusText({ ...base, state: "synced", lastSyncedAt: "2026-10-27T09:58:00Z" }, now), "Synced 2 min ago");
  assert.equal(syncStatusText({ ...base, state: "synced", pending: 1 }), "1 change waiting to sync");
  assert.equal(syncStatusText({ ...base, state: "update_required" }), "Update the app to keep syncing");
  const refused = describeIssue({ kind: "rejected", entity: "products", code: "permission_denied", message: "x" });
  assert.equal(refused.title, "A product change was not accepted");
  assert.match(refused.detail, /no longer allowed/);
});

// --- Migration ----------------------------------------------------------------------------

test("upgrading a v7 file keeps queued changes in order and accepts embedding ops", (t) => {
  const p = phone(t, fakeServer(), { migrate: false });
  for (const migration of MIGRATIONS.slice(0, 7))
    p.db.withTransactionSync(() => {
      migration.up(p.db);
      p.db.execSync(`PRAGMA user_version = ${migration.version}`);
    });
  p.db.runSync("UPDATE sync_state SET value = 'bound' WHERE key = 'mode'");
  const now = new Date().toISOString();
  for (const id of ["b", "a"])
    p.db.runSync("INSERT INTO outbox (op_id, entity, entity_id, payload, created_at) VALUES (?, 'sales', ?, '{}', ?)", `op-${id}`, id, now);
  migrateDatabase(p.db);
  assert.deepEqual(
    p.db.getAllSync("SELECT op_id FROM outbox ORDER BY seq").map((row) => row.op_id),
    ["op-b", "op-a"],
  );
  const store = p.store();
  const { productId } = saveProduct(store);
  store.embeddings.add({ productId, modelVersion: MODEL, vector: unit(1, 0), source: "correction", imageUri: null });
  assert.equal(store.outbox.pending().at(-1).entity, "embeddings");
});

test("upgrading a file that dropped records downloads the shop again and clears those issues", (t) => {
  const p = phone(t, fakeServer(), { migrate: false });
  for (const migration of MIGRATIONS.slice(0, 8))
    p.db.withTransactionSync(() => {
      migration.up(p.db);
      p.db.execSync(`PRAGMA user_version = ${migration.version}`);
    });
  p.db.runSync("UPDATE sync_state SET value = 'bound' WHERE key = 'mode'");
  const now = new Date().toISOString();
  const issue = (id, kind, message) =>
    p.db.runSync("INSERT INTO sync_issues (id, kind, entity, entity_id, code, message, created_at) VALUES (?, ?, 'sales', 'x', 'conflict', ?, ?)", id, kind, message, now);
  issue("fk", "conflict", "Call to function 'NativeStatement.finalizeSync' has been rejected. Caused by: Error code : FOREIGN KEY constraint failed");
  issue("other", "rejected", "permission_denied!");
  migrateDatabase(p.db);
  const store = p.store();
  assert.deepEqual(store.sync.issues().map((row) => row.id), ["other"]);
  assert.deepEqual(store.sync.snapshot(), {
    remaining: ["products", "stock_levels", "sales", "reversals", "embeddings"],
    after: null,
    seq: null,
  });
});

// --- Binding ------------------------------------------------------------------------------

test("an unbound shop queues nothing; binding the claimant queues its history in order", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const store = a.store();
  const { productId, variantId } = saveProduct(store, { stock: 10 });
  sell(store, variantId, 2);
  store.embeddings.add({ productId, modelVersion: MODEL, vector: unit(1, 0), source: "correction", imageUri: null });
  assert.equal(store.outbox.pendingCount(), 0, "nothing is queued before the shop is bound");

  const outcome = await a.sync();
  assert.equal(outcome.state, "synced");
  assert.equal(store.outbox.pendingCount(), 0);
  assert.deepEqual(
    server.feed.filter((e) => e.entity !== "stock_levels").map((e) => e.entity),
    ["products", "sales", "embeddings"],
  );
  assert.equal(server.stock(variantId), 8, "the server starts from this phone's stock");
  const [, sale] = [...server.records].find(([key]) => key.startsWith("sales:"));
  assert.equal(sale.imported, true, "past sales are marked imported");
  assert.equal(stockOf(store, variantId), 8, "the phone's figure does not move");
  assert.equal(store.sync.isBound(), true);
});

test("another phone empties what it had and downloads the shop; then both converge", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { variantId } = saveProduct(a.store(), { stock: 10 });
  await a.sync();

  const b = phone(t, server);
  saveProduct(b.store(), { name: "Left over from testing" });
  assert.equal((await b.sync()).state, "synced");
  const products = b.store().catalogue.products();
  assert.deepEqual(products.map((p) => p.name), ["Maize meal"]);
  assert.equal(stockOf(b.store(), variantId), 10);

  sell(b.store(), variantId, 3); // Sold on B …
  await b.sync();
  await a.sync(); // … and A learns of it.
  assert.equal(stockOf(a.store(), variantId), 7);
  assert.equal(a.store().sales.list().length, 1);
  assert.equal(stockOf(b.store(), variantId), 7);
});

// --- Push ---------------------------------------------------------------------------------

test("stock stays right between an ack and the pull that reflects it", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { variantId } = saveProduct(a.store(), { stock: 10 });
  await a.sync();
  sell(a.store(), variantId, 2);
  const store = a.store();
  // The server acked the sale (seq ahead of this phone's cursor), no pull yet.
  store.transaction(() => store.outbox.ack(store.outbox.pending().map((op) => op.op_id), 99));
  store.stock.rebase(Number(store.sync.cursor()));
  assert.equal(stockOf(store, variantId), 8);
});

test("a refused change is parked and reported, and its stock change drops out", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { productId, variantId } = saveProduct(a.store(), { stock: 10 });
  await a.sync();
  server.refuse = (op) => (op.entity === "stock_movements" ? "permission_denied" : null);
  const store = a.store();
  const product = store.catalogue.product(productId);
  store.catalogue.saveProduct(
    { ...product, variants: [{ ...product.variants[0], stock: 4, stock_baseline: 10 }] },
    productId,
  );
  store.cart.setQuantity(variantId, 1);
  store.sales.checkout(randomUUID()); // A later change still goes through.
  await a.sync();
  assert.equal(server.stock(variantId), 9);
  assert.equal(stockOf(store, variantId), 9, "the refused count no longer counts");
  const [issue] = server.issues.values();
  assert.equal(issue.kind, "rejected");
  assert.equal(issue.code, "permission_denied");
  assert.deepEqual(store.sync.issues(), [], "reported, so this phone no longer keeps it");
  assert.equal(store.outbox.pendingCount(), 0);
});

test("a push that is too large is split in halves", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const store = a.store();
  for (let n = 0; n < 4; n++) saveProduct(store, { name: `P${n}`, stock: 0 });
  let tooLarge = true;
  server.override = (path, call) => {
    if (path.endsWith("/sync/push") && tooLarge && call.body.ops.length > 2) {
      tooLarge = false;
      return { status: 413, body: { error: { code: "payload_too_large", message: "split" } } };
    }
  };
  assert.equal((await a.sync()).state, "synced");
  assert.deepEqual(server.pushes, [2, 2]);
});

test("without a connection the run says offline; a removed phone stops", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  saveProduct(a.store());
  server.override = () => new TypeError("Network request failed");
  assert.equal((await a.sync()).state, "offline");
  // Bound offline: the product and its opening stock wait on the phone.
  assert.equal(a.store().outbox.pendingCount(), 2);

  server.override = (path) =>
    path.endsWith("/tokens") ? undefined : { status: 401, body: { error: { code: "device_revoked", message: "gone" } } };
  assert.equal((await a.sync()).state, "revoked");
});

// --- Pull ---------------------------------------------------------------------------------

test("a pulled change never overwrites this phone's unsent edit", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { productId } = saveProduct(a.store());
  await a.sync();
  server.change("products", productId, { ...server.records.get(`products:${productId}`), name: "From the other till" });
  server.override = (path) => (path.endsWith("/sync/push") ? new TypeError("offline") : undefined);
  const store = a.store();
  const product = store.catalogue.product(productId);
  store.catalogue.saveProduct({ ...product, name: "Mine" }, productId);
  await a.sync(); // Push fails, so the run stops before pulling.
  assert.equal(store.catalogue.product(productId).name, "Mine");
  server.override = () => undefined;
  await a.sync();
  assert.equal(store.catalogue.product(productId).name, "Mine", "the server got it; last write wins");
});

test("a pulled product that clashes is reported, and the rest of the page still applies", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  saveProduct(a.store(), { name: "Sugar", barcode: "6001234567890" });
  await a.sync();
  const variant = (barcode) => ({ id: randomUUID(), size_milli: 1000, unit: "pcs", price_cents: 100, cost_cents: null, barcode, position: 0, archived_at: null });
  const product = (name, barcode) => ({ id: randomUUID(), name, category: "Groceries", photos: [], updated_by: "local", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), variants: [variant(barcode)] });
  const clash = product("Other sugar", "6001234567890");
  const fine = product("Salt", null);
  server.change("products", clash.id, clash);
  server.change("products", fine.id, fine);
  await a.sync();
  const store = a.store();
  assert.deepEqual(store.catalogue.products().map((p) => p.name).sort(), ["Salt", "Sugar"]);
  assert.equal([...server.issues.values()][0].kind, "conflict");
  assert.equal(store.sync.cursor(), String(server.seq), "the cursor moved past the page");
});

test("a sale and views sent before their edited product still apply on another phone", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const b = phone(t, server);
  await a.sync();
  await b.sync();
  const store = a.store();
  const { productId, variantId } = saveProduct(store, { stock: 10 });
  store.embeddings.add({ productId, modelVersion: MODEL, vector: unit(1, 0), source: "correction", imageUri: null });
  sell(store, variantId, 2);
  await a.sync();
  const product = store.catalogue.product(productId);
  store.catalogue.saveProduct({ ...product, name: "Maize meal 1 kg" }, productId);
  await a.sync(); // The product now sits after its sale and view in the feed.

  await b.sync();
  const there = b.store();
  assert.equal(server.issues.size, 0);
  assert.equal(there.catalogue.product(productId).name, "Maize meal 1 kg");
  assert.equal(there.sales.list().length, 1);
  assert.equal(there.embeddings.count(MODEL), 1);
  assert.equal(stockOf(there, variantId), 8);
});

/** A product, and a sale of it, as the server sends them. */
function remoteSale() {
  const at = new Date().toISOString();
  const variant = { id: randomUUID(), size_milli: 1000, unit: "pcs", price_cents: 500, cost_cents: null, barcode: null, position: 0, archived_at: null };
  const product = { id: randomUUID(), name: "Bread", category: "Bakery", photos: [], updated_by: "local", created_at: at, updated_at: at, variants: [variant] };
  const sale = {
    id: randomUUID(), total_cents: 500, tendered_cents: 500, change_cents: 0, actor_user_id: randomUUID(), device_id: randomUUID(), imported: false, created_at: at,
    items: [{ id: randomUUID(), product_id: product.id, variant_id: variant.id, product_name: "Bread", variant_label: "1 pcs", category: "Bakery", barcode: null, quantity: 1, unit_price_cents: 500, line_total_cents: 500, unit_cost_cents: null }],
  };
  return { product, sale };
}

test("a record whose product comes in a later page waits for it instead of failing", async (t) => {
  const server = fakeServer();
  const b = phone(t, server);
  await b.sync();
  const { product, sale } = remoteSale();
  server.change("sales", sale.id, sale);
  server.change("products", product.id, product);
  server.pageSize = 1; // The sale's page has no product in it.
  assert.equal((await b.sync()).state, "synced");
  const store = b.store();
  assert.equal(store.sales.list().length, 1);
  assert.equal(server.issues.size, 0);
  assert.equal(store.remote.parkedCount(), 0);
});

test("a record still waiting a day later is reported once, and applies if it ever can", async (t) => {
  const server = fakeServer();
  let now = Date.parse("2026-10-28T08:00:00Z");
  const b = phone(t, server, { clock: () => new Date(now) });
  await b.sync();
  const { product, sale } = remoteSale();
  server.change("sales", sale.id, sale);
  await b.sync();
  const store = b.store();
  assert.equal(store.remote.parkedCount(), 1);
  assert.equal(server.issues.size, 0, "not reported while it may still come");

  now += 25 * 60 * 60_000;
  await b.sync();
  await b.sync();
  const issues = [...server.issues.values()];
  assert.equal(issues.length, 1, "reported once");
  assert.equal(issues[0].code, "missing_reference");
  assert.equal(issues[0].entity_id, sale.id);

  server.change("products", product.id, product);
  await b.sync();
  assert.equal(store.sales.list().length, 1);
  assert.equal(store.remote.parkedCount(), 0);
});

test("a pruned history makes the phone download the shop again", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { variantId } = saveProduct(a.store(), { stock: 5 });
  await a.sync();
  let expired = true;
  server.override = (path) => {
    if (path.endsWith("/sync/pull") && expired) {
      expired = false;
      return { status: 410, body: { error: { code: "cursor_expired", message: "too old" } } };
    }
  };
  assert.equal((await a.sync()).state, "synced");
  assert.equal(stockOf(a.store(), variantId), 5);
  assert.equal(a.store().sync.snapshot(), null);
});

test("pulled views of other models are ignored and a deleted view goes", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  const { productId } = saveProduct(a.store());
  await a.sync();
  const view = (model) => ({ id: randomUUID(), product_id: productId, model_version: model, source: "correction", image_sha256: null, dim: 2, vector_f16: encodeF16(unit(1, 0)), created_at: new Date().toISOString() });
  const mine = view(MODEL);
  const other = view("older@0");
  server.change("embeddings", mine.id, mine);
  server.change("embeddings", other.id, other);
  await a.sync();
  assert.equal(a.store().embeddings.count(MODEL), 1);
  assert.equal(a.store().embeddings.count("older@0"), 0);
  server.change("embeddings", mine.id, { id: mine.id, product_id: productId, deleted: true });
  await a.sync();
  assert.equal(a.store().embeddings.count(MODEL), 0);
});

test("pruning and replacing views queues their deletion; dropping another model's does not", async (t) => {
  const a = phone(t, fakeServer(), { claimant: true });
  await a.sync();
  const store = a.store();
  const { productId } = saveProduct(store, { photo: "file:///p/a.jpg" });
  for (let i = 0; i < 3; i++)
    store.embeddings.add({ productId, modelVersion: MODEL, vector: unit(1, i), source: "correction", imageUri: null });
  store.embeddings.add({ productId, modelVersion: "older@0", vector: unit(1, 0), source: "photo", imageUri: "file:///p/a.jpg" });
  const before = store.outbox.pending().length;
  store.embeddings.pruneCorrections(productId, 1);
  assert.deepEqual(store.outbox.pending().slice(before).map((op) => op.op), ["delete", "delete"]);
  const after = store.outbox.pending().length;
  store.embeddings.removeStalePhotos(MODEL);
  assert.equal(store.outbox.pending().length, after, "older models are dropped here only");
});

// --- Images -------------------------------------------------------------------------------

test("photos upload before the change that uses them, and other phones download them", async (t) => {
  const server = fakeServer();
  const a = phone(t, server, { claimant: true });
  a.files.contents.set("file:///photos/a.jpg", "jpeg-bytes");
  const hash = sha("jpeg-bytes");
  const { productId } = saveProduct(a.store(), { photo: "file:///photos/a.jpg" });
  await a.sync();
  assert.deepEqual(a.files.uploads, [`shops/${SHOP}/${hash}`]);
  assert.deepEqual(server.records.get(`products:${productId}`).photos, [{ slot: 0, sha256: hash }]);

  await a.sync();
  assert.equal(a.files.uploads.length, 1, "an uploaded photo is not sent again");

  const b = phone(t, server);
  await b.sync();
  const shown = b.store().catalogue.product(productId).photo_uri;
  assert.equal(shown, `file:///synced/${hash}.jpg`);
  assert.equal(b.files.contents.get(shown), "jpeg-bytes");
});
