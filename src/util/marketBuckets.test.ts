/**
 * Tests for the SDK-side glue around the forecast algorithm.
 *
 * The algorithm itself is covered by forecast.test.ts / forecastDepth.test.ts.
 * What is tested here is only what the SDK adds: deriving bucket bounds from
 * decoded market data, and assembling a market's order books into a forecast.
 *
 * Ported from sdk-py's tests/test_market_buckets.py, with one improvement: the
 * bucket bounds are read out of REAL ABI-encoded query components rather than a
 * stubbed decoder, so the encode -> decode -> bounds path is exercised end to
 * end.
 */

import { describe, it, expect } from "vitest";
import { OrderbookAction } from "../contracts-api/orderbookAction";
import type { MarketInfo, OrderBookEntry } from "../types/orderbook";
import { BookLevel, BucketDepth, forecastFromDepth } from "./forecast";
import { bucketBoundsFromMarketData, requireQueryTime } from "./marketBuckets";
import {
  decodeMarketData,
  encodeActionArgs,
  encodeQueryComponents,
  encodeRangeActionArgs,
} from "./orderbookHelpers";
import { encodeActionArgs as encodeKwilArgs } from "./AttestationEncoding";
import { Utils } from "@trufnetwork/kwil-js";

describe("bucketBoundsFromMarketData", () => {
  it("reads a below market as the open bottom bucket", () => {
    expect(
      bucketBoundsFromMarketData({ type: "below", thresholds: ["4.04"] })
    ).toEqual({ lower: null, upper: 4.04 });
  });

  it("reads an above market as the open top bucket", () => {
    expect(
      bucketBoundsFromMarketData({ type: "above", thresholds: ["4.92"] })
    ).toEqual({ lower: 4.92, upper: null });
  });

  it("reads a between market as an interior bucket", () => {
    expect(
      bucketBoundsFromMarketData({ type: "between", thresholds: ["4.33", "4.62"] })
    ).toEqual({ lower: 4.33, upper: 4.62 });
  });

  it("reads an equals market as target plus or minus tolerance", () => {
    // Its thresholds are (target, tolerance), NOT (lower, upper). Reading them
    // positionally the way `between` is read would yield the bucket
    // (5.25, 0.10): inverted, and silently wrong rather than loud.
    const { lower, upper } = bucketBoundsFromMarketData({
      type: "equals",
      thresholds: ["5.25", "0.10"],
    });
    expect(lower).toBeCloseTo(5.15, 10);
    expect(upper).toBeCloseTo(5.35, 10);
    expect(lower!).toBeLessThan(upper!);
  });

  it("rejects a market type that cannot describe a bucket", () => {
    expect(() =>
      bucketBoundsFromMarketData({ type: "unknown", thresholds: [] })
    ).toThrow(/cannot derive bucket bounds/);
  });

  it("rejects missing thresholds", () => {
    expect(() =>
      bucketBoundsFromMarketData({ type: "between", thresholds: ["4.33"] })
    ).toThrow(/threshold/);
  });

  it("rejects a non-finite threshold", () => {
    // Number("Infinity") is a value, not an error; left alone it surfaces as a
    // NaN forecast rather than as this market being unreadable.
    for (const threshold of ["NaN", "Infinity", "-Infinity", "abc"]) {
      expect(() =>
        bucketBoundsFromMarketData({ type: "below", thresholds: [threshold] })
      ).toThrow(/not a number/);
    }
  });

  it("rejects an inverted or empty between bucket", () => {
    // Bounds are half-open [lower, upper): equal bounds are empty and inverted
    // ones can never hold an outcome.
    for (const thresholds of [
      ["4.62", "4.33"],
      ["4.33", "4.33"],
    ]) {
      expect(() =>
        bucketBoundsFromMarketData({ type: "between", thresholds })
      ).toThrow(/lower < upper/);
    }
  });

  it("rejects a non-positive equals tolerance", () => {
    for (const tolerance of ["0", "-0.10"]) {
      expect(() =>
        bucketBoundsFromMarketData({
          type: "equals",
          thresholds: ["5.25", tolerance],
        })
      ).toThrow(/positive tolerance/);
    }
  });

  it("rejects equals bounds that collapse or overflow", () => {
    // A positive tolerance is not enough. Absorbed by a large target it leaves
    // both edges on the same value, and near the float limits the sum
    // overflows; either way the bucket cannot hold an outcome.
    expect(1e300 - 1e-300).toBe(1e300 + 1e-300); // the collapse, demonstrated
    expect(() =>
      bucketBoundsFromMarketData({
        type: "equals",
        thresholds: ["1e300", "1e-300"],
      })
    ).toThrow(/usable bucket/);

    expect(() =>
      bucketBoundsFromMarketData({
        type: "equals",
        thresholds: ["1.7e308", "1.7e308"],
      })
    ).toThrow(/usable bucket/);
  });
});

