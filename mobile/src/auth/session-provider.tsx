import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import { API_URL } from "@/api/config";
import { signInOnDevice, signOut as endServerSession } from "@/api/endpoints";
import { useDevice } from "@/auth/device-provider";
import { OPEN, recordFailure, remainingMs } from "@/auth/lockout";
import { appPhase, type Phase, type SetupStep } from "@/auth/phase";
import { matchPin, type PinMatch } from "@/auth/pin-match";
import { canResume } from "@/auth/resume";
import type { DeviceShop, Member } from "@/db/device/repository";
import type { Permission } from "@/domain/permissions";
import { sha256 } from "@/features/files";

const IDLE_LOCK_MS = 5 * 60_000;
/** How stale the saved "last activity" may get; it bounds how much a resume can overshoot. */
const SAVE_ACTIVITY_MS = 20_000;
const MANAGES: readonly Permission[] = ["members:manage", "devices:manage"];

export type UnlockResult =
  | { kind: "open" }
  | { kind: "choose"; matches: PinMatch[] }
  | { kind: "wrong"; lockedForMs: number }
  | { kind: "locked"; lockedForMs: number };

type Till = { kind: "locked" } | { kind: "open"; shop: DeviceShop; member: Member };

type SessionContext = {
  /** Which part of the app may show (see auth/phase.ts). */
  phase: Phase;
  step: SetupStep | null;
  till: Till;
  /** Check a PIN against the roster, offline. */
  unlock: (pin: string) => Promise<UnlockResult>;
  /** An owner of several shops picks one. */
  choose: (match: PinMatch) => void;
  lock: () => void;
  /** Call on any touch: it postpones the idle lock. */
  touch: () => void;
  can: (permission: Permission) => boolean;
  /** "Sign in with phone number" on the PIN pad (an owner or the admin), and back. */
  startSignIn: () => void;
  cancelSignIn: () => void;
  /** Get an online session for the person at the till (management needs one). */
  goOnline: (pin: string) => Promise<void>;
  /**
   * Set this phone up for a shop as the signed-in owner: `task` creates or links the shop and
   * returns its id. The phone then opens straight on the till as that owner (they have just
   * proved who they are), without passing through the PIN pad.
   */
  setUpPhone: (task: () => Promise<string>) => Promise<void>;
};

const Context = createContext<SessionContext | null>(null);

/**
 * Who is working on the phone. A phone with shops opens on the PIN pad; the PIN is checked
 * offline against the roster, and the person's permissions come from it. After five idle
 * minutes, or when the roster drops the person, the phone locks again. A phone without a
 * shop shows sign-in or setup: nobody reaches the till without signing in. If Android kills
 * the app while the till is open, it reopens on the till within two minutes (auth/resume.ts).
 */
