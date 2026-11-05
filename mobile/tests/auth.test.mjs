import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ApiClient, ApiError } from "../src/api/client.ts";
import { MAX_FAILURES, OPEN, recordFailure, remainingMs } from "../src/auth/lockout.ts";
import { matchPin, pinTag } from "../src/auth/pin-match.ts";
import { canResume, parseSavedUnlock, RESUME_WINDOW_MS } from "../src/auth/resume.ts";
import { MemoryStore, Secrets } from "../src/auth/secrets.ts";
import { DEVICE_MIGRATIONS } from "../src/db/device/migrations.ts";
import { DeviceRepository } from "../src/db/device/repository.ts";
import { DATABASE_NAME, runMigrations } from "../src/db/schema.ts";
import {
  CASHIER_DEFAULTS,
  CASHIER_GRANTABLE,
  GRANT_LABELS,
  SHOP_PERMISSIONS,
} from "../src/domain/permissions.ts";
import { pinProblem } from "../src/domain/pin.ts";
import { fromBase64, hmacSha256, toHex, utf8 } from "../src/lib/hmac.ts";
import { checkSync, shopsToLeave, syncCheckText } from "../src/features/account/sign-out.ts";
import { RosterSync } from "../src/sync/roster.ts";

const here = dirname(fileURLToPath(import.meta.url));
const contracts = join(here, "..", "..", "contracts");
const sha256 = async (data) => new Uint8Array(createHash("sha256").update(data).digest());

function connect(filename) {
  const native = new DatabaseSync(filename);
  return {
    close: () => native.close(),
    execSync: (sql) => native.exec(sql),
    getFirstSync: (sql, ...params) => native.prepare(sql).get(...params) ?? null,
    getAllSync: (sql, ...params) => native.prepare(sql).all(...params),
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

function deviceFixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "mokhotsi-device-"));
  const filename = join(folder, "device.db");
  let db = connect(filename);
  runMigrations(db, DEVICE_MIGRATIONS);
  t.after(() => {
    db.close();
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  });
  return {
    get repo() {
      return new DeviceRepository(db);
    },
    reopen() {
      db.close();
      db = connect(filename);
      runMigrations(db, DEVICE_MIGRATIONS);
    },
  };
}

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);
const tag = (key, pin) => createHmac("sha256", key).update(pin).digest("hex");

function rosterFor({ deviceId = "device-1", claimedBy = null } = {}) {
  return {
    device_id: deviceId,
    shops: [
      {
        id: "shop-a",
        name: "Main Shop",
        status: "active",
        roster_version: 3,
        pin_key: KEY_A.toString("base64"),
        data_claimed_by_device: claimedBy,
        members: [
          member("owner-1", "Lerato", "owner", tag(KEY_A, "52914")),
          member("cashier-1", "Thabo", "cashier", tag(KEY_A, "73051"), ["catalogue:read", "sales:create"]),
        ],
      },
      {
        id: "shop-b",
        name: "Second",
        status: "suspended",
        roster_version: 1,
        pin_key: KEY_B.toString("base64"),
        data_claimed_by_device: null,
        members: [member("owner-1", "Lerato", "owner", tag(KEY_B, "52914"))],
      },
    ],
  };
}

function member(user_id, name, role, pin_tag, permissions = Object.keys(SHOP_PERMISSIONS)) {
  return { user_id, name, role, permissions, pin_tag, must_change_pin: false };
}

// --- HMAC, base64, PIN rules, permissions ------------------------------------------------

