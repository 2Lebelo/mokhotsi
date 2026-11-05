import assert from "node:assert/strict";
import test from "node:test";

import { appPhase } from "../src/auth/phase.ts";
import { formatPhone, isPhoneComplete, phoneDigits, toE164 } from "../src/domain/phone.ts";
import { nextDelay, POLL_STEPS_MS } from "../src/features/onboarding/poll.ts";

const owner = (changes = {}) => ({
  role: "owner",
  status: "active",
  must_change_pin: false,
  ...changes,
});

const base = {
  configured: true,
  hasShops: false,
  tillOpen: false,
  signingIn: false,
  settingUp: false,
  account: null,
  hasSession: false,
};

const phase = (changes) => {
  const { phase, step } = appPhase({ ...base, ...changes });
  return step ? `${phase}/${step}` : phase;
};

test("nobody reaches the till without signing in", () => {
  assert.equal(phase({}), "signed-out"); // A fresh phone.
  assert.equal(phase({ account: owner() }), "signed-out"); // A saved account without a session.
  assert.equal(phase({ hasShops: true }), "locked"); // A shop's phone opens on the PIN pad.
  assert.equal(phase({ hasShops: true, tillOpen: true }), "open"); // Only after a PIN.
});

test("a signed-in owner without a shop on this phone goes through setup", () => {
  const signedIn = (account) => phase({ account, hasSession: true });
  assert.equal(signedIn(owner({ status: "pending" })), "setup/waiting");
  assert.equal(signedIn(owner({ must_change_pin: true })), "setup/choose-pin");
  assert.equal(signedIn(owner()), "setup/shop");
  assert.equal(signedIn(owner({ status: "rejected" })), "signed-out");
  assert.equal(signedIn(owner({ status: "disabled" })), "signed-out");
  assert.equal(signedIn({ ...owner(), role: "cashier" }), "signed-out");
});

test("the admin gets admin screens, after choosing their own PIN", () => {
  const admin = { ...owner(), role: "system_admin" };
  assert.equal(phase({ account: admin, hasSession: true }), "admin");
  assert.equal(phase({ account: { ...admin, must_change_pin: true }, hasSession: true }), "setup/choose-pin");
});

test("from the PIN pad, an owner or the admin can sign in, and comes back to it", () => {
  const admin = { ...owner(), role: "system_admin" };
  const shopPhone = { hasShops: true, signingIn: true };
  assert.equal(phase(shopPhone), "signed-out"); // The sign-in screen.
  assert.equal(phase({ ...shopPhone, account: admin, hasSession: true }), "admin");
  assert.equal(phase({ ...shopPhone, account: owner(), hasSession: true }), "setup/shop");
  assert.equal(phase({ ...shopPhone, account: { ...owner(), role: "cashier" }, hasSession: true }), "signed-out");
  // Without choosing to sign in, a session on a shop's phone never leaves the PIN pad.
  assert.equal(phase({ hasShops: true, account: admin, hasSession: true }), "locked");
  assert.equal(phase({ ...shopPhone, tillOpen: true }), "open");
});

test("setting the phone up stays in setup until the till opens; a build without a server is unconfigured", () => {
  assert.equal(phase({ account: owner(), hasSession: true, settingUp: true, hasShops: true }), "setup/finishing");
  assert.equal(phase({ configured: false, hasShops: true, tillOpen: true }), "unconfigured");
});

test("approval checks back off to five minutes with ±20% jitter", () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const step = POLL_STEPS_MS[Math.min(attempt, POLL_STEPS_MS.length - 1)];
    assert.equal(nextDelay(attempt, () => 0), step * 0.8);
    assert.equal(nextDelay(attempt, () => 1), step * 1.2);
  }
  assert.equal(nextDelay(-3, () => 0.5), POLL_STEPS_MS[0]);
  assert.equal(nextDelay(99, () => 0.5), 300_000);
});

test("phone numbers are typed as 8 Lesotho digits, however they are pasted", () => {
  for (const typed of ["58123456", "5812 3456", "+266 5812 3456", "00266 58123456", "26658123456", "058123456"])
    assert.equal(phoneDigits(typed), "58123456", typed);
  assert.equal(phoneDigits("581234567890"), "58123456"); // Capped at 8.
  assert.equal(formatPhone("5812"), "5812");
  assert.equal(formatPhone("58123"), "5812 3");
  assert.equal(formatPhone("58123456"), "5812 3456");
  assert.equal(isPhoneComplete("5812345"), false);
  assert.equal(toE164("58123456"), "+26658123456");
});