export function SessionProvider({ children }: PropsWithChildren) {
  const { device, secrets, api, account, hasSession, adoptSignIn, refreshRoster, handOverToTill } =
    useDevice();
  const [open, setOpen] = useState<{ shopId: string; userId: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const lastTouch = useRef(0);
  const lastSaved = useRef(0);
  const backgroundedAt = useRef<number | null>(null);
  /** Whether the online session was opened by the person at the till (it ends with them). */
  const tillOnline = useRef(false);

  // Re-read from the roster on every change (`device` is new per revision): permissions and
  // removals apply at once.
  const till = useMemo<Till>(() => {
    const shop = open ? device.shop(open.shopId) : null;
    const member = open && shop ? device.member(open.shopId, open.userId) : null;
    return shop && member ? { kind: "open", shop, member } : { kind: "locked" };
  }, [open, device]);

  const { phase, step } = appPhase({
    configured: API_URL !== null,
    hasShops: device.hasShops(),
    tillOpen: till.kind === "open",
    signingIn,
    settingUp,
    account,
    hasSession,
  });

  // Someone removed from the roster while signed in is locked out at once (state adjusted
  // during render, so it never shows a frame as them).
  if (open && till.kind !== "open") setOpen(null);
  // Once the till opens, a sign-in started from the PIN pad is over.
  if (open && signingIn) setSigningIn(false);

  // Signing out of a sign-in started from the PIN pad (admin screens, setup) returns to it.
  const hadSession = useRef(hasSession);
  useEffect(() => {
    if (hadSession.current && !hasSession) setSigningIn(false);
    hadSession.current = hasSession;
  }, [hasSession]);
  const startSignIn = useCallback(() => setSigningIn(true), []);
  const cancelSignIn = useCallback(() => setSigningIn(false), []);

  const lock = useCallback(() => setOpen(null), []);

  // Reopen the till after the app was killed moments ago (before anything renders, so the PIN
  // pad never flashes). Runs once: `device` is the roster as loaded at start.
  const restoreDevice = useRef(device);
  useEffect(() => {
    let cancelled = false;
    void secrets
      .unlocked()
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return;
        const roster = restoreDevice.current;
        if (canResume(saved, Date.now(), (shop, user) => roster.member(shop, user) !== null)) {
          lastTouch.current = saved.at;
          setOpen({ shopId: saved.shopId, userId: saved.userId });
        }
        setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [secrets]);

  const saveActivity = useCallback(() => {
    if (!open) return;
    lastSaved.current = Date.now();
    void secrets.setUnlocked({ ...open, at: lastTouch.current }).catch(() => {});
  }, [open, secrets]);

  // Kept in step with `open`: unlocking saves it; any lock (PIN pad, idle, removal) clears it.
  useEffect(() => {
    if (!restored) return;
    if (open) saveActivity();
    else void secrets.setUnlocked(null).catch(() => {});
  }, [open, restored, saveActivity, secrets]);

  // A till session is the person's, not the phone's: it ends when the phone locks.
  useEffect(() => {
    if (open || !tillOnline.current || !api) return;
    tillOnline.current = false;
    if (api.hasSession()) {
      void endServerSession(api).catch(() => {});
      api.endSession();
    }
  }, [open, api]);

  const goOnlineWith = useCallback(
    async (shopId: string, pin: string) => {
      if (!api) throw new Error("This phone has no server to connect to.");
      const credential = await secrets.deviceCredential();
      if (!credential) throw new Error("This phone is not registered.");
      const tokens = await signInOnDevice(api, credential, shopId, pin);
      tillOnline.current = true;
      await adoptSignIn(tokens, { remember: false });
    },
    [api, secrets, adoptSignIn],
  );

  const start = useCallback(
    (match: PinMatch, pin: string | null) => {
      lastTouch.current = Date.now();
      setOpen({ shopId: match.shop.id, userId: match.member.userId });
      // Managers get an online session in the background while the PIN is at hand, so the
      // staff screens work without asking again. Offline is fine: they ask when needed.
      if (pin && api && match.member.permissions.some((p) => MANAGES.includes(p)))
        void goOnlineWith(match.shop.id, pin).catch(() => {});
    },
    [api, goOnlineWith],
  );

  const unlock = useCallback(
    async (pin: string): Promise<UnlockResult> => {
      const now = Date.now();
      const state = device.lockout();
      if (remainingMs(state, now) > 0)
        return { kind: "locked", lockedForMs: remainingMs(state, now) };
      const matches = await matchPin(pin, device.shops(), {
        pinKey: (id) => secrets.pinKey(id),
        memberByTag: (id, tag) => device.memberByTag(id, tag),
        sha256,
      });
      if (matches.length === 0) {
        const next = recordFailure(state, now);
        device.saveLockout(next);
        return { kind: "wrong", lockedForMs: remainingMs(next, now) };
      }
      device.saveLockout(OPEN);
      if (matches.length > 1) return { kind: "choose", matches };
      start(matches[0], pin);
      return { kind: "open" };
    },
    [device, secrets, start],
  );

  const choose = useCallback((match: PinMatch) => start(match, null), [start]);

  // Idle lock: checked on a timer and when the app comes back from the background.
  useEffect(() => {
    if (till.kind !== "open") return;
    const check = () => {
      if (Date.now() - lastTouch.current > IDLE_LOCK_MS) lock();
    };
    const timer = setInterval(check, 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        backgroundedAt.current = Date.now();
        saveActivity();
      }
      if (state === "active") {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (away !== null && Date.now() - away > IDLE_LOCK_MS) lock();
        else check();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [till.kind, lock, saveActivity]);

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
    if (lastTouch.current - lastSaved.current > SAVE_ACTIVITY_MS) saveActivity();
  }, [saveActivity]);

  const can = useCallback(
    (permission: Permission) =>
      till.kind === "open" && till.member.permissions.includes(permission),
    [till],
  );

  const goOnline = useCallback(
    async (pin: string) => {
      if (till.kind !== "open") throw new Error("Unlock the phone first.");
      await goOnlineWith(till.shop.id, pin);
    },
    [till, goOnlineWith],
  );

  const setUpPhone = useCallback(
    async (task: () => Promise<string>) => {
      const ownerId = account?.id;
      if (!ownerId) throw new Error("Sign in first.");
      setSettingUp(true);
      try {
        const shopId = await task();
        await refreshRoster();
        // `device` reads device.db directly, so it sees the roster just applied.
        if (!device.member(shopId, ownerId))
          throw new Error(
            "The shop is ready, but this phone could not load it. Check the connection and try again.",
          );
        await handOverToTill();
        tillOnline.current = true;
        lastTouch.current = Date.now();
        setOpen({ shopId, userId: ownerId });
      } finally {
        setSettingUp(false);
      }
    },
    [account, device, refreshRoster, handOverToTill],
  );

  const value = useMemo<SessionContext>(
    () => ({
      phase,
      step,
      till,
      unlock,
      choose,
      lock,
      touch,
      can,
      startSignIn,
      cancelSignIn,
      goOnline,
      setUpPhone,
    }),
    [
      phase,
      step,
      till,
      unlock,
      choose,
      lock,
      touch,
      can,
      startSignIn,
      cancelSignIn,
      goOnline,
      setUpPhone,
    ],
  );
  if (!restored) return null; // The splash stays up meanwhile (one keystore read).
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession(): SessionContext {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider is required.");
  return value;
}

/** Whether the person at the till may do this. */
export function useCan(): (permission: Permission) => boolean {
  return useSession().can;
}