test("HMAC-SHA256 matches RFC 4231 test cases 1, 2 and 6 (key longer than a block)", async () => {
  const cases = [
    [new Uint8Array(20).fill(0x0b), utf8("Hi There"), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"],
    [utf8("Jefe"), utf8("what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"],
    [
      new Uint8Array(131).fill(0xaa),
      utf8("Test Using Larger Than Block-Size Key - Hash Key First"),
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
    ],
  ];
  for (const [key, message, expected] of cases)
    assert.equal(toHex(await hmacSha256(key, message, sha256)), expected);
});

test("base64 keys decode exactly, with or without padding", () => {
  for (const length of [1, 2, 3, 31, 32, 33]) {
    const bytes = randomBytes(length);
    const text = bytes.toString("base64");
    assert.deepEqual(Buffer.from(fromBase64(text)), bytes);
    assert.deepEqual(Buffer.from(fromBase64(text.replace(/=+$/, ""))), bytes);
  }
  assert.throws(() => fromBase64("not base64!"));
});

test("PIN rules are the server's", () => {
  for (const pin of ["48613", "90210", "13579", "02468", "11112", "73019"])
    assert.equal(pinProblem(pin), null, pin);
  for (const [pin, reason] of [
    ["1234", "exactly 5 digits"],
    ["123456", "exactly 5 digits"],
    ["12a45", "exactly 5 digits"],
    ["00000", "repeated or counting"],
    ["12345", "repeated or counting"],
    ["98765", "repeated or counting"],
    ["12121", "repeating pair"],
    ["90909", "repeating pair"],
  ])
    assert.match(pinProblem(pin), new RegExp(reason), pin);
});

test("permissions mirror contracts/permissions.json", () => {
  const contract = JSON.parse(readFileSync(join(contracts, "permissions.json"), "utf8"));
  assert.deepEqual(SHOP_PERMISSIONS, contract.shop_permissions);
  assert.deepEqual([...CASHIER_DEFAULTS].sort(), [...contract.cashier_defaults].sort());
  assert.deepEqual([...CASHIER_GRANTABLE].sort(), [...contract.cashier_grantable].sort());
  assert.deepEqual(Object.keys(GRANT_LABELS).sort(), [...CASHIER_GRANTABLE].sort());
});

test("the generated API types are from the current contract", () => {
  const contract = readFileSync(join(contracts, "openapi.json"));
  const hash = createHash("sha256").update(contract).digest("hex");
  const header = readFileSync(join(here, "..", "src", "api", "schema.d.ts"), "utf8").split("\n")[0];
  assert.equal(header, `// contracts/openapi.json sha256: ${hash}`, "run `npm run api:types`");
});

// --- Lockout -----------------------------------------------------------------------------

test("the PIN pad locks after five wrong PINs, for twice as long each time", () => {
  let state = OPEN;
  for (let i = 1; i < MAX_FAILURES; i += 1) {
    state = recordFailure(state, 0);
    assert.equal(remainingMs(state, 0), 0);
  }
  state = recordFailure(state, 1_000);
  assert.equal(remainingMs(state, 1_000), 30_000);
  assert.equal(remainingMs(state, 31_000), 0);
  for (let i = 0; i < MAX_FAILURES; i += 1) state = recordFailure(state, 40_000);
  assert.equal(remainingMs(state, 40_000), 60_000);
  for (let round = 0; round < 30; round += 1)
    for (let i = 0; i < MAX_FAILURES; i += 1) state = recordFailure(state, 0);
  assert.equal(remainingMs(state, 0), 60 * 60_000); // Capped at an hour.
});

// --- device.db ---------------------------------------------------------------------------

test("the till reopens after a restart only within two minutes, for someone still on the roster", async () => {
  const secrets = new Secrets(new MemoryStore());
  assert.equal(await secrets.unlocked(), null);
  const at = 1_000_000;
  await secrets.setUnlocked({ shopId: "s1", userId: "u1", at });
  const saved = await secrets.unlocked();
  const member = (shop, user) => shop === "s1" && user === "u1";

  assert.equal(canResume(saved, at + 119_000, member), true);
  assert.equal(canResume(saved, at + RESUME_WINDOW_MS, member), false);
  assert.equal(canResume(saved, at + 121_000, member), false);
  assert.equal(canResume(saved, at - 1, member), false); // The clock went backwards.
  assert.equal(canResume(saved, at + 1_000, () => false), false); // Removed from the roster.
  assert.equal(canResume(null, at, member), false);

  assert.equal(parseSavedUnlock("{not json"), null);
  assert.equal(parseSavedUnlock(JSON.stringify({ shopId: "s1", userId: "u1" })), null);
  await secrets.setUnlocked(null);
  assert.equal(await secrets.unlocked(), null);
});

test("a fresh phone has no shop until its roster arrives", (t) => {
  const device = deviceFixture(t);
  const repo = device.repo;
  assert.equal(repo.hasShops(), false);
  assert.equal(repo.wasRemoved(), false);
  assert.equal(repo.deviceId(), null);
  repo.setDeviceId("device-1");
  repo.setAccount({ id: "owner-1", name: "Lerato", phone: "+26658112233", role: "owner", status: "pending", must_change_pin: false });
  assert.equal(repo.hasShops(), false); // Registered, but no shop yet.

  repo.applyRoster(rosterFor(), '"etag-1"', 1_000);
  assert.equal(repo.hasShops(), true);
  assert.deepEqual(repo.shops().map((s) => [s.id, s.status]), [["shop-a", "active"], ["shop-b", "suspended"]]);
  assert.equal(repo.memberByTag("shop-a", tag(KEY_A, "73051")).name, "Thabo");
  assert.deepEqual(repo.member("shop-a", "cashier-1").permissions, ["catalogue:read", "sales:create"]);
  assert.equal(repo.rosterEtag(), '"etag-1"');

  device.reopen();
  assert.equal(device.repo.account().status, "pending");
  assert.equal(device.repo.shops().length, 2);
});

test("a new roster replaces the old one, shop by shop", (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  repo.applyRoster(rosterFor(), '"1"', 0);
  const next = rosterFor();
  next.shops = [next.shops[0]];
  next.shops[0].members = [next.shops[0].members[0]]; // The cashier was removed.
  repo.applyRoster(next, '"2"', 0);
  assert.deepEqual(repo.shops().map((s) => s.id), ["shop-a"]);
  assert.equal(repo.memberByTag("shop-a", tag(KEY_A, "73051")), null);
  assert.equal(repo.members("shop-b").length, 0);
});

test("each shop gets its own file; the claiming shop keeps the phone's original one", (t) => {
  const device = deviceFixture(t);
  const repo = device.repo;
  repo.setDeviceId("device-1");
  assert.equal(repo.databaseFor("shop-b"), "shop-shop-b.db");
  repo.recordClaim("shop-a");
  repo.recordClaim("shop-a"); // Idempotent.
  assert.equal(repo.databaseFor("shop-a"), DATABASE_NAME);
  assert.throws(() => repo.recordClaim("shop-b"), /another shop/);

  // With no shop left, the phone says it was removed rather than starting afresh.
  repo.applyRoster({ device_id: "device-1", shops: [] }, null, 0);
  assert.equal(repo.wasRemoved(), true);
});

test("a claim the server recorded but the phone did not is finished from the roster", (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  repo.applyRoster(rosterFor({ claimedBy: "device-1" }), null, 0);
  assert.equal(repo.claimedShopId(), "shop-a");
  assert.equal(repo.databaseFor("shop-a"), DATABASE_NAME);

  const other = deviceFixture(t).repo;
  other.setDeviceId("device-2");
  other.applyRoster(rosterFor({ deviceId: "device-2", claimedBy: "device-1" }), null, 0);
  assert.equal(other.claimedShopId(), null); // Another phone's claim is not this one's.
});

test("a revoked phone forgets its roster and says it was removed", (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  repo.applyRoster(rosterFor(), '"1"', 0);
  repo.markRevoked();
  assert.equal(repo.isRevoked(), true);
  assert.equal(repo.shops().length, 0);
  assert.equal(repo.memberByTag("shop-a", tag(KEY_A, "73051")), null);
  assert.equal(repo.rosterEtag(), null);
  assert.equal(repo.wasRemoved(), true);
  repo.setDeviceId("device-3"); // Signed in again: a new registration.
  assert.equal(repo.isRevoked(), false);
});

test("an owner signs the phone out of the shops they manage; it says so until set up again", (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  const roster = rosterFor();
  roster.shops[1].members.push(member("other-owner", "Palesa", "owner", null));
  roster.shops[1].members[0].permissions = ["catalogue:read"]; // Lerato only works there.
  repo.applyRoster(roster, null, 0);
  const leaving = shopsToLeave(repo.shops(), (shop, user) => repo.member(shop, user), "owner-1");
  assert.deepEqual(leaving.map((shop) => shop.id), ["shop-a"]);
  assert.deepEqual(shopsToLeave(repo.shops(), (shop, user) => repo.member(shop, user), "cashier-1"), []);

  repo.markSignedOut();
  assert.equal(repo.wasSignedOut(), false, "not while the phone still has shops");
  repo.applyRoster({ device_id: "device-1", shops: [] }, null, 0);
  assert.equal(repo.wasSignedOut(), true);
  repo.applyRoster(rosterFor(), null, 0); // Set up again.
  repo.applyRoster({ device_id: "device-1", shops: [] }, null, 0);
  assert.equal(repo.wasSignedOut(), false, "a later removal is not a sign-out");
});

test("signing out says what has not reached the server", () => {
  const synced = { state: "synced", pending: 0, lastSyncedAt: null };
  assert.deepEqual(checkSync({ a: synced, b: { ...synced, pending: 9 } }, ["a"]), { kind: "clear" });
  assert.deepEqual(checkSync({ a: { ...synced, pending: 2 } }, ["a"]), { kind: "waiting", pending: 2, unknown: false });
  assert.deepEqual(checkSync({ a: { state: "offline", pending: 0 } }, ["a"]), { kind: "waiting", pending: 0, unknown: true });
  assert.deepEqual(checkSync({}, ["a"]), { kind: "waiting", pending: 0, unknown: true });
  assert.match(syncCheckText({ kind: "waiting", pending: 1, unknown: false }), /^1 change has not reached/);
  assert.match(syncCheckText({ kind: "waiting", pending: 0, unknown: true }), /could not reach the server/);
  assert.equal(syncCheckText({ kind: "clear" }), "Everything from this phone is on the server.");
});

test("lockout state survives a restart", (t) => {
  const device = deviceFixture(t);
  device.repo.saveLockout({ failures: 2, lockouts: 1, lockedUntil: 12345 });
  device.reopen();
  assert.deepEqual(device.repo.lockout(), { failures: 2, lockouts: 1, lockedUntil: 12345 });
});

// --- Offline PIN check --------------------------------------------------------------------

test("a PIN identifies the person and their shops offline", async (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  repo.applyRoster(rosterFor(), null, 0);
  const secrets = new Secrets(new MemoryStore());
  await secrets.setPinKey("shop-a", KEY_A.toString("base64"));
  await secrets.setPinKey("shop-b", KEY_B.toString("base64"));
  const deps = {
    pinKey: (id) => secrets.pinKey(id),
    memberByTag: (id, t) => repo.memberByTag(id, t),
    sha256,
  };
  assert.equal(await pinTag(KEY_A, "73051", sha256), tag(KEY_A, "73051"));

  const owner = await matchPin("52914", repo.shops(), deps);
  assert.deepEqual(owner.map((m) => [m.shop.id, m.member.userId]), [["shop-a", "owner-1"], ["shop-b", "owner-1"]]);
  const cashier = await matchPin("73051", repo.shops(), deps);
  assert.deepEqual(cashier.map((m) => m.member.name), ["Thabo"]);
  assert.deepEqual(await matchPin("11112", repo.shops(), deps), []);

  await secrets.deletePinKey("shop-b"); // A shop without its key is skipped, not guessed.
  assert.deepEqual((await matchPin("52914", repo.shops(), deps)).map((m) => m.shop.id), ["shop-a"]);
});

// --- API client --------------------------------------------------------------------------

function fakeServer(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const result = await handler(call, calls);
    if (result instanceof Error) throw result;
    const { status = 200, body = null, headers = {} } = result;
    return new Response(body === null ? null : JSON.stringify(body), { status, headers });
  };
  return { fetch, calls };
}

const tokens = (n) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: "bearer",
  expires_in: 900,
  session_id: "s",
  device_id: "device-1",
  user: { id: "u", phone: null, name: "U", role: "owner", status: "active", must_change_pin: false },
  device: null,
});

