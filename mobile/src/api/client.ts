/**
 * The only module that talks to the network. It knows the API's conventions so screens don't:
 * - Errors arrive as `{error: {code, message}}` and become an ApiError with the same code.
 *   No connection, or a timeout, is an ApiError with code "network".
 * - A signed-in person's access token is refreshed before it expires, and on a 401, by one
 *   refresh shared by every request waiting on it (refresh tokens are single use).
 * - A phone's device token (for the roster and sync) is fetched and cached the same way.
 * - Every POST carries an Idempotency-Key that is kept across its retries, so a retry after a
 *   lost response never does the thing twice. Sign-in and registration are never retried.
 * - Retries back off with jitter and honour Retry-After.
 */

import type { DeviceCredential } from "../auth/secrets.ts";
import type { DeviceTokenResponse, TokenResponse } from "./types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.code === "network";
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

type Auth = "none" | "user" | "device";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  auth?: Auth;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
  /** False for sign-in and registration: a retry could register a phone twice. */
  retry?: boolean;
};

export type ApiResponse<T> = { status: number; data: T; headers: Headers };

export type ClientOptions = {
  baseUrl: string;
  newId: () => string;
  deviceCredential: () => Promise<DeviceCredential | null>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /**
   * A refresh token was issued or rotated (null: the session ended). Persist it if wanted.
   * A rotation waits for the returned promise: if the app died before the new token reached
   * the keystore, the next launch would replay the old one.
   */
  onRefreshToken?: (token: string | null) => void | Promise<void>;
  /** The server no longer accepts this phone. */
  onDeviceRevoked?: () => void;
};

type Session = { access: string | null; refresh: string; expiresAt: number };

const MAX_RETRIES = 2;
const EARLY_REFRESH_MS = 30_000;

export class ApiClient {
  private options: Required<
    Omit<ClientOptions, "onRefreshToken" | "onDeviceRevoked">
  > &
    Pick<ClientOptions, "onRefreshToken" | "onDeviceRevoked">;
  private session: Session | null = null;
  private refreshing: Promise<void> | null = null;
  private device: { token: string; expiresAt: number } | null = null;
  private deviceTokenPending: Promise<string> | null = null;

  constructor(options: ClientOptions) {
    this.options = {
      fetch: (...args) => fetch(...args),
      timeoutMs: 15_000,
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
    };
  }

  hasSession(): boolean {
    return this.session !== null;
  }

  /** After a sign-in or registration. Resolves once the refresh token is persisted. */
  async startSession(tokens: TokenResponse): Promise<void> {
    this.session = {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expiresAt: this.options.now() + tokens.expires_in * 1000,
    };
    try {
      await this.options.onRefreshToken?.(tokens.refresh_token);
    } catch {
      // The session in memory is right; a failed save only costs a sign-in after a restart.
    }
  }

  /** A saved refresh token (a personal phone reopened); the access token is fetched lazily. */
  resumeSession(refreshToken: string): void {
    this.session = { access: null, refresh: refreshToken, expiresAt: 0 };
  }

  /** Forget the person's session here (the server session is revoked separately). */
  endSession(): void {
    if (this.session === null) return;
    this.session = null;
    void this.options.onRefreshToken?.(null);
  }

  /** Forget the cached device token, e.g. after the phone got a new credential. */
  resetDevice(): void {
    this.device = null;
  }

