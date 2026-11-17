import { describe, expect, it } from "vitest";
import { collectCursor, walkCursor } from "./pagination";
import type { V1Success } from "./types";

/** Tests for the single cursor walker shared by every v1 list. */

function page<T>(data: T[], cursor: string | null): V1Success<T[]> {
  return { ok: true, data, meta_data: { cursor, data_version: "1" } };
}

describe("walkCursor", () => {
  it("copies each cursor verbatim and stops on a null cursor", async () => {
    const seen: (string | null)[] = [];
    const pages = [page([1, 2], "c1"), page([3], "c2"), page([4], null)];
    const fetchPage = async (
      cursor: string | null,
    ): Promise<V1Success<number[]>> => {
      seen.push(cursor);
      const next = pages[seen.length - 1];
      if (next === undefined) throw new Error("unexpected extra page");
      return next;
    };

    const collected: number[] = [];
    for await (const current of walkCursor(fetchPage))
      collected.push(...current.data);

    expect(collected).toEqual([1, 2, 3, 4]);
    expect(seen).toEqual([null, "c1", "c2"]);
  });

  it("passes an opaque cursor through untouched", async () => {
    const opaque = "eyJhIjoxfQ==+%2F weird";
    const seen: (string | null)[] = [];
    const fetchPage = async (
      cursor: string | null,
    ): Promise<V1Success<number[]>> => {
      seen.push(cursor);
      return cursor === null ? page([1], opaque) : page([2], null);
    };

    await collectCursor(fetchPage);

    expect(seen).toEqual([null, opaque]);
  });

  it("stops on an empty page even when a cursor was sent", async () => {
    let calls = 0;
    const fetchPage = async (): Promise<V1Success<number[]>> => {
      calls += 1;
      return page([], "more");
    };

    expect(await collectCursor(fetchPage)).toEqual([]);
    expect(calls).toBe(1);
  });

  it("stops after maxPages", async () => {
    let calls = 0;
    const fetchPage = async (): Promise<V1Success<number[]>> => {
      calls += 1;
      return page([calls], `cursor-${calls}`);
    };

    const collected: number[] = [];
    for await (const current of walkCursor(fetchPage, { maxPages: 2 })) {
      collected.push(...current.data);
    }

    expect(collected).toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it("refuses to loop on a repeated cursor", async () => {
    const fetchPage = async (): Promise<V1Success<number[]>> =>
      page([1], "same");

    await expect(collectCursor(fetchPage)).rejects.toThrow(/repeated cursor/);
  });

  it("rejects a non-positive maxPages", async () => {
    const fetchPage = async (): Promise<V1Success<number[]>> => page([], null);
    await expect(collectCursor(fetchPage, { maxPages: 0 })).rejects.toThrow(
      /maxPages/,
    );
  });

  it("forwards the abort signal to the page fetcher", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const fetchPage = async (
      _cursor: string | null,
      signal?: AbortSignal,
    ): Promise<V1Success<number[]>> => {
      received = signal;
      return page([], null);
    };

    await collectCursor(fetchPage, { signal: controller.signal });

    expect(received).toBe(controller.signal);
  });
});
