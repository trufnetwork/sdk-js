/**
 * Live-network checks that the SDK reads real order books the right way round.
 *
 * Everything else in the forecast suite feeds the algorithm hand-written
 * numbers, which proves the maths but cannot prove the SDK is reading the CHAIN
 * correctly. If the node ever flipped the sign convention on bids, every one of
 * those tests would still pass while the forecast silently inverted. That is the
 * gap this file covers.
 *
 * Gated, because it needs the network and live markets carrying real orders:
 *
 *     TEST_MAINNET_ENDPOINT=https://gateway.mainnet.truf.network \
 *     TEST_MAINNET_CHAIN_ID=tn-v2.1 \
 *     npx vitest run tests/integration/marketForecast.test.ts
 *
 * All calls are view actions, so the signing wallet needs no funds and controls
 * nothing; a throwaway is generated.
 *
 * These assert SHAPES, not numbers. Live books move minute to minute, so pinning
 * an expected value would fail by tomorrow. Exact numbers belong in the unit
 * tests. A wrong FORMULA will pass here quite happily — this only proves the
 * plumbing between the SDK and the chain is connected the right way round.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { Wallet } from "ethers";
import { NodeTNClient } from "../../src/client/nodeClient";
import type { OrderbookAction } from "../../src/contracts-api/orderbookAction";
import type {
  BookLevel,
  BucketEstimate,
  MarketForecast,
} from "../../src/util/forecast";
import { bucketBoundsFromMarketData } from "../../src/util/marketBuckets";
import { decodeMarketData } from "../../src/util/orderbookHelpers";

// Discovery costs one call per open market, so it is bounded. Mainnet carried
// ~110 open markets when this was written; the cap is headroom, not a target.
const MAX_MARKETS_SCANNED = 500;

// Candidate groups to probe for quotes before giving up. A market can tile the
// line perfectly and still have nobody quoting it, which is not a code defect,
// so candidates are ranked by how much of the line is actually quoted rather
// than by bucket count alone -- most open markets carry no orders at all.
const MAX_GROUPS_PROBED = 25;

// Below this many quoted buckets the forecast rests on residuals more than on
// orders, which is not what this test is trying to exercise.
const MIN_QUOTED_BUCKETS = 2;

const endpoint = process.env.TEST_MAINNET_ENDPOINT;
const chainId = process.env.TEST_MAINNET_CHAIN_ID;
const configured = Boolean(endpoint && chainId);

interface Candidate {
  queryId: number;
  type: string;
  lower: number | null;
  upper: number | null;
}

/** One bucket open below, one open above, at least one in between. */
function tilesTheLine(members: Candidate[]): boolean {
  const types = members.map((m) => m.type);
  return (
    members.length >= 3 &&
    types.filter((t) => t === "below").length === 1 &&
    types.filter((t) => t === "above").length === 1
  );
}

/**
 * Every open market, grouped into candidate bucket sets.
 *
 * A market's buckets share a data stream and a settlement time, which is enough
 * to reassemble them from chain data alone — no local config needed.
 */
async function discoverGroups(
  orderbook: OrderbookAction
): Promise<Candidate[][]> {
  const groups = new Map<string, Candidate[]>();
  let offset = 0;
  let scanned = 0;

  while (scanned < MAX_MARKETS_SCANNED) {
    const page = await orderbook.listMarkets({
      settledFilter: false,
      limit: 100,
      offset,
    });
    if (!page.length) break;

    for (const market of page) {
      scanned += 1;
      // Outside the try on purpose: a transport or node failure is a real
      // problem and must fail the run, not quietly shrink the candidate set.
      const info = await orderbook.getMarketInfo(market.id);
      if (!info.queryComponents || info.queryComponents.length === 0) continue;

      let candidate: Candidate;
      let key: string;
      try {
        const marketData = decodeMarketData(info.queryComponents);
        const bounds = bucketBoundsFromMarketData(marketData);
        candidate = {
          queryId: market.id,
          type: marketData.type,
          ...bounds,
        };
        key = `${marketData.streamId}@${market.settleTime}`;
      } catch {
        // Legacy or non-bucket markets: not what this test is about.
        continue;
      }
      const existing = groups.get(key);
      if (existing) existing.push(candidate);
      else groups.set(key, [candidate]);
    }

    if (page.length < 100) break;
    offset += 100;
  }

  // Widest first: more buckets means more of the line actually quoted.
  return [...groups.values()]
    .filter(tilesTheLine)
    .sort((a, b) => b.length - a.length);
}

