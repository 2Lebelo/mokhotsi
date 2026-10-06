/** Why a sync run was requested (see worker.ts for the trigger list). */
export type SyncTrigger = 'app_start' | 'network_regained' | 'after_sale' | 'manual' | 'backoff_retry';

export interface PushResult {
  acked: number;
  rejected: number;
  /** True when the outbox still holds ops after this run (e.g. more than one batch). */
  remaining: boolean;
}

export interface PullResult {
  applied: number;
  pages: number;
  cursor: string | null;
}

export type SyncStatus =
  | { state: 'idle'; lastSuccessAt: number | null }
  | { state: 'running'; trigger: SyncTrigger }
  | { state: 'backoff'; retryAt: number; error: string }
  | { state: 'disabled'; reason: string };
