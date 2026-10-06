import type { PullResponse, PushRequest, PushResponse } from '@/contracts/sync';
import { AppError } from '@/lib/errors';

/** Error shape returned by the API: { error: { code, message, details } }. */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends AppError {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined, message?: string) {
    super(body?.error.code ?? `http_${status}`, message ?? body?.error.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Network unreachable or timed out (as opposed to an HTTP error response). */
export class NetworkError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('network_error', message, options);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  timeoutMs?: number;
}

export interface ApiClient {
  request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T>;
  push(body: PushRequest): Promise<PushResponse>;
  pull(cursor: string | null, limit: number): Promise<PullResponse>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const token = await options.getAccessToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    // TODO(feature): on 401, call POST /auth/refresh once and retry with the new access token.
    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new NetworkError(`${method} ${path} failed: ${String(cause)}`, { cause });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
    if (!response.ok) throw new ApiError(response.status, json as ApiErrorBody | undefined);
    return json as T;
  }

  return {
    request,
    push: (body) => request<PushResponse>('POST', '/sync/push', body),
    pull: (cursor, limit) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) query.set('cursor', cursor);
      return request<PullResponse>('GET', `/sync/pull?${query.toString()}`);
    },
  };
}