function client(fetch, extra = {}) {
  return new ApiClient({
    baseUrl: "https://api.test/",
    newId: randomUUID,
    fetch,
    sleep: async () => {},
    random: () => 0.5,
    deviceCredential: async () => ({ device_id: "device-1", device_secret: "s".repeat(43) }),
    ...extra,
  });
}

const error = (status, code, headers = {}) => ({ status, body: { error: { code, message: `${code}!` } }, headers });

test("API errors keep the server's code and message; no connection is 'network'", async () => {
  const server = fakeServer(() => error(409, "pin_taken"));
  const api = client(server.fetch);
  api.startSession(tokens(1));
  await assert.rejects(api.post("/api/v1/x", {}), (e) => e instanceof ApiError && e.code === "pin_taken" && e.message === "pin_taken!");

  const offline = client(async () => {
    throw new TypeError("Network request failed");
  });
  offline.startSession(tokens(1));
  await assert.rejects(offline.get("/api/v1/x", { retry: false }), (e) => e.code === "network" && e.status === 0);
});

test("concurrent requests share one refresh when the access token expires", async () => {
  let refreshes = 0;
  const server = fakeServer(async (call) => {
    if (call.url.endsWith("/tokens")) {
      refreshes += 1;
      assert.equal(call.body.refresh_token, "refresh-1");
      await new Promise((r) => setTimeout(r, 10));
      return { body: tokens(2) };
    }
    return call.headers.Authorization === "Bearer access-2" ? { body: { ok: true } } : error(401, "invalid_token");
  });
  const saved = [];
  const api = client(server.fetch, { onRefreshToken: (t) => saved.push(t) });
  api.startSession(tokens(1));
  const results = await Promise.all([api.get("/api/v1/a"), api.get("/api/v1/b"), api.get("/api/v1/c")]);
  assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(refreshes, 1);
  assert.deepEqual(saved, ["refresh-1", "refresh-2"]);
});

