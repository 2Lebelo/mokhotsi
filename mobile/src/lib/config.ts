import Constants from 'expo-constants';

import { ConfigError } from './errors';

export interface AppConfig {
  /** Base URL of the FastAPI backend (from app.config.ts `extra.apiUrl`). */
  readonly apiUrl: string;
}

/** Sync limits shared with contracts/sync.schema.json. */
export const SYNC_LIMITS = {
  /** Max ops per POST /sync/push (schema `maxItems`). */
  pushBatchSize: 200,
  /** Max records per GET /sync/pull page. */
  pullPageSize: 500,
} as const;

let cached: AppConfig | undefined;

/** Typed, validated view of `extra`. Throws ConfigError on a broken build config. */
export function getConfig(): AppConfig {
  if (cached) return cached;
  const extra: Record<string, unknown> = Constants.expoConfig?.extra ?? {};
  const apiUrl = extra.apiUrl;
  if (typeof apiUrl !== 'string' || !/^https?:\/\//.test(apiUrl)) {
    throw new ConfigError(`extra.apiUrl must be an http(s) URL, got ${String(apiUrl)}`);
  }
  cached = Object.freeze({ apiUrl: apiUrl.replace(/\/+$/, '') });
  return cached;
}
