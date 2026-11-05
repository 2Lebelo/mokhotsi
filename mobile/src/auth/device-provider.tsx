import NetInfo from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
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

import { ApiClient } from "@/api/client";
import { API_URL } from "@/api/config";
import { me, signOut as endServerSession } from "@/api/endpoints";
import type { TokenResponse } from "@/api/types";
import { Secrets } from "@/auth/secrets";
import { secureStore } from "@/auth/secure";
import { Button, errorMessage, Heading, Notice, Screen } from "@/components/shop-ui";
import { hideSplash } from "@/components/splash";
import { DEVICE_MIGRATIONS } from "@/db/device/migrations";
import { DeviceRepository, type Account } from "@/db/device/repository";
import { runMigrations } from "@/db/schema";
import { RosterSync, type RosterResult } from "@/sync/roster";

const DEVICE_DATABASE = "device.db";
// Foreground and network triggers within this window reuse the last answer.
const ROSTER_MIN_INTERVAL_MS = 30_000;

type Ready = {
  db: SQLiteDatabase;
  /** Used by the API client and roster sync; screens get a fresh facade per revision. */
  device: DeviceRepository;
  secrets: Secrets;
  api: ApiClient | null;
  roster: RosterSync | null;
};

type DeviceContext = Omit<Ready, "db" | "roster"> & {
  /** Bumps whenever device.db changes, so readers re-render. */
  revision: number;
  changed: () => void;
  /** The person signed in online here: saved on a personal phone, in memory at a till. */
  account: Account | null;
  hasSession: boolean;
  refreshRoster: (force?: boolean) => Promise<RosterResult>;
  /** After a sign-in or registration. `remember`: keep the session after the app closes. */
  adoptSignIn: (tokens: TokenResponse, options: { remember: boolean }) => Promise<void>;
  /** Ask the server who the signed-in person is now (e.g. approved since). */
  refreshAccount: () => Promise<Account | null>;
  /**
   * The phone was just set up for a shop by the signed-in owner: their session becomes the
   * till's (memory only, ended by the lock) instead of the phone's.
   */
  handOverToTill: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Context = createContext<DeviceContext | null>(null);

/**
 * The phone's identity: device.db, its keystore secrets, the API client and the roster.
 * Mounted once at the root, above any shop.
 */
export function DeviceProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const [tillAccount, setTillAccount] = useState<Account | null>(null);
  const remember = useRef(false);
  const lastRoster = useRef(0);
  const changed = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let connection: SQLiteDatabase | undefined;
    void (async () => {
      try {
        connection = await openDatabaseAsync(DEVICE_DATABASE, { useNewConnection: true });
        if (cancelled) {
          await connection.closeAsync();
          return;
        }
        runMigrations(connection, DEVICE_MIGRATIONS);
        const device = new DeviceRepository(connection);
        const secrets = new Secrets(secureStore);
        const api = API_URL
          ? new ApiClient({
              baseUrl: API_URL,
              newId: randomUUID,
              deviceCredential: () => secrets.deviceCredential(),
              onRefreshToken: (token) => {
                let saved: Promise<void> | undefined;
                if (token === null) {
                  setTillAccount(null);
                  if (remember.current) {
                    remember.current = false;
                    device.setAccount(null);
                    saved = secrets.setRefreshToken(null);
                  }
                } else if (remember.current) saved = secrets.setRefreshToken(token);
                changed();
                return saved;
              },
              onDeviceRevoked: () => {
                device.markRevoked();
                changed();
              },
            })
          : null;
        const saved = await secrets.refreshToken();
        if (api && saved && device.account()) {
          remember.current = true;
          api.resumeSession(saved);
        }
        const roster = api && new RosterSync({ api, device, secrets });
        if (cancelled) return;
        setReady({ db: connection, device, secrets, api, roster });
        // The first roster check of the session; later ones come from the triggers below.
        lastRoster.current = Date.now();
        void roster
          ?.refresh()
          .then((result) => {
            if (result === "updated" || result === "revoked") changed();
          })
          .catch(() => {});
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
      if (connection) void connection.closeAsync().catch(() => {});
    };
  }, [attempt, changed]);

  const refreshRoster = useCallback(
    async (force = true): Promise<RosterResult> => {
      if (!ready?.roster) return "offline";
      if (!force && Date.now() - lastRoster.current < ROSTER_MIN_INTERVAL_MS) return "unchanged";
      lastRoster.current = Date.now();
      try {
        const result = await ready.roster.refresh();
        if (result === "updated" || result === "revoked") changed();
        return result;
      } catch {
        return "offline"; // A server error: try again on the next trigger.
      }
    },
    [ready, changed],
  );

  // Foreground and network-back triggers. Never blocks the till.
  useEffect(() => {
    if (!ready) return;
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshRoster(false);
    });
    let wasOnline = true;
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online && !wasOnline) void refreshRoster(false);
      wasOnline = online;
    });
    return () => {
      appState.remove();
      network();
    };
  }, [ready, refreshRoster]);

  const adoptSignIn = useCallback(
    async (tokens: TokenResponse, options: { remember: boolean }) => {
      if (!ready?.api) return;
      if (tokens.device) {
        await ready.secrets.setDeviceCredential({
          device_id: tokens.device.device_id,
          device_secret: tokens.device.device_secret,
        });
        ready.device.setDeviceId(tokens.device.device_id);
        ready.api.resetDevice();
      }
      remember.current = options.remember;
      if (options.remember) ready.device.setAccount(tokens.user);
      else setTillAccount(tokens.user);
      await ready.api.startSession(tokens);
      changed();
      if (tokens.device) void refreshRoster();
    },
    [ready, changed, refreshRoster],
  );

  const refreshAccount = useCallback(async (): Promise<Account | null> => {
    if (!ready?.api?.hasSession()) return null;
    const user = await me(ready.api);
    if (remember.current) ready.device.setAccount(user);
    else setTillAccount(user);
    changed();
    return user;
  }, [ready, changed]);

  const handOverToTill = useCallback(async () => {
    if (!ready) return;
    // A saved session (personal phone), or one already in memory (signed in at a shop's phone).
    const saved = ready.device.account();
    remember.current = false;
    ready.device.setAccount(null);
    await ready.secrets.setRefreshToken(null);
    setTillAccount((current) => saved ?? current);
    changed();
  }, [ready, changed]);

  const signOut = useCallback(async () => {
    if (!ready?.api) return;
    if (ready.api.hasSession()) await endServerSession(ready.api).catch(() => {});
    ready.api.endSession();
    ready.device.setAccount(null);
    await ready.secrets.setRefreshToken(null);
    remember.current = false;
    setTillAccount(null);
    changed();
  }, [ready, changed]);

  const value = useMemo<DeviceContext | null>(
    () =>
      ready && {
        // A new facade per revision, like ShopStore: React Compiler then re-reads device.db
        // in every component that uses it, instead of keeping a memoized answer.
        device: new DeviceRepository(ready.db),
        secrets: ready.secrets,
        api: ready.api,
        revision,
        changed,
        account: tillAccount ?? ready.device.account(),
        hasSession: ready.api?.hasSession() ?? false,
        refreshRoster,
        adoptSignIn,
        refreshAccount,
        handOverToTill,
        signOut,
      },
    // `revision` stands in for device.db and session changes.
    [
      ready,
      revision,
      tillAccount,
      changed,
      refreshRoster,
      adoptSignIn,
      refreshAccount,
      handOverToTill,
      signOut,
    ],
  );

  useEffect(() => {
    if (error) hideSplash();
  }, [error]);

  if (error)
    return (
      <Screen>
        <Heading
          title="Unable to start"
          subtitle="This phone's sign-in data could not be opened. Your shop data has not been changed."
        />
        <Notice message={error} error />
        <Button
          title="Try again"
          onPress={() => {
            setError("");
            setAttempt((value) => value + 1);
          }}
        />
      </Screen>
    );
  if (!ready) return null; // The splash stays up meanwhile (a few milliseconds).
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDevice(): DeviceContext {
  const value = useContext(Context);
  if (!value) throw new Error("DeviceProvider is required.");
  return value;
}

/** The API client, or null when this build has no server configured (offline only). */
export function useApi(): ApiClient | null {
  return useDevice().api;
}