describe("decodeMarketData query time", () => {
  const DP = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
  const SID = "stmsft00000000000000000000000000";

  it("keeps an explicit ABI NULL frozenAt as null", () => {
    // Every well-formed market on chain carries NULL there, meaning "latest".
    const market = decodeMarketData(
      encodeQueryComponents(
        DP,
        SID,
        "price_below_threshold",
        encodeActionArgs(DP, SID, 1700000000, "4.04", 0)
      )
    );
    expect(market.timestamp).toBe(1700000000);
    expect(market.frozenAt).toBeNull();
  });

  it("leaves the timestamp unread when the argument list is truncated", () => {
    // A missing final INT8 would otherwise decode to null, which is
    // indistinguishable from the explicit NULL above — so a malformed market
    // would match a healthy one on that component of its identity. Dropping the
    // timestamp instead routes it to requireQueryTime, which refuses it.
    const truncated = encodeKwilArgs([DP, SID, 1700000000, "4.04"], {
      3: Utils.DataType.Numeric(36, 18),
    });
    const market = decodeMarketData(
      encodeQueryComponents(DP, SID, "price_below_threshold", truncated)
    );

    expect(market.type).toBe("below");
    expect(market.thresholds).toHaveLength(1);
    expect(market.timestamp).toBeNull();
    expect(() => requireQueryTime(101, market)).toThrow(
      /no readable query timestamp/
    );
  });
});

describe("requireQueryTime", () => {
  it("rejects a market whose query timestamp could not be read", () => {
    // The identity stringifies null as "null", so two malformed markets would
    // collide there and match each other. Refusing them is the point.
    expect(() => requireQueryTime(101, { type: "below", timestamp: null })).toThrow(
      /no readable query timestamp/
    );
  });

  it("accepts a readable timestamp", () => {
    expect(() =>
      requireQueryTime(101, { type: "below", timestamp: 1700000000 })
    ).not.toThrow();
  });

  it("leaves an unknown action type alone", () => {
    // Its layout is unknown, so argument 2 need not be a timestamp at all; the
    // bounds derivation rejects it with a better message.
    expect(() =>
      requireQueryTime(101, { type: "unknown", timestamp: null })
    ).not.toThrow();
  });
});

// --- client assembly ---------------------------------------------------------

const DATA_PROVIDER = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
const STREAM_ID = "stmsft00000000000000000000000000";
const TIMESTAMP = 1700000000;

/** Big enough that even a 1c level clears DEPTH_MIN_SIDE_NOTIONAL_USD. */
const SIZE = 1000;

/** frozenAt 0 encodes as NULL, which is how "latest" is expressed on chain. */
const LATEST = 0;

function belowComponents(
  threshold: string,
  streamId = STREAM_ID,
  timestamp = TIMESTAMP,
  frozenAt = LATEST
): Uint8Array {
  return encodeQueryComponents(
    DATA_PROVIDER,
    streamId,
    "price_below_threshold",
    encodeActionArgs(DATA_PROVIDER, streamId, timestamp, threshold, frozenAt)
  );
}

function aboveComponents(
  threshold: string,
  streamId = STREAM_ID,
  timestamp = TIMESTAMP,
  frozenAt = LATEST
): Uint8Array {
  return encodeQueryComponents(
    DATA_PROVIDER,
    streamId,
    "price_above_threshold",
    encodeActionArgs(DATA_PROVIDER, streamId, timestamp, threshold, frozenAt)
  );
}

function betweenComponents(
  min: string,
  max: string,
  streamId = STREAM_ID,
  timestamp = TIMESTAMP,
  frozenAt = LATEST
): Uint8Array {
  return encodeQueryComponents(
    DATA_PROVIDER,
    streamId,
    "value_in_range",
    encodeRangeActionArgs(
      DATA_PROVIDER,
      streamId,
      timestamp,
      min,
      max,
      frozenAt
    )
  );
}

interface FakeMarket {
  components: Uint8Array;
  /** Collateral namespace; part of the market's identity. */
  bridge?: string;
  bounds: { lower: number | null; upper: number | null };
  yesBid: number | null;
  yesAsk: number | null;
}

