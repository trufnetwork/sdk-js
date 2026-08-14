// Tests for quoting a fill against a consolidated ladder.
//
// What matters here is that the ladder is not sweepable: an order at limit P
// takes every native level past P but exactly ONE inverse level, the one at P.
// So fillable size is not monotonic in the limit, the ladder's total is not
// reachable by any single order, and a sell pays its limit on every share.

import { describe, expect, test } from "vitest";
import type { ConsolidatedLevel } from "../types/orderbook";
import {
  quoteConsolidatedBuy,
  quoteConsolidatedBuyAtPrice,
  quoteConsolidatedSell,
  quoteConsolidatedSellAtPrice,
} from "./consolidatedQuote";

/** Builds a level, filling in the total the ladder would carry. */
function level(
  price: number,
  native: number,
  inverse: number
): ConsolidatedLevel {
  return { price, native, inverse, total: native + inverse };
}

describe("quoteConsolidatedBuy", () => {
  // YES asks 100 @ 60, NO bids 200 @ 41 and 50 @ 45.
  const asks = [level(55, 0, 50), level(59, 0, 200), level(60, 100, 0)];

  test("fills at the one price where the inverse leg is reachable", () => {
    const quote = quoteConsolidatedBuy(asks, 100);

    expect(quote.limitPrice).toBe(59);
    expect(quote.filledShares).toBe(100);
    expect(quote.estimatedTotalCost).toBe(59);
  });

  test("reports the best fill one order can get, not the whole ladder", () => {
    const ladder = asks.reduce((sum, entry) => sum + entry.total, 0);
    expect(ladder).toBe(350);

    // Summing the ladder says 350. No single order can do better than 200.
    const quote = quoteConsolidatedBuy(asks, 350);

    expect(quote.availableShares).toBe(200);
    expect(quote.isFullyFilled).toBe(false);
  });

  test("does not gain fill by raising the limit past the inverse leg", () => {
    const twoLevels = [level(59, 0, 200), level(60, 100, 0)];

    // A limit of 60 reaches 100 native shares; a limit of 59 reaches 200
    // inverse ones. More fill sits at the lower price.
    expect(quoteConsolidatedBuy(twoLevels, 150).limitPrice).toBe(59);
    expect(quoteConsolidatedBuy(twoLevels, 150).filledShares).toBe(150);
    expect(quoteConsolidatedBuy(twoLevels, 250).filledShares).toBe(200);
    expect(quoteConsolidatedBuy(twoLevels, 250).limitPrice).toBe(59);
  });

  test("prices native legs at their own price and the inverse leg at the limit", () => {
    const quote = quoteConsolidatedBuy([level(20, 40, 0), level(30, 0, 60)], 100);

    expect(quote.limitPrice).toBe(30);
    expect(quote.estimatedTotalCost).toBe(26);
    expect(quote.fills).toEqual([
      { price: 20, shares: 40, path: "direct" },
      { price: 30, shares: 60, path: "mint" },
    ]);
  });

  test("averages the price actually paid across both legs", () => {
    const quote = quoteConsolidatedBuy([level(20, 40, 0), level(30, 0, 60)], 100);

    expect(quote.averagePrice).toBe(26);
  });
});

describe("quoteConsolidatedSell", () => {
  test("pays the submitted limit on every share, not each bid its own price", () => {
    const bids = [level(80, 50, 0), level(70, 50, 0)];

    // match_direct pays the seller at the ask price, so walking the ladder and
    // crediting 50 at 80 plus 50 at 70 overstates this by $5.
    const quote = quoteConsolidatedSell(bids, 100);

    expect(quote.limitPrice).toBe(70);
    expect(quote.filledShares).toBe(100);
    expect(quote.estimatedProceeds).toBe(70);
  });

  test("combines a direct leg and a burn leg at the submitted limit", () => {
    const quote = quoteConsolidatedSell([level(70, 30, 40), level(60, 100, 0)], 70);

    expect(quote.limitPrice).toBe(70);
    expect(quote.filledShares).toBe(70);
    expect(quote.estimatedProceeds).toBe(49);
    expect(quote.fills).toEqual([
      { price: 70, shares: 30, path: "direct" },
      { price: 70, shares: 40, path: "burn" },
    ]);
  });

  test("reaches the inverse leg only at the exact limit price", () => {
    const quote = quoteConsolidatedSell([level(65, 0, 80), level(60, 40, 0)], 80);

    expect(quote.limitPrice).toBe(65);
    expect(quote.estimatedProceeds).toBe(52);
    expect(quote.fills).toEqual([{ price: 65, shares: 80, path: "burn" }]);
  });
});

