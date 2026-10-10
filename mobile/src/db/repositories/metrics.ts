import { desc, eq } from 'drizzle-orm';

import { newId } from '@/lib/ids';
import { db } from '@/db/client';
import { metrics, type Metric } from '@/db/schema';

/** Known metric kinds; extend as features add timings. */
export type MetricKind = 'detect_ms' | 'embed_ms' | 'match_ms' | 'frame_total_ms' | 'push_ms' | 'pull_ms';

/** Local-only (not synced). Keep calls off the frame-processor thread: batch from JS. */
export function recordMetric(kind: MetricKind, valueMs: number, meta?: Record<string, unknown>): void {
  db.insert(metrics)
    .values({
      id: newId(),
      kind,
      valueMs,
      meta: meta === undefined ? null : JSON.stringify(meta),
      createdAt: Date.now(),
    })
    .run();
}

export function recentMetrics(kind: MetricKind, limit: number): Metric[] {
  return db
    .select()
    .from(metrics)
    .where(eq(metrics.kind, kind))
    .orderBy(desc(metrics.createdAt))
    .limit(limit)
    .all();
}
