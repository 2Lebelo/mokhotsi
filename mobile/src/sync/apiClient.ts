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

/** The refresh token was refused: the user has to sign in again. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

// --- Wire types for /api/v1/tokens, /users/me/password and /shops (api/app/schemas/). ---

export interface TokenUser {
  id: string;
  email: string;
  name: string;
  role: 'system_admin' | 'shop_keeper' | 'shop_sitter';
  must_change_password: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  session_id: string;
  user: TokenUser;
}

export interface ShopSummary {
  id: string;
  name: string;
  status: 'active' | 'archived';
  my_role: 'keeper' | 'sitter' | null;
  my_permissions: string[] | null;
}

interface Page<T> {
  data: T[];
  page: { next_cursor: string | null; limit: number };
}

/** How the client gets and renews the access token (implemented by the session store). */
export interface AuthHooks {
  getAccessToken(): string | null;
  /** Renew the access token; resolves null when the session is gone (sign in again). */
  refresh(): Promise<string | null>;
}

export interface ApiClientOptions {
  baseUrl: string;
  auth?: AuthHooks;
  timeoutMs?: number;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  /** Send the access token and refresh it once on 401 (default true). */
  auth?: boolean;
}

export interface ApiClient {
  request<T>(method: Method, path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  login(email: string, password: string, deviceId: string): Promise<TokenResponse>;
  refreshTokens(refreshToken: string): Promise<TokenResponse>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  revokeCurrentSession(): Promise<void>;
  listShops(): Promise<ShopSummary[]>;
  push(shopId: string, body: PushRequest): Promise<PushResponse>;
  pull(shopId: string, cursor: string | null, limit: number): Promise<PullResponse>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const V1 = '/api/v1';

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  async function send(method: Method, path: string, body: unknown, token: string | null): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetchImpl(`${options.baseUrl}${path}`, {
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
  }

  async function request<T>(method: Method, path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    const useAuth = (opts?.auth ?? true) && options.auth !== undefined;
    let response = await send(method, path, body, useAuth ? options.auth!.getAccessToken() : null);
    if (response.status === 401 && useAuth) {
      // Access tokens live 15 minutes: renew once and retry. refresh() is single-flight.
      const renewed = await options.auth!.refresh();
      if (renewed) response = await send(method, path, body, renewed);
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const errorBody = isErrorBody(json) ? json : undefined;
      throw new ApiError(response.status, errorBody);
    }
    return json as T;
  }

  return {
    request,
    login: (email, password, deviceId) =>
      request<TokenResponse>(
        'POST',
        `${V1}/tokens`,
        { grant_type: 'password', email, password, device_id: deviceId },
        { auth: false },
      ),
    refreshTokens: (refreshToken) =>
      request<TokenResponse>(
        'POST',
        `${V1}/tokens`,
        { grant_type: 'refresh_token', refresh_token: refreshToken },
        { auth: false },
      ),
    changePassword: (currentPassword, newPassword) =>
      request<void>('PUT', `${V1}/users/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    revokeCurrentSession: () => request<void>('DELETE', `${V1}/sessions/current`),
    listShops: async () => {
      const page = await request<Page<ShopSummary>>('GET', `${V1}/shops?limit=100`);
      return page.data;
    },
    push: (shopId, body) => request<PushResponse>('POST', `${V1}/shops/${shopId}/sync/push`, body),
    pull: (shopId, cursor, limit) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor !== null) query.set('cursor', cursor);
      return request<PullResponse>('GET', `${V1}/shops/${shopId}/sync/pull?${query.toString()}`);
    },
  };
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}