/**
 * The live mainnet MSFT book, as five separate markets. Bounds are carried in
 * each bucket's own query_components, exactly as on chain. Quotes are
 * (yesBid, yesAsk) in cents; null means nothing resting on that side.
 */
const MSFT_MARKETS: Record<number, FakeMarket> = {
  101: {
    components: belowComponents("4.04"),
    bounds: { lower: null, upper: 4.04 },
    yesBid: 1,
    yesAsk: null,
  },
  102: {
    components: betweenComponents("4.04", "4.33"),
    bounds: { lower: 4.04, upper: 4.33 },
    yesBid: 16,
    yesAsk: 28,
  },
  103: {
    components: betweenComponents("4.33", "4.62"),
    bounds: { lower: 4.33, upper: 4.62 },
    yesBid: 44,
    yesAsk: 56,
  },
  104: {
    components: betweenComponents("4.62", "4.92"),
    bounds: { lower: 4.62, upper: 4.92 },
    yesBid: 9,
    yesAsk: 21,
  },
  105: {
    components: aboveComponents("4.92"),
    bounds: { lower: 4.92, upper: null },
    yesBid: 1,
    yesAsk: null,
  },
};

const ALL_QUERY_IDS = Object.keys(MSFT_MARKETS).map(Number);

/**
 * A second, independently valid bucket set, on a different stream. Each set
 * forecasts fine alone; the two together describe unrelated events.
 */
const OTHER_STREAM_ID = "stother0000000000000000000000000";
const OTHER_MARKETS: Record<number, FakeMarket> = {
  201: {
    components: belowComponents("4.04", OTHER_STREAM_ID),
    bounds: { lower: null, upper: 4.04 },
    yesBid: 1,
    yesAsk: null,
  },
  202: {
    components: betweenComponents("4.04", "4.33", OTHER_STREAM_ID),
    bounds: { lower: 4.04, upper: 4.33 },
    yesBid: 16,
    yesAsk: 28,
  },
  203: {
    components: aboveComponents("4.33", OTHER_STREAM_ID),
    bounds: { lower: 4.33, upper: null },
    yesBid: 44,
    yesAsk: 56,
  },
};

/**
 * A third set that settle_time alone cannot tell apart: same provider, same
 * stream, same settlement, but observing the stream a day later. Only the
 * query timestamp separates it from MSFT_MARKETS.
 */
const LATER_TIMESTAMP = TIMESTAMP + 86400;
const LATER_MARKETS: Record<number, FakeMarket> = {
  301: {
    components: belowComponents("4.04", STREAM_ID, LATER_TIMESTAMP),
    bounds: { lower: null, upper: 4.04 },
    yesBid: 1,
    yesAsk: null,
  },
  302: {
    components: betweenComponents("4.04", "4.33", STREAM_ID, LATER_TIMESTAMP),
    bounds: { lower: 4.04, upper: 4.33 },
    yesBid: 16,
    yesAsk: 28,
  },
  303: {
    components: aboveComponents("4.33", STREAM_ID, LATER_TIMESTAMP),
    bounds: { lower: 4.33, upper: null },
    yesBid: 44,
    yesAsk: 56,
  },
};

/**
 * A fourth set identical to MSFT_MARKETS in every field but `frozenAt`: the
 * same question asked of data pinned to a block rather than of latest data.
 * That is a different query, and only frozenAt says so.
 */
const PINNED_BLOCK = 987654;
const PINNED_MARKETS: Record<number, FakeMarket> = {
  401: {
    components: belowComponents("4.04", STREAM_ID, TIMESTAMP, PINNED_BLOCK),
    bounds: { lower: null, upper: 4.04 },
    yesBid: 1,
    yesAsk: null,
  },
  402: {
    components: betweenComponents(
      "4.04",
      "4.33",
      STREAM_ID,
      TIMESTAMP,
      PINNED_BLOCK
    ),
    bounds: { lower: 4.04, upper: 4.33 },
    yesBid: 16,
    yesAsk: 28,
  },
  403: {
    components: aboveComponents("4.33", STREAM_ID, TIMESTAMP, PINNED_BLOCK),
    bounds: { lower: 4.33, upper: null },
    yesBid: 44,
    yesAsk: 56,
  },
};

function row(price: number): OrderBookEntry {
  return {
    walletAddress: new Uint8Array(20),
    price,
    amount: SIZE,
    lastUpdated: TIMESTAMP,
  };
}

/**
 * An OrderbookAction whose network calls are stubbed.
 *
 * Built with Object.create so no Kwil client is needed: this exercises the
 * assembly logic (bounds, sorting, layout checks) with no node.
 */
