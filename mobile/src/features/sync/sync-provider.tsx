import NetInfo from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
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

import { useDevice } from "@/auth/device-provider";
import {
  acquireShopDatabase,
  notifyRemoteChange,
  onLocalWrite,
  releaseShopDatabase,
} from "@/db/shop-databases";
import { LOCAL_ACTOR, ShopStore } from "@/db/store";
import { files } from "@/features/files";
import { MANIFEST } from "@/features/vision/config";
import { vision } from "@/features/vision/vision-service";
import {
  SyncScheduler,
  type FlushResult,
  type ShopRun,
  type ShopSyncStatus,
} from "@/sync/scheduler";
import { ShopSync } from "@/sync/shop-sync";

type SyncContext = {
  /** The shop's sync state, once it has been checked this session. */
  status: (shopId: string) => ShopSyncStatus | null;
  syncNow: () => void;
  /** Syncs every shop now and resolves with each one's outcome (see SyncScheduler.flush). */
  flush: () => Promise<FlushResult>;
};

const Context = createContext<SyncContext | null>(null);

const NOT_CHECKED: ShopSyncStatus = { state: "idle", pending: 0, lastSyncedAt: null };

/**
 * Keeps every shop on this phone in sync with the server while the app is open (see
 * sync/scheduler.ts for when). It works on the PIN pad too: the phone syncs as itself, with
 * its device token, whoever is at the till. Nothing here ever blocks selling.
 */
export function SyncProvider({ children }: PropsWithChildren) {
  const { device, api } = useDevice();
  const [statuses, setStatuses] = useState<Partial<Record<string, ShopSyncStatus>>>({});
  // The scheduler outlives renders; it reads the latest device and client from here.
  const latest = useRef({ device, api });
  useEffect(() => {
    latest.current = { device, api };
  });

  const runShop = useCallback(async (shopId: string): Promise<ShopRun> => {
    const { device: phone, api: client } = latest.current;
    const deviceId = phone.deviceId();
    if (!client || !deviceId) return { state: "revoked", pending: 0, lastSyncedAt: null };
    const name = phone.databaseFor(shopId);
    const db = await acquireShopDatabase(name);
    try {
      // Changes sync makes itself (the first upload) are the phone's, not a person's.
      const store = new ShopStore(db, {
        newId: randomUUID,
        clock: () => new Date(),
        actor: LOCAL_ACTOR,
      });
      const outcome = await new ShopSync({
        api: client,
        store,
        files,
        shopId,
        deviceId,
        claimant: phone.claimedShopId() === shopId,
        modelVersion: MANIFEST.embedder.model_version,
      }).run();
      const { changed } = outcome;
      if (changed.embeddings) vision.invalidate();
      if (changed.catalogue || changed.sales || changed.embeddings)
        notifyRemoteChange(name, changed);
      return {
        state: outcome.state,
        message: outcome.message,
        pending: store.outbox.pendingCount(),
        lastSyncedAt: store.sync.lastSyncedAt(),
      };
    } finally {
      releaseShopDatabase(name);
    }
  }, []);

  // Created with the provider; only callbacks and effects reach it.
  const scheduler = useRef<SyncScheduler | null>(null);

  // The scheduler, and its foreground, network and local-change triggers.
  useEffect(() => {
    const current = new SyncScheduler({
      shops: () => {
        const { device: phone, api: client } = latest.current;
        if (!client || !phone.deviceId() || phone.isRevoked()) return [];
        return phone.shops().map((shop) => shop.id);
      },
      sync: runShop,
      onStatus: (shopId, status) =>
        setStatuses((all) => {
          const previous = all[shopId] ?? NOT_CHECKED;
          return { ...all, [shopId]: { ...previous, ...status } };
        }),
    });
    scheduler.current = current;
    current.setActive(AppState.currentState === "active");
    const appState = AppState.addEventListener("change", (state) =>
      current.setActive(state === "active"),
    );
    let wasOnline = true;
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      if (online && !wasOnline) current.networkBack();
      wasOnline = online;
    });
    const writes = onLocalWrite(() => current.nudge());
    return () => {
      appState.remove();
      network();
      writes();
      current.stop();
      scheduler.current = null;
    };
  }, [runShop]);

  // A phone that just got a shop (sign-up, joining) syncs it straight away.
  const shopKey = device.shops().map((shop) => shop.id).join(",");
  useEffect(() => {
    if (shopKey) scheduler.current?.syncNow();
  }, [shopKey]);

  const syncNow = useCallback(() => scheduler.current?.syncNow(), []);
  const flush = useCallback(
    () => scheduler.current?.flush() ?? Promise.resolve<FlushResult>({}),
    [],
  );
  const value = useMemo<SyncContext>(
    () => ({ status: (shopId) => statuses[shopId] ?? null, syncNow, flush }),
    [statuses, syncNow, flush],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSync(): SyncContext {
  const value = useContext(Context);
  if (!value) throw new Error("SyncProvider is required.");
  return value;
}
