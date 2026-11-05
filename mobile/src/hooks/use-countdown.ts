import { useEffect, useState } from "react";

/** Whole seconds left until `until` (epoch ms), ticking; 0 when there is nothing to wait for. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const waiting = until !== null && until > now;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [waiting]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}