/**
 * The bucket where the implied CDF crosses 50%.
 *
 * NOT the most probable bucket: with probabilities [0.40, 0.35, 0.25] the leader
 * is the first, but the cumulative only reaches half way through the second, so
 * that is where the median belongs.
 */
function medianBucket(forecast: MarketForecast): BucketEstimate {
  let running = 0;
  for (const bucket of forecast.buckets) {
    running += bucket.probability;
    if (running >= 0.5) return bucket;
  }
  return forecast.buckets[forecast.buckets.length - 1];
}

describe.skipIf(!configured)(
  "Market Forecast Live Integration Tests",
  { timeout: 600000 },
  () => {
    let orderbook: OrderbookAction;
    let queryIds: number[] | null = null;
    let forecast: MarketForecast | null = null;
    let skipReason = "";

    beforeAll(async () => {
      // Read-only suite: a fresh random wallet is sufficient and avoids
      // committing a private key. Every action used here is a view action.
      const wallet = Wallet.createRandom();
      const client = new NodeTNClient({
        endpoint: endpoint!,
        signerInfo: { address: wallet.address, signer: wallet },
        chainId: chainId!,
        timeout: 30000,
      });
      orderbook = client.loadOrderbookAction();

      const candidates = await discoverGroups(orderbook);
      if (!candidates.length) {
        skipReason = "no open market on this network currently tiles the line";
        return;
      }

      // One cheap call per bucket to find where the orders are. Ranking on this
      // rather than on bucket count matters: most open markets tile the line
      // perfectly and carry no orders whatsoever.
      const ranked: { quoted: number; newest: number; ids: number[] }[] = [];
      for (const members of candidates.slice(0, MAX_GROUPS_PROBED)) {
        const ids = members.map((m) => m.queryId);
        let quoted = 0;
        for (const queryId of ids) {
          const best = await orderbook.getBestPrices(queryId, true);
          if (best.bestBid !== null || best.bestAsk !== null) quoted += 1;
        }
        if (quoted >= MIN_QUOTED_BUCKETS) {
          ranked.push({ quoted, newest: Math.max(...ids), ids });
        }
      }

      if (!ranked.length) {
        skipReason =
          `no market among ${Math.min(candidates.length, MAX_GROUPS_PROBED)} ` +
          `tiling candidates had ${MIN_QUOTED_BUCKETS}+ quoted buckets`;
        return;
      }

      // Most quoted first, then newest. Recency is only a tie-break: settled
      // markets are already excluded, and on mainnet the newest markets are
      // routinely the ones with no orders yet, so it is a poor primary signal.
      ranked.sort((a, b) => b.quoted - a.quoted || b.newest - a.newest);
      for (const { ids } of ranked) {
        const result = await orderbook.getMarketForecast(ids);
        if (result !== null) {
          queryIds = ids;
          forecast = result;
          return;
        }
      }
      skipReason = "quoted markets found, but none yielded a usable forecast";
    });

    /** Guards every test: an empty book is a fact about the day, not a defect. */
    function live(): { queryIds: number[]; forecast: MarketForecast } | null {
      if (forecast === null) {
        console.warn(`skipping: ${skipReason}`);
        return null;
      }
      return { queryIds: queryIds!, forecast };
    }

    test("a real market produces a forecast", () => {
      const it = live();
      if (!it) return;

      expect(it.queryIds.length).toBeGreaterThanOrEqual(3);
      expect(Number.isNaN(it.forecast.value)).toBe(false);
      expect(["rank", "discrete"]).toContain(it.forecast.method);
      expect(["interior", "tail", "unresolved"]).toContain(
        it.forecast.valueBasis
      );
    });

    test("the probabilities form a distribution", () => {
      const it = live();
      if (!it) return;

      const probabilities = it.forecast.buckets.map((b) => b.probability);
      expect(probabilities.every((p) => p >= 0 && p <= 1)).toBe(true);
      expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    });

    test("the value falls in the bucket where the CDF crosses half", () => {
      // The point estimate is the median, so it must land in the median bucket.
      // This is the assertion that would catch a bounds-derivation or ordering
      // mistake: get the buckets in the wrong order and the value lands in the
      // wrong one.
      const it = live();
      if (!it) return;
      if (it.forecast.valueBasis === "unresolved") {
        console.warn("skipping: median unresolvable from this market's strikes");
        return;
      }

      const bucket = medianBucket(it.forecast);
      if (bucket.lower !== null) {
        expect(it.forecast.value).toBeGreaterThanOrEqual(bucket.lower);
      }
      if (bucket.upper !== null) {
        expect(it.forecast.value).toBeLessThanOrEqual(bucket.upper);
      }
    });

    test("the band brackets the value", () => {
      const it = live();
      if (!it) return;
      if (it.forecast.p10 === null || it.forecast.p90 === null) {
        console.warn("skipping: band unresolvable from this market's strikes");
        return;
      }

      expect(it.forecast.p10).toBeLessThanOrEqual(it.forecast.value);
      expect(it.forecast.value).toBeLessThanOrEqual(it.forecast.p90);
      expect(it.forecast.marginOfError).toBeGreaterThan(0);
    });

    test("the buckets are ordered and tile the line", () => {
      // Assembly must hand the algorithm an ascending, gap-free ladder.
      const it = live();
      if (!it) return;

      const buckets = it.forecast.buckets;
      expect(buckets[0].lower).toBeNull();
      expect(buckets[buckets.length - 1].upper).toBeNull();
      for (let i = 0; i + 1 < buckets.length; i++) {
        expect(buckets[i].upper).toBe(buckets[i + 1].lower);
      }
    });

    test("the bid sign convention still holds", async () => {
      // The canary.
      //
      // getOrderBook marks bids with a NEGATIVE price; getBestPrices reports the
      // same bid as POSITIVE. Two independent node paths for one fact, so if
      // either convention ever changes they stop agreeing here — loudly —
      // instead of silently inverting every one-sided bucket in the forecast.
      const it = live();
      if (!it) return;

      // Reaches the private converter on purpose: re-deriving the ladders here
      // would only test this file's copy of the rule, and the rule is exactly
      // what is under suspicion. This also pins the Number() coercion — the node
      // sends `amount` as a NUMERIC, which arrives as a string.
      const ladders = orderbook as unknown as {
        orderBookLadders(
          queryId: number,
          outcome: boolean
        ): Promise<{ bids: BookLevel[]; asks: BookLevel[] }>;
      };

      let checked = 0;
      for (const queryId of it.queryIds) {
        for (const outcome of [true, false]) {
          const { bids, asks } = await ladders.orderBookLadders(
            queryId,
            outcome
          );
          const best = await orderbook.getBestPrices(queryId, outcome);

          for (const level of [...bids, ...asks]) {
            expect(typeof level.price).toBe("number");
            expect(typeof level.size).toBe("number");
            expect(level.price).toBeGreaterThan(0);
            expect(level.price).toBeLessThan(100);
            expect(level.size).toBeGreaterThan(0);
          }

          // Number() is load-bearing, not defensive tidying: get_best_prices
          // returns its prices as NUMERIC, so they arrive as STRINGS despite
          // BestPrices typing them `number | null`. Comparing them raw makes
          // this assertion fail on a book that is perfectly correct.
          if (bids.length && best.bestBid !== null) {
            expect(Math.max(...bids.map((l) => l.price))).toBe(
              Number(best.bestBid)
            );
            checked += 1;
          }
          if (asks.length && best.bestAsk !== null) {
            expect(Math.min(...asks.map((l) => l.price))).toBe(
              Number(best.bestAsk)
            );
            checked += 1;
          }
        }
      }

      if (!checked) {
        console.warn(
          "skipping: no resting orders to cross-check the sign convention against"
        );
      }
    });
  }
);
