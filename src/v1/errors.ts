import type { V1ErrorDetails, V1ErrorResponse } from "./types";

/**
 * A typed error for a failed v1 call. Branch on `code` (and `details.lever`),
 * never on `message`, which is for humans and may change.
 *
 * An error from a matched route has a v1 `error.code`. An unmatched path may be
 * a plain-text `404 page not found` with no code; that surfaces with
 * {@link V1ApiError.TRANSPORT_CODE}, and the raw body is kept on `body`.
 */
export class V1ApiError extends Error {
  /** The HTTP status code. */
  readonly status: number;
  /** The stable v1 `error.code`, or a client-side code when there was no JSON body. */
  readonly code: string;
  /** The v1 `details` object, when the server sent one. */
  readonly details?: V1ErrorDetails;
  /** The raw response body text, kept for debugging. */
  readonly body?: string;

  /**
   * A code used when the response was not a v1 JSON error (for example a
   * plain-text 404 or a network failure). It is not a server code.
   */
  static readonly TRANSPORT_CODE = "transport_error";

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: V1ErrorDetails; body?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "V1ApiError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.body = options.body;
    if (options.cause !== undefined) {
      // Preserve the cause chain where the runtime supports it.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  /** True when this error carries the given v1 code. */
  is(code: V1ErrorCodeLike): boolean {
    return this.code === code;
  }

  /** True when this is a `resource_exhausted` or `permission_denied` on the given lever. */
  isLever(lever: string): boolean {
    return this.details?.lever === lever;
  }

  /** Build the transport-level error (no server code) for a non-JSON or unreachable response. */
  static transport(
    status: number,
    message: string,
    body?: string,
    cause?: unknown,
  ): V1ApiError {
    return new V1ApiError(status, V1ApiError.TRANSPORT_CODE, message, {
      body,
      cause,
    });
  }
}

type V1ErrorCodeLike = string;

/**
 * Thrown before a call when the cached capabilities document says a namespace is
 * not offered (or not permitted). The server would answer `409`
 * `namespace_unavailable`, or `403` `permission_denied`; this surfaces the same
 * fact without a round trip. When no capabilities have been loaded, the call is
 * attempted and the server's own error is surfaced.
 */
export class NamespaceUnavailableError extends Error {
  readonly network: string;
  readonly namespace: string;

  constructor(network: string, namespace: string) {
    super(`namespace ${namespace} is not available on network ${network}`);
    this.name = "NamespaceUnavailableError";
    this.network = network;
    this.namespace = namespace;
  }
}

function isV1ErrorResponse(value: unknown): value is V1ErrorResponse {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.ok !== false) return false;
  const err = v.error;
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === "string" && typeof e.message === "string";
}

/**
 * Parse a failed HTTP response into a {@link V1ApiError}.
 *
 * A matched v1 route returns `{"ok":false,"error":{"code","message","details"?}}`.
 * An unmatched path may return plain text; that becomes a transport-level error
 * carrying the raw body so a caller can still tell it apart from a JSON error.
 */
export function parseV1Error(status: number, bodyText: string): V1ApiError {
  const trimmed = bodyText.trim();
  if (trimmed !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
    if (isV1ErrorResponse(parsed)) {
      return new V1ApiError(status, parsed.error.code, parsed.error.message, {
        details: parsed.error.details,
        body: bodyText,
      });
    }
  }
  return V1ApiError.transport(
    status,
    trimmed === "" ? `request failed with status ${status}` : trimmed,
    bodyText,
  );
}
