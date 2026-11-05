import { randomUUID } from "expo-crypto";
import type { SQLiteDatabase } from "expo-sqlite";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";

import { LoadingScreen } from "@/components/loading";
import {
  Button,
  errorMessage,
  Heading,
  Notice,
  Screen,
} from "@/components/shop-ui";
import {
  acquireShopDatabase,
  notifyLocalWrite,
  onRemoteChange,
  releaseShopDatabase,
} from "@/db/shop-databases";
import { ShopStore, type Actor, type StoreContext } from "@/db/store";

type ShopContext = {
  store: ShopStore;
  revision: number;
  /** Call after changing the shop's data: screens re-read it, and sync sends it soon. */
  refresh: () => void;
};
const Context = createContext<ShopContext | null>(null);

/**
 * One shop's data: its own SQLite file (`databaseName`), changed by `actor`, the person at
 * the till ("local" before the phone is registered). Mount it with `key` set to the shop,
 * so switching shops never shows one shop's data under another. The connection is shared
 * with sync (shop-databases.ts); what sync brings from other phones refreshes the screens.
 */
export function ShopProvider({
  children,
  databaseName,
  actor,
}: PropsWithChildren<{ databaseName: string; actor: Actor }>) {
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const reread = useCallback(() => setRevision((value) => value + 1), []);
  const refresh = useCallback(() => {
    reread();
    notifyLocalWrite(databaseName);
  }, [reread, databaseName]);

  useEffect(() => {
    let cancelled = false;
    acquireShopDatabase(databaseName).then(
      (connection) => {
        if (!cancelled) setDatabase(connection);
      },
      (cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
      releaseShopDatabase(databaseName);
    };
  }, [attempt, databaseName]);

  useEffect(() => onRemoteChange(databaseName, reread), [databaseName, reread]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reread();
    });
    // Refresh today's totals when a shop stays open over midnight.
    const timer = setInterval(reread, 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [reread]);

  const context = useMemo<StoreContext>(
    () => ({ newId: randomUUID, clock: () => new Date(), actor }),
    [actor],
  );
  const value = useMemo(
    // A new facade per revision keeps React Compiler's memoized reads current.
    () =>
      database
        ? {
            store: new ShopStore(database, context, revision),
            revision,
            refresh,
          }
        : null,
    [database, context, revision, refresh],
  );
  if (error)
    return (
      <Screen>
        <Heading
          title="Unable to open your shop"
          subtitle="Your saved data has not been reset."
        />
        <Notice message={error} error />
        <Button
          title="Try again"
          onPress={() => {
            setError("");
            setDatabase(null);
            setAttempt((value) => value + 1);
          }}
        />
      </Screen>
    );
  if (!value) return <LoadingScreen message="Opening your shop…" />;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useShop() {
  const value = useContext(Context);
  if (!value) throw new Error("ShopProvider is required.");
  return value;
}
