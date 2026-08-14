/**
 * Quoting a fill against a consolidated order book.
 *
 * A consolidated ladder is not sweepable. `match_direct` crosses through the
 * order's limit, but `match_mint` and `match_burn` only fire when the two prices
 * sum to exactly 100. So an order at limit P fills every native level past P
 * plus exactly one inverse level, the one at P.
 *
 * One consequence is worth knowing before reading a quote: fillable size does
 * not grow monotonically with the limit price. Raising the limit can lose the
 * inverse level the fill was counting on, so the model evaluates every price
 * rather than walking the ladder.
 *
 * The estimate assumes the order reaches the front of the queue at its price.
 * Matching is FIFO within a level, so an older order resting at the same price
 * takes the counterparty first and the real fill comes up short.
 *
 * Prices compare by equality here, which is safe for the levels
 * `consolidateSide` produces: a whole-cent price survives a double exactly, and
 * so does its complement, since 100 - p is exact for integral p.
 */

import type { ConsolidatedLevel } from "../types/orderbook";

/** How one leg of a fill reaches the chain. */
export type ConsolidatedFillPath = "direct" | "mint" | "burn";

/** One leg of a quoted fill. */
export interface ConsolidatedFill {
  /** The leg's price in cents */
  price: number;
  /** How much fills on this leg */
  shares: number;
  /** How the leg reaches the chain */
  path: ConsolidatedFillPath;
}

/** What a buy of a given size can expect. */
export interface ConsolidatedBuyQuote {
  /** The limit price in cents to submit, chosen by the model */
  limitPrice: number | null;
  /** How much fills at `limitPrice` */
  filledShares: number;
  /**
   * The most one order can fill at any price. Always less than the ladder's
   * total whenever inverse volume rests at more than one price.
   */
  availableShares: number;
  /** Dollars paid, native legs at their own price and the inverse leg at the limit */
  estimatedTotalCost: number;
  /** Blended price in cents across every leg, null when nothing fills */
  averagePrice: number | null;
  /** Whether the whole requested size fills */
  isFullyFilled: boolean;
  /** How the fill breaks down, in the order the engine executes it */
  fills: ConsolidatedFill[];
}

/** What a sell of a given size can expect. */
export interface ConsolidatedSellQuote {
  /** The limit price in cents to submit, chosen by the model */
  limitPrice: number | null;
  /** How much fills at `limitPrice` */
  filledShares: number;
  /** The most one order can fill at any price */
  availableShares: number;
  /** Dollars received. Every share pays the submitted limit. */
  estimatedProceeds: number;
  /** Blended price, which for a sell is always the submitted limit */
  averagePrice: number | null;
  /** Whether the whole requested size fills */
  isFullyFilled: boolean;
  /** How the fill breaks down, in the order the engine executes it */
  fills: ConsolidatedFill[];
}

/**
 * Whether a price is one an order can actually carry: a whole cent from 1
 * through 99.
 *
 * The node declares `$price` as INT and errors outside that range, so anything
 * else is a limit `place_buy_order` and `place_sell_order` will reject. A quote
 * at such a price would describe an order that never reaches the book.
 */
export function isSubmittablePrice(price: number): boolean {
  return Number.isInteger(price) && price >= 1 && price <= 99;
}

/**
 * Drops the levels the engine cannot trade at, and sorts what is left, so no
 * level that could never be submitted gets picked as the limit.
 */
function tradableLevels(
  levels: readonly ConsolidatedLevel[],
  side: "bid" | "ask"
): ConsolidatedLevel[] {
  return levels
    .filter((level) => isSubmittablePrice(level.price))
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
}

/**
 * Shares filled and cents paid by a buy of `shares` submitted at `limit`.
 *
 * `asks` must be sorted best (lowest) first.
 */