function fakeAction(options?: {
  markets?: Record<number, FakeMarket>;
  queryComponents?: boolean;
  noBooks?: Record<number, OrderBookEntry[]>;
}): OrderbookAction {
  const markets = options?.markets ?? MSFT_MARKETS;
  const withComponents = options?.queryComponents ?? true;
  const noBooks = options?.noBooks ?? {};

  const action = Object.create(OrderbookAction.prototype) as OrderbookAction;

  action.getMarketInfo = async (queryId: number) =>
    ({
      queryComponents: withComponents
        ? markets[queryId].components
        : new Uint8Array(0),
      settleTime: TIMESTAMP,
      bridge: markets[queryId].bridge ?? "eth_usdc",
    }) as MarketInfo;

  action.getOrderBook = async (queryId: number, outcome: boolean) => {
    if (!outcome) return noBooks[queryId] ?? [];
    const { yesBid, yesAsk } = markets[queryId];
    const rows: OrderBookEntry[] = [];
    // Bids carry a NEGATIVE price on the wire, asks a positive one.
    if (yesBid !== null) rows.push(row(-yesBid));
    if (yesAsk !== null) rows.push(row(yesAsk));
    return rows;
  };

  return action;
}

/** The same books, built directly, to compare the assembled path against. */
function depths(): BucketDepth[] {
  // Copy before sorting: ALL_QUERY_IDS is shared, and other tests assert on its
  // order.
  return [...ALL_QUERY_IDS].sort((a, b) => a - b).map((queryId) => {
    const { bounds, yesBid, yesAsk } = MSFT_MARKETS[queryId];
    const yesBids: BookLevel[] =
      yesBid !== null ? [{ price: yesBid, size: SIZE }] : [];
    const yesAsks: BookLevel[] =
      yesAsk !== null ? [{ price: yesAsk, size: SIZE }] : [];
    return { ...bounds, yesBids, yesAsks, queryId };
  });
}

