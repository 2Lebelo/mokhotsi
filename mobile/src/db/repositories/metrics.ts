import { notImplemented } from '@/lib/errors';
import type { Metric } from '@/db/schema';

/** Known metric kinds; extend as features add timings. */
export type MetricKind = 'detect_ms' | 'embed_ms' | 'match_ms' | 'frame_total_ms' | 'push_ms' | 'pull_ms';

/** Local-only (not synced). Keep calls off the frame-processor thread: batch from JS. */
export function recordMetric(kind: MetricKind, valueMs: number, meta?: Record<string, unknown>): void {
  // TODO(feature): insert into metrics (id, kind, value_ms, meta JSON, created_at).
  return notImplemented('metrics.recordMetric');
}

export function recentMetrics(kind: MetricKind, limit: number): Metric[] {
  // TODO(feature): select where kind = ? order by created_at desc limit ? (metrics_kind_created_idx).
  return notImplemented('metrics.recentMetrics');
}