function simulateBuy(
  asks: readonly ConsolidatedLevel[],
  shares: number,
  limit: number
) {
  let remaining = shares;
  let filled = 0;
  let costCents = 0;
  const fills: ConsolidatedFill[] = [];

  for (const level of asks) {
    if (level.price > limit || remaining <= 0) break;

    const take = Math.min(level.native, remaining);
    if (take <= 0) continue;

    filled += take;
    costCents += take * level.price;
    remaining -= take;
    fills.push({ price: level.price, shares: take, path: "direct" });
  }

  if (remaining > 0) {
    const atLimit = asks.find((level) => level.price === limit);
    if (atLimit) {
      const take = Math.min(atLimit.inverse, remaining);
      if (take > 0) {
        filled += take;
        costCents += take * limit;
        remaining -= take;
        fills.push({ price: limit, shares: take, path: "mint" });
      }
    }
  }

  return { filled, costCents, fills };
}

/**
 * Shares filled by a sell of `shares` submitted at `limit`.
 *
 * `bids` must be sorted best (highest) first. Proceeds are uniform: a direct
 * match pays the seller the ask price and refunds the buyer the difference, and
 * a burn pays each side its own price, so every share pays `limit`.
 */
function simulateSell(
  bids: readonly ConsolidatedLevel[],
  shares: number,
  limit: number
) {
  let remaining = shares;
  let filled = 0;
  const fills: ConsolidatedFill[] = [];

  for (const level of bids) {
    if (level.price < limit || remaining <= 0) break;

    const take = Math.min(level.native, remaining);
    if (take <= 0) continue;

    filled += take;
    remaining -= take;
    fills.push({ price: limit, shares: take, path: "direct" });
  }

  if (remaining > 0) {
    const atLimit = bids.find((level) => level.price === limit);
    if (atLimit) {
      const take = Math.min(atLimit.inverse, remaining);
      if (take > 0) {
        filled += take;
        remaining -= take;
        fills.push({ price: limit, shares: take, path: "burn" });
      }
    }
  }

  return { filled, proceedsCents: filled * limit, fills };
}

/** The most any single buy can take out of this ladder. */
function buyableShares(asks: readonly ConsolidatedLevel[]): number {
  return asks.reduce(
    (most, level) =>
      Math.max(most, simulateBuy(asks, Infinity, level.price).filled),
    0
  );
}

/** The most any single sell can place into this ladder. */
function sellableShares(bids: readonly ConsolidatedLevel[]): number {
  return bids.reduce(
    (most, level) =>
      Math.max(most, simulateSell(bids, Infinity, level.price).filled),
    0
  );
}

/**
 * Quotes a buy at a limit the caller has already chosen.
 *
 * Pass the consolidated asks. Use this when the routing policy is the caller's:
 * `quoteConsolidatedBuy` picks the cheapest limit that fills the most, and a
 * caller wanting a price ceiling or the least market impact wants this instead.
 *
 * A limit that fails `isSubmittablePrice` quotes nothing, since no order can
 * carry it. `availableShares` still describes the ladder, so a zero fill beside
 * a non-zero `availableShares` says the limit was the problem, not the book.
 */
export function quoteConsolidatedBuyAtPrice(
  levels: readonly ConsolidatedLevel[],
  shares: number,
  limit: number
): ConsolidatedBuyQuote {
  const asks = tradableLevels(levels, "ask");

  if (!isSubmittablePrice(limit)) {
    return {
      limitPrice: null,
      filledShares: 0,
      availableShares: buyableShares(asks),
      estimatedTotalCost: 0,
      averagePrice: null,
      isFullyFilled: false,
      fills: [],
    };
  }

  const { filled, costCents, fills } = simulateBuy(asks, shares, limit);

  return {
    limitPrice: limit,
    filledShares: filled,
    availableShares: buyableShares(asks),
    estimatedTotalCost: costCents / 100,
    averagePrice: filled > 0 ? costCents / filled : null,
    isFullyFilled: shares > 0 && filled >= shares,
    fills,
  };
}