describe("getMarketForecast", () => {
  it("matches a direct call to the algorithm", async () => {
    // Assembly must not change the answer: same books in, same number out.
    const assembled = (await fakeAction().getMarketForecast(ALL_QUERY_IDS))!;
    const direct = forecastFromDepth(depths())!;

    expect(assembled.value).toBeCloseTo(direct.value, 10);
    expect(assembled.p10).toBeCloseTo(direct.p10!, 10);
    expect(assembled.p90).toBeCloseTo(direct.p90!, 10);
    assembled.buckets.forEach((b, i) => {
      expect(b.probability).toBeCloseTo(direct.buckets[i].probability, 10);
    });
  });

  it("lands inside the leading bucket", async () => {
    // The live MSFT book: the tight 44-56 bucket leads, so the value belongs
    // inside it.
    const f = (await fakeAction().getMarketForecast(ALL_QUERY_IDS))!;
    const probs = f.buckets.map((b) => b.probability);
    expect(probs[2]).toBe(Math.max(...probs));
    expect(f.value).toBeGreaterThanOrEqual(4.33);
    expect(f.value).toBeLessThanOrEqual(4.62);
  });

  it("consolidates NO-side liquidity into the estimate", async () => {
    // A resting BUY NO at p is hittable by a BUY YES at 100-p, so NO depth is
    // executable YES depth. Adding a NO bid must therefore supply the missing
    // YES ask and stop the bucket reading as one-sided.
    const bare = (await fakeAction().getMarketForecast(ALL_QUERY_IDS))!;
    // A NO bid at 84 mirrors to a YES ask at 16 on the open bottom bucket.
    const withNo = (await fakeAction({
      noBooks: { 101: [row(-84)] },
    }).getMarketForecast(ALL_QUERY_IDS))!;

    expect(bare.buckets[0].oneSided).toBe(true);
    expect(withNo.buckets[0].oneSided).toBe(false);
    expect(withNo.buckets[0].confidence).toBeGreaterThan(
      bare.buckets[0].confidence
    );
  });

  it("accepts the query ids in any order", async () => {
    // Buckets are sorted by bound here, so callers need not track which
    // query_id is the bottom of the line.
    const ordered = (await fakeAction().getMarketForecast([
      101, 102, 103, 104, 105,
    ]))!;
    const shuffled = (await fakeAction().getMarketForecast([
      103, 105, 101, 104, 102,
    ]))!;

    expect(shuffled.value).toBeCloseTo(ordered.value, 10);
    expect(shuffled.buckets.map((b) => b.queryId)).toEqual([
      101, 102, 103, 104, 105,
    ]);
  });

  it("reports a gap in the bucket layout instead of hiding it", async () => {
    // A market missing an interior bucket still gets an estimate, but the caller
    // must be able to see that the line was not fully tiled.
    const f = await fakeAction().getMarketForecast([101, 102, 104, 105]);
    expect(f).not.toBeNull();
    expect(f!.warnings.some((w) => w.includes("gap"))).toBe(true);
  });

  it("warns when the line is not open ended", async () => {
    // Interior buckets only: nothing covers the tails, so the mass beyond them
    // is unrepresented and the caller should know.
    const f = (await fakeAction().getMarketForecast([102, 103, 104]))!;
    expect(f.warnings.some((w) => w.includes("not open below"))).toBe(true);
    expect(f.warnings.some((w) => w.includes("not open above"))).toBe(true);
  });

  it("rejects a single bucket", async () => {
    await expect(fakeAction().getMarketForecast([103])).rejects.toThrow(
      /at least 2/
    );
  });

  it("rejects duplicate query ids", async () => {
    // A repeated bucket would have its probability counted twice, quietly
    // reshaping the distribution rather than failing.
    await expect(
      fakeAction().getMarketForecast([101, 102, 103, 103])
    ).rejects.toThrow(/duplicate/);
  });

  it("rejects buckets belonging to two different markets", async () => {
    // Normalising across two events would divide one market's probabilities by
    // the other's total and return a confident number about nothing. Both sets
    // are individually valid, so nothing but the identity check catches this.
    const both = { ...MSFT_MARKETS, ...OTHER_MARKETS };
    await expect(
      fakeAction({ markets: both }).getMarketForecast(
        Object.keys(both).map(Number)
      )
    ).rejects.toThrow(/different event/);
  });

  it("rejects two markets that differ only in the time they observe", async () => {
    // The case settleTime alone cannot see: same provider, same stream, same
    // settlement, but a different point in the stream. Without timestamp in the
    // identity these two would merge silently.
    const both = { ...MSFT_MARKETS, ...LATER_MARKETS };
    await expect(
      fakeAction({ markets: both }).getMarketForecast(
        Object.keys(both).map(Number)
      )
    ).rejects.toThrow(/different event/);
  });

  it("rejects two markets that differ only in the block they freeze", async () => {
    // frozenAt is the other query field settleTime cannot see: the same
    // question asked of pinned data and of latest data is two different
    // queries.
    const both = { ...MSFT_MARKETS, ...PINNED_MARKETS };
    await expect(
      fakeAction({ markets: both }).getMarketForecast(
        Object.keys(both).map(Number)
      )
    ).rejects.toThrow(/different event/);
  });

  it("rejects two markets that differ only in their bridge", async () => {
    // The bridge is the one identity field outside the query components: it is
    // a createMarket argument, so an identical question can be collateralised
    // two ways. Those are separate markets with separate books.
    const bridged: Record<number, FakeMarket> = {};
    for (const [id, market] of Object.entries(MSFT_MARKETS)) {
      bridged[Number(id) + 500] = { ...market, bridge: "eth_truf" };
    }
    const both = { ...MSFT_MARKETS, ...bridged };
    await expect(
      fakeAction({ markets: both }).getMarketForecast(
        Object.keys(both).map(Number)
      )
    ).rejects.toThrow(/different event/);
  });

  it("still forecasts each of those sets on its own", async () => {
    // The identity check must reject the mixture without rejecting either half.
    expect(await fakeAction().getMarketForecast(ALL_QUERY_IDS)).not.toBeNull();
    expect(
      await fakeAction({ markets: OTHER_MARKETS }).getMarketForecast(
        Object.keys(OTHER_MARKETS).map(Number)
      )
    ).not.toBeNull();
  });

  it("rejects a market without query components", async () => {
    // Legacy markets carry no bounds, and guessing them would be worse than
    // failing.
    await expect(
      fakeAction({ queryComponents: false }).getMarketForecast([101, 102])
    ).rejects.toThrow(/query_components/);
  });

  it("yields no forecast for an unquoted market", async () => {
    const dead: Record<number, FakeMarket> = {};
    for (const [id, market] of Object.entries(MSFT_MARKETS)) {
      dead[Number(id)] = { ...market, yesBid: null, yesAsk: null };
    }
    expect(
      await fakeAction({ markets: dead }).getMarketForecast(ALL_QUERY_IDS)
    ).toBeNull();
  });
});
