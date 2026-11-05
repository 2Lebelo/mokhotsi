import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
import { AppState } from "react-native";

import { nextDelay } from "@/features/onboarding/poll";

/**
 * Calls `check` while a registration waits for approval: soon at first, then backing off to
 * every five minutes with jitter (see poll.ts). Only one check runs at a time, nothing runs
 * while the app is in the background, and coming back or reconnecting checks at once.
 * `check` must be stable (useCallback).
 */
export function useApprovalPolling(check: () => Promise<void>): void {
  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let stopped = false;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && AppState.currentState === "active")
        timer = setTimeout(() => void run(), nextDelay(attempt++));
    };
    const run = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await check();
      } catch {
        // Offline or a server error: the next check will tell.
      } finally {
        running = false;
        schedule();
      }
    };
    const now = () => {
      attempt = 0;
      clearTimeout(timer);
      void run();
    };

    schedule();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") now();
      else clearTimeout(timer);
    });
    let wasOnline = true;
    const network = NetInfo.addEventListener((state) => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online && !wasOnline) now();
      wasOnline = online;
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      appState.remove();
      network();
    };
  }, [check]);
}
