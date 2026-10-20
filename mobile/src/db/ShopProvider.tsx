import { randomUUID } from "expo-crypto";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
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
import { DATABASE_NAME, migrateDatabase } from "@/db/schema";
import { ShopStore } from "@/db/store";

type ShopContext = { store: ShopStore; revision: number; refresh: () => void };
const Context = createContext<ShopContext | null>(null);

export function ShopProvider({ children }: PropsWithChildren) {
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    let connection: SQLiteDatabase | undefined;
    void (async () => {
      try {
        connection = await openDatabaseAsync(DATABASE_NAME, {
          useNewConnection: true,
        });
        if (cancelled) {
          await connection.closeAsync();
          return;
        }
        migrateDatabase(connection);
        setDatabase(connection);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
      if (connection) void connection.closeAsync().catch(() => {});
    };
  }, [attempt]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    // Refresh today's totals when a shop stays open over midnight.
    const timer = setInterval(refresh, 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  const value = useMemo(
    // A new facade per revision keeps React Compiler's memoized reads current.
    () =>
      database
        ? {
            store: new ShopStore(database, randomUUID, revision),
            revision,
            refresh,
          }
        : null,
    [database, revision, refresh],
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