test("a rotated refresh token is persisted before the refresh completes", async () => {
  const server = fakeServer((call) =>
    call.url.endsWith("/tokens") ? { body: tokens(2) } : { body: { auth: call.headers.Authorization } },
  );
  const saved = [];
  let release;
  const api = client(server.fetch, {
    onRefreshToken: (t) => {
      if (t !== "refresh-2") return void saved.push(t);
      return new Promise((resolve) => (release = resolve)).then(() => void saved.push(t));
    },
  });
  api.resumeSession("refresh-1");
  let done = false;
  const pending = api.get("/api/v1/a").then((r) => ((done = true), r));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(done, false); // Still waiting on the keystore write.
  release();
  assert.deepEqual(await pending, { auth: "Bearer access-2" });
  assert.deepEqual(saved, ["refresh-2"]);
});

test("a refused refresh ends the session", async () => {
  const server = fakeServer((call) => (call.url.endsWith("/tokens") ? error(401, "refresh_token_reused") : error(401, "invalid_token")));
  const saved = [];
  const api = client(server.fetch, { onRefreshToken: (t) => saved.push(t) });
  api.resumeSession("refresh-1");
  await assert.rejects(api.get("/api/v1/a"), (e) => e.code === "refresh_token_reused");
  assert.equal(api.hasSession(), false);
  assert.deepEqual(saved, [null]);
});

