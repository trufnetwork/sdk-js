import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveBlockStamps, fetchBlockStampsFromIndexer } from "./blockStamps";

/**
 * resolveBlockStamps reads block timestamps from the node's block header first
 * (which never trails the tip) and only falls back to the indexer for blocks the
 * node has pruned. These tests pin that ordering, the dedup, and the treatment of
 * the 0 sentinel — the behavior that fixes the "newest transactions show no age"
 * bug (trufscan#186).
 */

type HeaderStamp = number | Error;

function mockKwil(headers: Record<number, HeaderStamp>): any {
  return {
    blockHeader: vi.fn(async (height: number) => {
      const v = headers[height];
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error(`block not found: ${height}`);
      return { status: 200, data: { stampMs: v } };
    }),
  };
}

function stubIndexer(byBlock: Record<number, number | null>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: Object.entries(byBlock).map(([h, s]) => ({
          block_height: Number(h),
          stamp_ms: s,
        })),
      }),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveBlockStamps", () => {
  it("reads every stamp from the node and never touches the indexer when the node has them", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const kwil = mockKwil({ 100: 1000, 200: 2000 });

    const map = await resolveBlockStamps(kwil, [100, 100, 200]); // duplicate 100

    expect(map.get(100)).toBe(1000);
    expect(map.get(200)).toBe(2000);
    expect(kwil.blockHeader).toHaveBeenCalledTimes(2); // deduped
    expect(fetchSpy).not.toHaveBeenCalled(); // no indexer round-trip
  });

  it("falls back to the indexer only for blocks the node no longer retains", async () => {
    stubIndexer({ 50: 500 });
    const kwil = mockKwil({ 100: 1000, 50: new Error("block not found") });

    const map = await resolveBlockStamps(kwil, [100, 50]);

    expect(map.get(100)).toBe(1000); // from node
    expect(map.get(50)).toBe(500); // from indexer fallback
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats a 0 / missing node stamp as unresolved and tries the indexer", async () => {
    stubIndexer({ 100: 4242 });
    const kwil = mockKwil({ 100: 0 });

    const map = await resolveBlockStamps(kwil, [100]);

    expect(map.get(100)).toBe(4242);
  });

  it("leaves a height absent when neither source resolves it", async () => {
    stubIndexer({}); // indexer returns nothing for the block
    const kwil = mockKwil({ 100: new Error("block not found") });

    const map = await resolveBlockStamps(kwil, [100]);

    expect(map.has(100)).toBe(false);
  });

  it("ignores empty and invalid heights and makes no calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const kwil = mockKwil({});

    const map = await resolveBlockStamps(kwil, [NaN, -1]);

    expect(map.size).toBe(0);
    expect(kwil.blockHeader).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchBlockStampsFromIndexer", () => {
  it("omits blocks with a null stamp and tolerates a null data array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          data: [
            { block_height: 10, stamp_ms: 111 },
            { block_height: 11, stamp_ms: null },
          ],
        }),
      }))
    );
    const map = await fetchBlockStampsFromIndexer([10, 11]);
    expect(map.get(10)).toBe(111);
    expect(map.has(11)).toBe(false);
  });

  it("returns an empty map on an indexer HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const map = await fetchBlockStampsFromIndexer([10]);
    expect(map.size).toBe(0);
  });
});
