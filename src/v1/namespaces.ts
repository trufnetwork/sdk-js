/**
 * Typed access to the read namespaces.
 *
 * The v1 contract groups its read routes under a namespace segment
 * (`/{network}/v1/{namespace}/...`). {@link NamespaceReader} is the generic
 * accessor — a typed success envelope, typed query options, and the shared
 * cursor walker — and the concrete readers below add the routes that matter
 * most for Phase 1 (`streams`, `chain`, `markets`). `agents`, `bridge`, and
 * `metadata` are Phase 2 and reachable through `namespaces.ts` (see the
 * `V1Client`), but are not given named readers yet.
 */

import type { QueryValue, Transport } from "./transport";
import { walkCursor, type WalkCursorOptions } from "./pagination";
import type { V1Success } from "./types";

/** Per-request options for a namespace read. */
export interface NamespaceRequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

/** A locator-addressed stream identity on the `streams` routes. */
export interface V1StreamLocator {
  /** The data provider address (hex, optional `0x`). */
  provider: string;
  /** The stream id, for example `st1...`. */
  id: string;
}

function locatorPath(locator: V1StreamLocator): string {
  if (locator === null || typeof locator !== "object") {
    throw new Error("a stream locator {provider, id} is required");
  }
  if (typeof locator.provider !== "string" || locator.provider === "") {
    throw new Error("stream locator provider must be a non-empty string");
  }
  if (typeof locator.id !== "string" || locator.id === "") {
    throw new Error("stream locator id must be a non-empty string");
  }
  return `${encodeURIComponent(locator.provider)}/${encodeURIComponent(locator.id)}`;
}

/**
 * Generic accessor for one namespace. Every method takes a route relative to the
 * namespace segment (for example `""` for `markets`, or
 * `blocks` for `chain/blocks`).
 */
export class NamespaceReader {
  constructor(
    protected readonly transport: Transport,
    readonly name: string,
  ) {
    if (typeof name !== "string" || !/^[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`invalid namespace name: ${String(name)}`);
    }
  }

  /** The full route path for a relative segment. */
  protected path(relative: string): string {
    const trimmed = relative.replace(/^\/+/, "");
    return trimmed === "" ? this.name : `${this.name}/${trimmed}`;
  }

  /** `GET` one entity and return its typed success envelope. */
  entity<T = Record<string, unknown>>(
    relative: string,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.transport.get<T>(this.path(relative), options);
  }

  /** `GET` one page of a list, with an optional explicit cursor. */
  list<T = Record<string, unknown>>(
    relative: string,
    options?: NamespaceRequestOptions & { cursor?: string | null },
  ): Promise<V1Success<T[]>> {
    const query: Record<string, QueryValue> = { ...(options?.query ?? {}) };
    if (options?.cursor !== undefined && options.cursor !== null) {
      query.cursor = options.cursor;
    }
    return this.transport.get<T[]>(this.path(relative), {
      query,
      signal: options?.signal,
    });
  }

  /**
   * Walk a list's cursor, copying each cursor verbatim and stopping on `null`.
   * `limit` is sent on every page; it is the only paging knob v1 has.
   */
  paginate<T = Record<string, unknown>>(
    relative: string,
    options?: NamespaceRequestOptions & { limit?: number } & Pick<
        WalkCursorOptions,
        "maxPages"
      >,
  ): AsyncGenerator<V1Success<T[]>, void, void> {
    if (
      options?.limit !== undefined &&
      (!Number.isInteger(options.limit) || options.limit <= 0)
    ) {
      throw new Error("limit must be a positive integer");
    }
    const staticQuery: Record<string, QueryValue> = {
      ...(options?.query ?? {}),
    };
    if (options?.limit !== undefined) staticQuery.limit = options.limit;
    const path = this.path(relative);
    return walkCursor<T>(
      (cursor, signal) => {
        const query: Record<string, QueryValue> = { ...staticQuery };
        if (cursor !== null) query.cursor = cursor;
        return this.transport.get<T[]>(path, { query, signal });
      },
      { maxPages: options?.maxPages, signal: options?.signal },
    );
  }

  /** Walk a list to completion and return all items. */
  async collect<T = Record<string, unknown>>(
    relative: string,
    options?: NamespaceRequestOptions & { limit?: number } & Pick<
        WalkCursorOptions,
        "maxPages"
      >,
  ): Promise<T[]> {
    const items: T[] = [];
    for await (const page of this.paginate<T>(relative, options)) {
      items.push(...page.data);
    }
    return items;
  }
}