test("a POST is retried with the same Idempotency-Key; sign-in never is", async () => {
  let attempts = 0;
  const server = fakeServer((call) => {
    if (call.url.endsWith("/tokens")) return error(503, "unavailable");
    attempts += 1;
    return attempts < 3 ? new TypeError("offline") : { status: 201, body: { id: 1 } };
  });
  const api = client(server.fetch);
  api.startSession(tokens(1));
  assert.deepEqual(await api.post("/api/v1/shops", { name: "A" }), { id: 1 });
  const keys = server.calls.filter((c) => c.url.endsWith("/shops")).map((c) => c.headers["Idempotency-Key"]);
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);

  await assert.rejects(api.post("/api/v1/tokens", { grant_type: "pin" }, { auth: "none", retry: false }));
  assert.equal(server.calls.filter((c) => c.url.endsWith("/tokens")).length, 1);
  assert.equal(server.calls.at(-1).headers["Idempotency-Key"], undefined);
});

test("a long Retry-After is not waited out", async () => {
  const server = fakeServer(() => error(429, "rate_limited", { "Retry-After": "3600" }));
  const api = client(server.fetch);
  api.startSession(tokens(1));
  await assert.rejects(api.put("/api/v1/users/me/pin", {}), (e) => e.code === "rate_limited" && e.retryAfterMs === 3_600_000);
  assert.equal(server.calls.length, 1);
});

