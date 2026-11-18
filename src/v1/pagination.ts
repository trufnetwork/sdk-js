/**
 * One cursor walker for every v1 list.
 *
 * The v1 contract is explicit: the cursor is opaque, route-scoped, exclusive,
 * and `null` on the last page. This walker copies `meta_data.cursor` verbatim,
 * never parses it, never converts it between routes, and stops on `null` (or an
 * empty page). It also refuses to loop if a server ever repeats a cursor.
 */

import type { V1Success } from "./types";

/**
 * Fetches one page. `cursor` is `null` for the first page and copied verbatim
 * afterwards. `D` is the page's `data`: the rows themselves on most lists, or
 * an object that holds them on the lists that keep the v0 shape.
 */
export type PageFetcher<T, D = T[]> = (
  cursor: string | null,
  signal?: AbortSignal,
) => Promise<V1Success<D>>;

/**
 * Picks the rows out of a page whose `data` is an object. Most v1 lists return
 * the rows as `data`, but a few keep the v0 object as `data` and put the rows
 * in one of its fields (for example `events` on `markets/{id}/activity`).
 */
export type PageRows<T, D> = (data: D) => readonly T[];

/** Options for {@link walkCursor} and {@link collectCursor}. */
export interface WalkCursorOptions {
  /** Stop after this many pages. Defaults to no limit. */
  maxPages?: number;
  /** Abort a walk in progress. */
  signal?: AbortSignal;
}

/** The `rows` option: where the rows are when `data` is an object. */
export interface PageRowsOption<T, D> {
  /** Not needed when `data` is the rows. */
  rows?: PageRows<T, D>;
}

/**
 * The rows of one page: `rows(data)` when given, else `data` itself when it is
 * an array.
 *
 * @throws If `data` is an object and no `rows` was given, or `rows` does not
 * return an array.
 */
export function pageRows<T, D>(data: D, rows?: PageRows<T, D>): readonly T[] {
  if (rows !== undefined) {
    const picked = rows(data);
    if (!Array.isArray(picked)) {
      throw new Error("rows must return the page's array of rows");
    }
    return picked;
  }
  if (Array.isArray(data)) return data as readonly T[];
  const fields =
    data !== null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};
  const keys = Object.keys(fields);
  const listKey = keys.find((key) => Array.isArray(fields[key]));
  throw new Error(
    `this list's data is an object (keys: ${keys.join(", ")}), not its rows; pass rows to pick them out` +
      (listKey === undefined ? "" : `, for example (data) => data.${listKey}`),
  );
}

/**
 * Yield each page in order. Stops when `meta_data.cursor` is `null`, when a page
 * is empty, or when `maxPages` is reached.
 *
 * @throws If the server repeats a cursor, which would otherwise loop forever.
 */
export async function* walkCursor<T, D = T[]>(
  fetchPage: PageFetcher<T, D>,
  options: WalkCursorOptions & PageRowsOption<T, D> = {},
): AsyncGenerator<V1Success<D>, void, void> {
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  if (!(maxPages > 0)) {
    throw new Error("maxPages must be positive");
  }
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const page = await fetchPage(cursor, options.signal);
    pages += 1;
    yield page;

    const next = page.meta_data.cursor;
    // `null` is the documented last page; an undefined cursor is treated the same.
    if (next === null || next === undefined) return;
    // A short (empty) page carries no more rows even if a cursor was sent. An
    // object page without `rows` cannot be counted, so only its cursor ends it.
    if (options.rows !== undefined || Array.isArray(page.data)) {
      if (pageRows(page.data, options.rows).length === 0) return;
    }
    if (seen.has(next)) {
      throw new Error(
        `cursor walker detected a repeated cursor; refusing to loop (route page ${pages})`,
      );
    }
    if (pages >= maxPages) return;
    seen.add(next);
    cursor = next;
  }
}

/**
 * Walk every page and return the concatenated rows. A list whose `data` is an
 * object needs `rows` to say where its rows are.
 */
export async function collectCursor<T>(
  fetchPage: PageFetcher<T>,
  options?: WalkCursorOptions,
): Promise<T[]>;
export async function collectCursor<T, D>(
  fetchPage: PageFetcher<T, D>,
  options: WalkCursorOptions & { rows: PageRows<T, D> },
): Promise<T[]>;
export async function collectCursor<T, D>(
  fetchPage: PageFetcher<T, D>,
  options?: WalkCursorOptions & PageRowsOption<T, D>,
): Promise<T[]> {
  const items: T[] = [];
  for await (const page of walkCursor(fetchPage, options)) {
    items.push(...pageRows(page.data, options?.rows));
  }
  return items;
}
