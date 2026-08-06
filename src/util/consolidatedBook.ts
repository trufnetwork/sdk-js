/**
 * Folding a market's two outcome books into the one ladder a trader can hit.
 *
 * A binary market's YES and NO books are two views of one position, and the
 * matching engine treats them that way. A resting SELL NO at p burn-matches an
 * incoming SELL YES at 100-p, and a resting BUY NO at p mint-matches an
 * incoming BUY YES at 100-p. So, in the YES frame:
 *
 *     consolidated bids = yesBids + (100 - p for every NO ask)
 *     consolidated asks = yesAsks + (100 - p for every NO bid)
 *
 * The sides swap. A NO ask is a YES bid, because hitting it means both parties
 * sell and the pair burns. Verified on testnet (2026-08-03).
 *
 * Mint and burn both require the two prices to sum to EXACTLY 100: `match_mint`
 * and `match_burn` in the node's 032-order-book-actions.sql return early
 * otherwise, and select the resting order with `price =` rather than a range.
 * Only a direct same-outcome match crosses prices. That is why every level here
 * carries its native and inverse volume separately instead of only the sum: one
 * order sweeps every native level past its limit but exactly ONE inverse level,
 * so anything quoting a fill needs the split to get the answer right.
 */

import type {
  ConsolidatedLevel,
  DepthLevel,
  FullDepthLevel,
} from "../types/orderbook";

/** One resting level: price in cents (positive, 1-99), size in shares. */
export interface BookLevel {
  /** Price in cents, positive, 1-99. */
  price: number;
  /** Size in shares. */
  size: number;
}

/** Which way a consolidated side sorts: bids best-highest, asks best-lowest. */
export type BookSide = "bid" | "ask";

/** A YES price and its NO price always sum to this. */
const COMPLEMENT = 100;

/** Kill float drift from the complement of a fractional price. */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** The price in the opposite outcome's frame that this price is hittable at. */
export function inversePrice(price: number): number {
  return round4(COMPLEMENT - price);
}

/**
 * One side of a consolidated ladder: this outcome's own levels plus the
 * opposite outcome's levels inverted into this frame.
 *
 * Pass the opposite side of the opposite book. Consolidated bids take the
 * opposite outcome's asks; consolidated asks take its bids.
 *
 * Levels that land on the same price merge into one entry that keeps the
 * native/inverse split. Zero and negative sizes are dropped.
 */
export function consolidateSide(
  native: readonly BookLevel[],
  opposite: readonly BookLevel[],
  side: BookSide
): ConsolidatedLevel[] {
  const byPrice = new Map<number, ConsolidatedLevel>();

  const add = (price: number, size: number, source: "native" | "inverse") => {
    if (!(size > 0)) return;
    let level = byPrice.get(price);
    if (!level) {
      level = { price, total: 0, native: 0, inverse: 0 };
      byPrice.set(price, level);
    }
    level[source] += size;
    level.total += size;
  };

  for (const level of native) add(level.price, level.size, "native");
  for (const level of opposite) {
    add(inversePrice(level.price), level.size, "inverse");
  }

  const levels = [...byPrice.values()];
  levels.sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
  return levels;
}

/**
 * Separates a whole-market depth read into the ladder for the requested outcome
 * and the ladder for the other one.
 *
 * The outcome tag is the only thing that distinguishes the two here: prices stay
 * in each outcome's own frame, and inverting the opposite side into this frame is
 * `consolidateSide`'s job.
 */
export function splitFullDepth(
  depth: readonly FullDepthLevel[],
  outcome: boolean
): { native: DepthLevel[]; opposite: DepthLevel[] } {
  const native: DepthLevel[] = [];
  const opposite: DepthLevel[] = [];

  for (const level of depth) {
    const target = level.outcome === outcome ? native : opposite;
    target.push({
      price: level.price,
      buyVolume: level.buyVolume,
      sellVolume: level.sellVolume,
    });
  }

  return { native, opposite };
}

/** The buy orders in a depth ladder, as levels. */
export function depthBids(depth: readonly DepthLevel[]): BookLevel[] {
  const levels: BookLevel[] = [];
  for (const level of depth) {
    if (level.buyVolume > 0) {
      levels.push({ price: level.price, size: level.buyVolume });
    }
  }
  return levels;
}

/** The sell orders in a depth ladder, as levels. */
export function depthAsks(depth: readonly DepthLevel[]): BookLevel[] {
  const levels: BookLevel[] = [];
  for (const level of depth) {
    if (level.sellVolume > 0) {
      levels.push({ price: level.price, size: level.sellVolume });
    }
  }
  return levels;
}