test("device requests use one cached device token; a revoked phone is reported", async () => {
  let deviceTokens = 0;
  let revoked = false;
  const server = fakeServer((call) => {
    if (call.url.endsWith("/tokens")) {
      deviceTokens += 1;
      assert.equal(call.body.grant_type, "device");
      return { body: { access_token: "device-token", token_type: "bearer", expires_in: 900, device_id: "device-1" } };
    }
    assert.equal(call.headers.Authorization, "Bearer device-token");
    return call.url.includes("gone") ? error(401, "device_revoked") : { body: [] };
  });
  const api = client(server.fetch, { onDeviceRevoked: () => (revoked = true) });
  await Promise.all([api.get("/api/v1/a", { auth: "device" }), api.get("/api/v1/b", { auth: "device" })]);
  assert.equal(deviceTokens, 1);
  await assert.rejects(api.get("/api/v1/gone", { auth: "device" }), (e) => e.code === "device_revoked");
  assert.equal(revoked, true);
});

// --- Roster sync -------------------------------------------------------------------------

test("the roster is fetched with its ETag, stored with its keys, and wiped on revocation", async (t) => {
  const repo = deviceFixture(t).repo;
  repo.setDeviceId("device-1");
  let state = "fresh";
  const server = fakeServer((call) => {
    if (call.url.endsWith("/tokens"))
      return { body: { access_token: "d", token_type: "bearer", expires_in: 900, device_id: "device-1" } };
    if (state === "revoked") return error(401, "device_revoked");
    if (call.headers["If-None-Match"] === '"v1"') return { status: 304 };
    return { body: rosterFor(), headers: { ETag: '"v1"' } };
  });
  const store = new MemoryStore();
  const secrets = new Secrets(store);
  const sync = new RosterSync({ api: client(server.fetch), device: repo, secrets, now: () => 5 });

  const [first, second] = await Promise.all([sync.refresh(), sync.refresh()]);
  assert.deepEqual([first, second], ["updated", "updated"]); // One request for both.
  assert.equal(server.calls.filter((c) => c.url.endsWith("/roster")).length, 1);
  assert.deepEqual(Buffer.from(await secrets.pinKey("shop-a")), KEY_A);
  assert.equal(repo.shops().length, 2);
  assert.ok(![...store.values.values()].some((v) => v.includes(tag(KEY_A, "73051"))));

  assert.equal(await sync.refresh(), "unchanged");
  state = "revoked";
  assert.equal(await sync.refresh(), "revoked");
  assert.equal(repo.shops().length, 0);
  assert.equal(await secrets.pinKey("shop-a"), null);
});