/**
 * Quotes a buy of `shares` against the consolidated asks, choosing the cheapest
 * limit that fills the most.
 */
export function quoteConsolidatedBuy(
  levels: readonly ConsolidatedLevel[],
  shares: number
): ConsolidatedBuyQuote {
  const asks = tradableLevels(levels, "ask");

  let best: {
    limit: number;
    filled: number;
    costCents: number;
    fills: ConsolidatedFill[];
  } | null = null;

  for (const candidate of asks) {
    const { filled, costCents, fills } = simulateBuy(
      asks,
      shares,
      candidate.price
    );

    if (!best || filled > best.filled) {
      best = { limit: candidate.price, filled, costCents, fills };
    }

    if (best.filled >= shares) break;
  }

  const availableShares = buyableShares(asks);

  if (!best) {
    return {
      limitPrice: null,
      filledShares: 0,
      availableShares,
      estimatedTotalCost: 0,
      averagePrice: null,
      isFullyFilled: false,
      fills: [],
    };
  }

  return {
    limitPrice: best.limit,
    filledShares: best.filled,
    availableShares,
    estimatedTotalCost: best.costCents / 100,
    averagePrice: best.filled > 0 ? best.costCents / best.filled : null,
    isFullyFilled: shares > 0 && best.filled >= shares,
    fills: best.fills,
  };
}

/**
 * Quotes a sell at a limit the caller has already chosen.
 *
 * Pass the consolidated bids. Needed when something downstream of the quote
 * moves the price, such as a self-trade guard raising it clear of the seller's
 * own resting buy order, and whenever the routing policy is the caller's rather
 * than the one `quoteConsolidatedSell` applies.
 *
 * A limit that fails `isSubmittablePrice` quotes nothing, since no order can
 * carry it.
 */
export function quoteConsolidatedSellAtPrice(
  levels: readonly ConsolidatedLevel[],
  shares: number,
  limit: number
): ConsolidatedSellQuote {
  const bids = tradableLevels(levels, "bid");

  if (!isSubmittablePrice(limit)) {
    return {
      limitPrice: null,
      filledShares: 0,
      availableShares: sellableShares(bids),
      estimatedProceeds: 0,
      averagePrice: null,
      isFullyFilled: false,
      fills: [],
    };
  }

  const { filled, proceedsCents, fills } = simulateSell(bids, shares, limit);

  return {
    limitPrice: limit,
    filledShares: filled,
    availableShares: sellableShares(bids),
    estimatedProceeds: proceedsCents / 100,
    averagePrice: filled > 0 ? limit : null,
    isFullyFilled: shares > 0 && filled >= shares,
    fills,
  };
}

/**
 * Quotes a sell of `shares` against the consolidated bids, choosing the highest
 * limit that fills the most.
 */
export function quoteConsolidatedSell(
  levels: readonly ConsolidatedLevel[],
  shares: number
): ConsolidatedSellQuote {
  const bids = tradableLevels(levels, "bid");

  let best: {
    limit: number;
    filled: number;
    proceedsCents: number;
    fills: ConsolidatedFill[];
  } | null = null;

  for (const candidate of bids) {
    const { filled, proceedsCents, fills } = simulateSell(
      bids,
      shares,
      candidate.price
    );

    if (!best || filled > best.filled) {
      best = { limit: candidate.price, filled, proceedsCents, fills };
    }

    if (best.filled >= shares) break;
  }

  const availableShares = sellableShares(bids);

  if (!best) {
    return {
      limitPrice: null,
      filledShares: 0,
      availableShares,
      estimatedProceeds: 0,
      averagePrice: null,
      isFullyFilled: false,
      fills: [],
    };
  }

  return {
    limitPrice: best.limit,
    filledShares: best.filled,
    availableShares,
    estimatedProceeds: best.proceedsCents / 100,
    averagePrice: best.filled > 0 ? best.limit : null,
    isFullyFilled: shares > 0 && best.filled >= shares,
    fills: best.fills,
  };
}
