import type { PeriodKind } from "../db/types.ts";

// Calendar periods in the phone's local time, as a shop counts them: today,
// this week (Monday to Sunday), this month, and this quarter (Jan–Mar, …).
// Sale times are stored as UTC ISO strings, so each boundary is a local
// midnight converted to ISO, the same approach as today's dashboard total.

export type PeriodRange = {
  start: Date;
  /** Exclusive. */
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

export const PERIODS: readonly { kind: PeriodKind; label: string }[] = [
  { kind: "today", label: "Today" },
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "quarter", label: "Quarter" },
];

export function periodRange(kind: PeriodKind, now = new Date()): PeriodRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  switch (kind) {
    case "today":
      return {
        start: new Date(year, month, day),
        end: new Date(year, month, day + 1),
        previousStart: new Date(year, month, day - 1),
        previousEnd: new Date(year, month, day),
      };
    case "week": {
      const monday = day - ((now.getDay() + 6) % 7);
      return {
        start: new Date(year, month, monday),
        end: new Date(year, month, monday + 7),
        previousStart: new Date(year, month, monday - 7),
        previousEnd: new Date(year, month, monday),
      };
    }
    case "month":
      return {
        start: new Date(year, month, 1),
        end: new Date(year, month + 1, 1),
        previousStart: new Date(year, month - 1, 1),
        previousEnd: new Date(year, month, 1),
      };
    case "quarter": {
      const first = month - (month % 3);
      return {
        start: new Date(year, first, 1),
        end: new Date(year, first + 3, 1),
        previousStart: new Date(year, first - 3, 1),
        previousEnd: new Date(year, first, 1),
      };
    }
  }
}

/** Whether two instants fall on the same local calendar day. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Percentage change from `previous` to `current`, or null when there is no base. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
