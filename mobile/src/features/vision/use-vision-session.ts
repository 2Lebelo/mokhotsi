import { useEffect, useState } from "react";

import { errorMessage } from "@/components/shop-ui";
import { vision, type VisionModels } from "@/features/vision/vision-service";

export type VisionSession =
  | { state: "loading" }
  | { state: "ready"; models: VisionModels }
  | { state: "error"; message: string };

/**
 * Loads the models for a camera screen and holds a foreground lease while it is
 * mounted, so background embedding never shares the models with the camera.
 */
export function useVisionSession(): VisionSession {
  const [session, setSession] = useState<VisionSession>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    void (async () => {
      try {
        release = await vision.acquireForeground();
        if (cancelled) return release();
        const models = await vision.load();
        if (!cancelled) setSession({ state: "ready", models });
      } catch (cause) {
        if (!cancelled)
          setSession({ state: "error", message: errorMessage(cause) });
      }
    })();
    return () => {
      cancelled = true;
      release?.();
    };
  }, []);
  return session;
}