  async request<T>(
    method: Method,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const { auth = "user", retry = true } = options;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    // One key per logical request, reused by its retries.
    if (method === "POST" && retry) headers["Idempotency-Key"] ??= this.options.newId();
    const url = this.url(path, options.query);
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.authorised<T>(method, url, headers, body, auth);
      } catch (error) {
        if (!retry || attempt >= MAX_RETRIES || !retriable(error)) throw error;
        await this.options.sleep(this.backoff(attempt, error));
      }
    }
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return (await this.request<T>("GET", path, options)).data;
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await this.request<T>("POST", path, { ...options, body })).data;
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await this.request<T>("PUT", path, { ...options, body })).data;
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return (await this.request<T>("PATCH", path, { ...options, body })).data;
  }

  async delete(path: string, options?: RequestOptions): Promise<void> {
    await this.request<null>("DELETE", path, options);
  }

  private url(path: string, query: RequestOptions["query"]): string {
    const params = Object.entries(query ?? {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return `${this.options.baseUrl}${path}${params.length ? `?${params.join("&")}` : ""}`;
  }

  private backoff(attempt: number, error: unknown): number {
    const hinted = error instanceof ApiError ? error.retryAfterMs : null;
    if (hinted !== null) return Math.min(hinted, 10_000);
    const base = 500 * 2 ** attempt;
    return base / 2 + this.options.random() * base;
  }

  private async authorised<T>(
    method: Method,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
    auth: Auth,
  ): Promise<ApiResponse<T>> {
    if (auth === "none") return this.send<T>(method, url, headers, body);
    const token = auth === "user" ? await this.accessToken() : await this.deviceToken();
    try {
      return await this.send<T>(method, url, { ...headers, Authorization: `Bearer ${token}` }, body);
    } catch (error) {
      // An expired or rotated token: get a fresh one once, then give up.
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (auth === "device") {
        if (error.code === "device_revoked") this.options.onDeviceRevoked?.();
        if (error.code !== "invalid_token") throw error;
        this.device = null;
        const fresh = await this.deviceToken();
        return this.send<T>(method, url, { ...headers, Authorization: `Bearer ${fresh}` }, body);
      }
      if (error.code !== "invalid_token" || this.session === null) {
        if (error.code === "session_revoked" || error.code === "account_disabled")
          this.endSession();
        throw error;
      }
      this.session.access = null;
      const fresh = await this.accessToken();
      return this.send<T>(method, url, { ...headers, Authorization: `Bearer ${fresh}` }, body);
    }
  }

  private async accessToken(): Promise<string> {
    const session = this.session;
    if (session === null)
      throw new ApiError(401, "signed_out", "Sign in to continue.");
    if (session.access && session.expiresAt - EARLY_REFRESH_MS > this.options.now())
      return session.access;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
    if (this.session?.access == null)
      throw new ApiError(401, "signed_out", "Sign in to continue.");
    return this.session.access;
  }

  private async refresh(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    try {
      const { data } = await this.send<TokenResponse>(
        "POST",
        this.url("/api/v1/tokens", undefined),
        { Accept: "application/json", "Content-Type": "application/json" },
        JSON.stringify({ grant_type: "refresh_token", refresh_token: session.refresh }),
      );
      if (this.session !== session) return; // Signed out meanwhile.
      await this.startSession(data);
    } catch (error) {
      // Offline keeps the session for later; a refused refresh ends it.
      if (error instanceof ApiError && error.status === 401 && this.session === session)
        this.endSession();
      throw error;
    }
  }

  private async deviceToken(): Promise<string> {
    if (this.device && this.device.expiresAt - EARLY_REFRESH_MS > this.options.now())
      return this.device.token;
    this.deviceTokenPending ??= (async () => {
      const credential = await this.options.deviceCredential();
      if (!credential)
        throw new ApiError(401, "device_unregistered", "This phone is not registered.");
      try {
        const { data } = await this.send<DeviceTokenResponse>(
          "POST",
          this.url("/api/v1/tokens", undefined),
          { Accept: "application/json", "Content-Type": "application/json" },
          JSON.stringify({ grant_type: "device", ...credential }),
        );
        this.device = {
          token: data.access_token,
          expiresAt: this.options.now() + data.expires_in * 1000,
        };
        return data.access_token;
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.code === "device_revoked" || error.code === "invalid_device")
        )
          this.options.onDeviceRevoked?.();
        throw error;
      }
    })().finally(() => {
      this.deviceTokenPending = null;
    });
    return this.deviceTokenPending;
  }

  private async send<T>(
    method: Method,
    url: string,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        0,
        "network",
        "No connection to Mokhotsi. Check the phone's data or Wi-Fi and try again.",
      );
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 304)
      return { status: 304, data: null as T, headers: response.headers };
    const text = await response.text();
    const json = text ? safeJson(text) : null;
    if (response.ok)
      return { status: response.status, data: json as T, headers: response.headers };
    const error = (json as { error?: { code?: string; message?: string } } | null)
      ?.error;
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? defaultMessage(response.status),
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    );
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function retriable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.code === "idempotency_in_progress") return true;
  // A long Retry-After (e.g. the hourly PIN-change limit) is the person's to wait out.
  if (error.status === 429) return (error.retryAfterMs ?? 0) <= 10_000;
  return error.status === 0 || error.status >= 500;
}

function defaultMessage(status: number): string {
  if (status >= 500) return "Mokhotsi is having trouble right now. Try again in a moment.";
  if (status === 429) return "Too many tries. Wait a moment and try again.";
  return "Something went wrong. Please try again.";
}