/** Typed reader for the `streams` namespace (locator-addressed; no list route). */
export class StreamsReader extends NamespaceReader {
  constructor(transport: Transport) {
    super(transport, "streams");
  }

  /** `GET /streams/{provider}/{id}`. */
  stream<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(locatorPath(locator), options);
  }

  /** `GET /streams/{provider}/{id}/records`. */
  records<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/records`, options);
  }

  /** `GET /streams/{provider}/{id}/index`. */
  index<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/index`, options);
  }

  /** `GET /streams/{provider}/{id}/index-change`. */
  indexChange<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/index-change`, options);
  }

  /** `GET /streams/{provider}/{id}/first-record`. */
  firstRecord<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/first-record`, options);
  }

  /** `GET /streams/{provider}/{id}/taxonomy`. */
  taxonomy<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/taxonomy`, options);
  }

  /** `GET /streams/{provider}/{id}/access`. */
  access<T = Record<string, unknown>>(
    locator: V1StreamLocator,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>(`${locatorPath(locator)}/access`, options);
  }
}

/** Typed reader for the `chain` namespace. */
export class ChainReader extends NamespaceReader {
  constructor(transport: Transport) {
    super(transport, "chain");
  }

  /** `GET /chain/blocks` as a cursor walker. */
  blocks<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions & { limit?: number },
  ) {
    return this.paginate<T>("blocks", options);
  }

  /** `GET /chain/block`, by `height` or `hash` (the latest block if neither). */
  block<T = Record<string, unknown>>(
    params: { height?: number; hash?: string } = {},
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    const query: Record<string, QueryValue> = { ...(options?.query ?? {}) };
    if (params.height !== undefined) {
      if (!Number.isInteger(params.height) || params.height < 0) {
        throw new Error("height must be a non-negative integer");
      }
      query.height = params.height;
    }
    if (params.hash !== undefined) query.hash = params.hash;
    return this.entity<T>("block", { ...options, query });
  }

  /** `GET /chain/transactions` as a cursor walker. */
  transactions<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions & { limit?: number },
  ) {
    return this.paginate<T>("transactions", options);
  }

  /** `GET /chain/transactions/{hash}`. */
  transaction<T = Record<string, unknown>>(
    hash: string,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    if (typeof hash !== "string" || hash === "") {
      throw new Error("a transaction hash is required");
    }
    return this.entity<T>(`transactions/${encodeURIComponent(hash)}`, options);
  }

  /** `GET /chain/transactions/count`. */
  transactionCount<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>("transactions/count", options);
  }

  /** `GET /chain/accounts/count`. */
  accountCount<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>("accounts/count", options);
  }

  /** `GET /chain/nodes/count`. */
  nodeCount<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    return this.entity<T>("nodes/count", options);
  }
}

/** Typed reader for the `markets` namespace. */
export class MarketsReader extends NamespaceReader {
  constructor(transport: Transport) {
    super(transport, "markets");
  }

  /** `GET /markets` as a cursor walker. */
  markets<T = Record<string, unknown>>(
    options?: NamespaceRequestOptions & { limit?: number },
  ) {
    return this.paginate<T>("", options);
  }

  /** `GET /markets/{id}`. */
  market<T = Record<string, unknown>>(
    id: string,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    if (typeof id !== "string" || id === "")
      throw new Error("a market id is required");
    return this.entity<T>(encodeURIComponent(id), options);
  }

  /** `GET /markets/{id}/{sub}` for `orderbook`, `depth`, `prices`, `activity`, ... */
  sub<T = Record<string, unknown>>(
    id: string,
    sub: string,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    if (typeof id !== "string" || id === "")
      throw new Error("a market id is required");
    if (typeof sub !== "string" || !/^[a-z0-9-]+$/i.test(sub)) {
      throw new Error(`invalid market sub-resource: ${String(sub)}`);
    }
    return this.entity<T>(`${encodeURIComponent(id)}/${sub}`, options);
  }

  /** `GET /markets/participants/{wallet}/{sub}`. */
  participant<T = Record<string, unknown>>(
    wallet: string,
    sub: string,
    options?: NamespaceRequestOptions,
  ): Promise<V1Success<T>> {
    if (typeof wallet !== "string" || wallet === "")
      throw new Error("a wallet is required");
    if (typeof sub !== "string" || !/^[a-z0-9-]+$/i.test(sub)) {
      throw new Error(`invalid participant sub-resource: ${String(sub)}`);
    }
    return this.entity<T>(
      `participants/${encodeURIComponent(wallet)}/${sub}`,
      options,
    );
  }
}