describe("price range guards", () => {
  test("ignores levels outside the tradable 1-99 range", () => {
    const quote = quoteConsolidatedBuy(
      [level(0, 500, 0), level(100, 500, 0), level(40, 60, 0)],
      60
    );

    expect(quote.limitPrice).toBe(40);
    expect(quote.availableShares).toBe(60);
  });
});

describe("caller-supplied limits", () => {
  test("quotes a sell at the limit the caller chose", () => {
    const quote = quoteConsolidatedSellAtPrice(
      [level(80, 50, 0), level(70, 50, 0)],
      100,
      80
    );

    // Only the 80 bid is reachable at a limit of 80, and it pays 80 a share.
    expect(quote.filledShares).toBe(50);
    expect(quote.estimatedProceeds).toBe(40);
    expect(quote.isFullyFilled).toBe(false);
  });

  test("quotes a buy at the limit the caller chose", () => {
    // quoteConsolidatedBuy would pick 59 for the larger fill. A caller willing
    // to pay up for the native side gets to say so.
    const quote = quoteConsolidatedBuyAtPrice(
      [level(59, 0, 200), level(60, 100, 0)],
      250,
      60
    );

    expect(quote.limitPrice).toBe(60);
    expect(quote.filledShares).toBe(100);
    expect(quote.estimatedTotalCost).toBe(60);
    expect(quote.isFullyFilled).toBe(false);
  });
});

describe("degenerate ladders", () => {
  test("an empty book quotes nothing", () => {
    const buy = quoteConsolidatedBuy([], 100);
    expect(buy.limitPrice).toBeNull();
    expect(buy.filledShares).toBe(0);
    expect(buy.availableShares).toBe(0);
    expect(buy.averagePrice).toBeNull();
    expect(buy.fills).toEqual([]);

    const sell = quoteConsolidatedSell([], 100);
    expect(sell.limitPrice).toBeNull();
    expect(sell.filledShares).toBe(0);
    expect(sell.fills).toEqual([]);
  });

  test("sorts an unordered ladder rather than trusting the input order", () => {
    // consolidateSide sorts, but a caller can hand-build a ladder and the model
    // must not quote a worse price off the input order.
    const asks = [level(60, 100, 0), level(20, 40, 0)];

    expect(quoteConsolidatedBuy(asks, 40).limitPrice).toBe(20);
    expect(asks[0].price).toBe(60);
  });
});

/**
 * A frozen snapshot of mainnet market 419, read 2026-08-12 through
 * `get_full_market_depth`.
 *
 *   YES bids  1c x4283, 3c x1428, 4c x1049
 *   YES asks 16c x320, 17c x324, 19c x289
 *   NO  bids 81c x53,  83c x51,  84c x29
 *   NO  asks 96c x33,  97c x57,  99c x56
 *
 * The NO orders fold into the YES frame at 100 - price, which lands each of
 * them on a price the YES book already quotes.
 */
describe("mainnet market 419", () => {
  const asks = [level(16, 320, 29), level(17, 324, 51), level(19, 289, 53)];
  const bids = [level(4, 1049, 33), level(3, 1428, 57), level(1, 4283, 56)];

  test("one buy cannot take more than the best single price allows", () => {
    expect(quoteConsolidatedBuy(asks, 99_999).availableShares).toBe(986);
  });

  test("a buy that fits inside native depth never reaches an inverse leg", () => {
    const quote = quoteConsolidatedBuy(asks, 700);

    expect(quote.limitPrice).toBe(19);
    expect(quote.estimatedTotalCost).toBeCloseTo(116.92, 6);
    expect(quote.fills.every((fill) => fill.path === "direct")).toBe(true);
  });

  test("a sell past the top bid pays its limit on every share", () => {
    const quote = quoteConsolidatedSell(bids, 2000);

    // 1049 rest at 4c, but the order only fills in full at a limit of 3c, and
    // every share then pays 3c. Walking the ladder would have quoted 70.49.
    expect(quote.limitPrice).toBe(3);
    expect(quote.estimatedProceeds).toBeCloseTo(60.0, 6);
  });
});
