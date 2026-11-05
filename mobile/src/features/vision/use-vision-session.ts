import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/components/shop-ui";
import { vision, type VisionModels } from "@/features/vision/vision-service";

export type VisionSession =
  | { state: "loading" }
  | { state: "ready"; models: VisionModels }
  | { state: "error"; message: string };

/**
 * Loads the models for a camera screen and holds a foreground lease while it is
 * mounted, so background embedding never shares the models with the camera.
 * `prepare` runs once the models are loaded, still behind the loading screen (e.g. building
 * the vector index), so the camera screen never does that work while it renders.
 */
export function useVisionSession(prepare?: () => void): VisionSession {
  const prepareOnce = useRef(prepare);
  const [session, setSession] = useState<VisionSession>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    void (async () => {
      try {
        release = await vision.acquireForeground();
        if (cancelled) return release();
        const models = await vision.load();
        if (cancelled) return;
        prepareOnce.current?.();
        setSession({ state: "ready", models });
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
