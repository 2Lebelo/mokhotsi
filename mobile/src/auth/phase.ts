/**
 * Which part of the app may show, decided in one place. Every route group is guarded by one
 * phase (src/app/_layout.tsx), so nothing reaches the till without a signed-in person.
 *
 * - unconfigured: this build has no server, so nobody can sign in.
 * - signed-out:   a phone not set up for a shop, with nobody signed in → sign in / sign up.
 * - setup:        a signed-in owner whose phone has no shop yet → the steps in SetupStep.
 * - admin:        a signed-in system admin → admin screens only (the admin does not sell).
 * - locked:       a phone with shops → the PIN pad.
 * - open:         a person who unlocked with their PIN → the till and everything else.
 *
 * From the PIN pad an owner or the admin may choose to sign in with their phone number
 * (`signingIn`): the phone then follows the same steps as one without shops, and returns to
 * the PIN pad when they go back or sign out.
 */

export type Phase = "unconfigured" | "signed-out" | "setup" | "admin" | "locked" | "open";

export type SetupStep =
  /** Registered, waiting for the system admin. */
  | "waiting"
  /** Signed in with a temporary PIN: choose one before anything else. */
  | "choose-pin"
  /** Approved: open the first shop, or set this phone up for an existing one. */
  | "shop"
  /** The phone is being set up for a shop (between the request and the till). */
  | "finishing";

export type PhaseInput = {
  configured: boolean;
  /** The phone holds at least one shop's roster. */
  hasShops: boolean;
  /** A person unlocked the phone with their PIN. */
  tillOpen: boolean;
  /** Someone chose "Sign in with phone number" on the PIN pad. */
  signingIn: boolean;
  settingUp: boolean;
  /** The person signed in online on this phone, if any (a saved session counts offline). */
  account: {
    role: "system_admin" | "owner" | "cashier";
    status: "pending" | "active" | "rejected" | "disabled";
    must_change_pin: boolean;
  } | null;
  hasSession: boolean;
};

export type PhaseResult = { phase: Phase; step: SetupStep | null };

export function appPhase(input: PhaseInput): PhaseResult {
  if (!input.configured) return { phase: "unconfigured", step: null };
  if (input.settingUp) return { phase: "setup", step: "finishing" };
  if (input.hasShops) {
    if (input.tillOpen) return { phase: "open", step: null };
    if (!input.signingIn) return { phase: "locked", step: null };
  }

  const account = input.hasSession ? input.account : null;
  if (!account || account.status === "rejected" || account.status === "disabled")
    return { phase: "signed-out", step: null };
  if (account.status === "pending") return { phase: "setup", step: "waiting" };
  if (account.must_change_pin) return { phase: "setup", step: "choose-pin" };
  if (account.role === "system_admin") return { phase: "admin", step: null };
  if (account.role === "owner") return { phase: "setup", step: "shop" };
  // A cashier signs in only at a shop's phone, with their PIN.
  return { phase: "signed-out", step: null };
}
