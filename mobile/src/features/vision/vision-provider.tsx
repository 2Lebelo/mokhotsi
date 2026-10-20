import { useEffect, useRef, type PropsWithChildren } from "react";
import { AppState } from "react-native";

import { useShop } from "@/db/ShopProvider";
import { UNLOAD_AFTER_BACKGROUND_MS } from "@/features/vision/config";
import { reconcileEmbeddings } from "@/features/vision/reconcile";
import { vision } from "@/features/vision/vision-service";

/** Delay after start-up or a data change before background embedding runs. */
const RECONCILE_DELAY_MS = 3000;

/**
 * Keeps product vectors up to date in the background (new or changed photos,
 * model upgrades) and frees the models when the app stays in the background.
 * Barcode selling never waits for any of this.
 */
export function VisionProvider({ children }: PropsWithChildren) {
  const { store, revision, refresh } = useShop();
  const running = useRef(false);

  useEffect(() => {
    // Debounced on the data revision: a burst of edits triggers one run.
    const timer = setTimeout(async () => {
      if (running.current) return;
      running.current = true;
      try {
        const { embedded } = await reconcileEmbeddings(store);
        if (embedded > 0) refresh();
      } catch {
        /* Visual matching is optional; selling continues without it. */
      } finally {
        running.current = false;
      }
    }, RECONCILE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [store, revision, refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = AppState.addEventListener("change", (state) => {
      clearTimeout(timer);
      if (state === "background")
        timer = setTimeout(
          () => void vision.unload(),
          UNLOAD_AFTER_BACKGROUND_MS,
        );
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return children;
}
