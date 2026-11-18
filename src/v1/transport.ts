/**
 * The HTTP transport for the consolidated v1 API.
 *
 * Everything in this module is plain `fetch` + `URL` + `Headers`: no kwil
 * client, no node built-ins. That is what lets the whole `src/v1` entry graph be
 * bundled for a browser (the `check:v1` guard proves it).
 *
 * The transport owns the base URL and network selector, the bearer credential,
 * the request timeout, and turning a response into either a typed `V1Success`
 * envelope or a thrown {@link V1ApiError}.
 */

import { parseV1Error, V1ApiError } from "./errors";
import type { V1Success } from "./types";

/** A query value. Arrays become repeated parameters; `null`/`undefined` are dropped. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/** Options for constructing a {@link Transport}. */
export interface TransportOptions {
  /**
   * The deployment base URL, for example `https://api.trufscan.io`. Required: the
   * SDK never hard-codes a host. A trailing slash is trimmed.
   */
  baseUrl: string;
  /** The network id placed in the path, for example `mainnet` or `testnet`. */
  network: string;
  /** Injectable `fetch`, for tests or a non-global implementation. Defaults to the global. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Supplies the bearer credential. Returning `null` sends no `Authorization` header. */
  getToken?: () => Promise<string | null> | string | null;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  /**
   * The `Origin` header to send. Browsers set their own; a server-side mint
   * needs one that is on the API's allowlist. Ignored by the browser fetch.
   */
  origin?: string;
}

/** Per-request options for {@link Transport.request}. */
export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  /** Set false to send the request without a credential. Defaults to true. */
  includeAuth?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeBaseUrl(raw: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("a non-empty baseUrl is required");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`baseUrl is not an absolute URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseUrl must be http or https, got ${parsed.protocol}`);
  }
  return raw.replace(/\/+$/, "");
}

function validateNetwork(network: string): string {
  if (typeof network !== "string" || !/^[A-Za-z0-9._-]+$/.test(network)) {
    throw new Error(`invalid network id: ${String(network)}`);
  }
  return network;
}

function appendQuery(
  params: URLSearchParams,
  query?: Record<string, QueryValue>,
): void {
  if (query === undefined) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
      continue;
    }
    params.append(key, String(value));
  }
}

/** A JSON replacer that serialises `bigint` values as decimal strings. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function isSuccessEnvelope(value: unknown): value is V1Success<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === true
  );
}

function isErrorEnvelope(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { ok?: unknown }).ok === false
  );
}

/** The v1 HTTP transport. Construct one per base URL and network. */
export class Transport {
  readonly baseUrl: string;
  readonly network: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly getToken?: TransportOptions["getToken"];
  private readonly headers: Record<string, string>;
  private readonly origin?: string;

  constructor(options: TransportOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.network = validateNetwork(options.network);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error(
        "no fetch implementation is available; pass one in TransportOptions.fetch",
      );
    }
    // Call it as a plain function. A browser's `fetch` refuses any receiver
    // but the window ("Illegal invocation"), and `this.fetchImpl(...)` would
    // pass this Transport as the receiver.
    this.fetchImpl = (input, init) => fetchImpl(input, init);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive number");
    }
    this.getToken = options.getToken;
    this.headers = options.headers ?? {};
    this.origin = options.origin;
  }

  /** Build the full URL for a route under `/{network}/v1/`. */
  url(path: string, query?: Record<string, QueryValue>): string {
    const relative = path.replace(/^\/+/, "");
    const base = `${this.baseUrl}/${this.network}/v1${relative === "" ? "" : `/${relative}`}`;
    if (query === undefined) return base;
    const params = new URLSearchParams();
    appendQuery(params, query);
    const suffix = params.toString();
    return suffix === "" ? base : `${base}?${suffix}`;
  }

  private async resolveToken(): Promise<string | null> {
    if (this.getToken === undefined) return null;
    const token = await this.getToken();
    return token === "" ? null : token;
  }

  /** Perform one request and return the parsed `V1Success` envelope. */
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<V1Success<T>> {
    const url = this.url(path, options.query);
    const headers = new Headers();
    headers.set("Accept", "application/json");
    for (const [key, value] of Object.entries(this.headers))
      headers.set(key, value);
    if (this.origin !== undefined) headers.set("Origin", this.origin);
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");

    if (options.includeAuth !== false) {
      const token = await this.resolveToken();
      if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    if (options.signal !== undefined) {
      if (options.signal.aborted) controller.abort();
      else
        options.signal.addEventListener("abort", onExternalAbort, {
          once: true,
        });
    }

    let response: Response;
    let text: string;
    // The status of an error response whose body then failed to arrive. It is
    // kept, so a 401 is not mistaken for a request that got no response; a body
    // lost after a success status stays 0, a transient failure.
    let errorStatus = 0;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body, bigintReplacer),
        signal: controller.signal,
      });
      if (!response.ok) errorStatus = response.status;
      // Read the body while the timeout and the caller abort still apply: a
      // server that sends headers and then stalls would otherwise hang forever.
      text = await response.text();
    } catch (cause) {
      // Distinguish our own timeout from a caller-supplied abort: both surface
      // as an aborted `controller`, so `controller.signal.aborted` alone would
      // mislabel a caller abort as a timeout.
      if (timedOut) {
        throw V1ApiError.transport(
          errorStatus,
          `request timed out after ${this.timeoutMs}ms`,
          undefined,
          cause,
        );
      }
      if (options.signal?.aborted === true) {
        throw V1ApiError.transport(
          errorStatus,
          "request aborted",
          undefined,
          cause,
        );
      }
      throw V1ApiError.transport(
        errorStatus,
        errorStatus === 0
          ? "network request failed"
          : `the body of the HTTP ${errorStatus} response could not be read`,
        undefined,
        cause,
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }

    if (!response.ok) {
      throw parseV1Error(response.status, text);
    }

    let parsed: unknown;
    try {
      parsed = text.trim() === "" ? undefined : JSON.parse(text);
    } catch {
      throw V1ApiError.transport(
        response.status,
        "response is not valid JSON",
        text,
      );
    }
    // A 200 with `ok: false` is still an error envelope.
    if (isErrorEnvelope(parsed)) {
      throw parseV1Error(response.status, text);
    }
    if (!isSuccessEnvelope(parsed)) {
      throw V1ApiError.transport(
        response.status,
        "response is not a v1 success envelope",
        text,
      );
    }
    return parsed as V1Success<T>;
  }

  /** `GET` a route and return its success envelope. */
  get<T>(path: string, options?: RequestOptions): Promise<V1Success<T>> {
    return this.request<T>("GET", path, options);
  }

  /** `POST` a JSON body and return the success envelope. */
  post<T>(path: string, options?: RequestOptions): Promise<V1Success<T>> {
    return this.request<T>("POST", path, options);
  }
}
