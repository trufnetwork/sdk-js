/**
 * One cursor walker for every v1 list.
 *
 * The v1 contract is explicit: the cursor is opaque, route-scoped, exclusive,
 * and `null` on the last page. This walker copies `meta_data.cursor` verbatim,
 * never parses it, never converts it between routes, and stops on `null` (or an
 * empty page). It also refuses to loop if a server ever repeats a cursor.
 */

import type { V1Success } from "./types";

/** Fetches one page. `cursor` is `null` for the first page and copied verbatim afterwards. */
export type PageFetcher<T> = (
  cursor: string | null,
  signal?: AbortSignal,
) => Promise<V1Success<T[]>>;

/** Options for {@link walkCursor} and {@link collectCursor}. */
export interface WalkCursorOptions {
  /** Stop after this many pages. Defaults to no limit. */
  maxPages?: number;
  /** Abort a walk in progress. */
  signal?: AbortSignal;
}

/**
 * Yield each page in order. Stops when `meta_data.cursor` is `null`, when a page
 * is empty, or when `maxPages` is reached.
 *
 * @throws If the server repeats a cursor, which would otherwise loop forever.
 */
export async function* walkCursor<T>(
  fetchPage: PageFetcher<T>,
  options: WalkCursorOptions = {},
): AsyncGenerator<V1Success<T[]>, void, void> {
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
    // A short (empty) page carries no more rows even if a cursor was sent.
    if (page.data.length === 0) return;
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

/** Walk every page and return the concatenated items. */
export async function collectCursor<T>(
  fetchPage: PageFetcher<T>,
  options?: WalkCursorOptions,
): Promise<T[]> {
  const items: T[] = [];
  for await (const page of walkCursor(fetchPage, options)) {
    items.push(...page.data);
  }
  return items;
}
