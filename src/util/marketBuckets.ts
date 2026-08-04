/**
 * Bucket bounds from a decoded prediction market's query components.
 *
 * SDK-side glue, deliberately kept OUT of `forecast.ts`: that module is a
 * translation of the upstream algorithm in truflation/prediction-bots and must
 * stay comparable against it (and against the sdk-py mirror). Nothing here is
 * part of the forecast maths.
 */

import type { MarketData } from "./orderbookHelpers";

/** One bucket's half-open `[lower, upper)` bounds; `null` means open-ended. */
export interface BucketBounds {
  lower: number | null;
  upper: number | null;
}

/**
 * Turns one bucket market's decoded data into its `[lower, upper)` bounds.
 *
 * `null` means open-ended, which is how the outer two buckets of a market are
 * always struck. Bounds are half-open upstream, so a value landing exactly on a
 * boundary resolves the upper bucket only.
 *
 * @param marketData - The result of {@link decodeMarketData}.
 * @returns The bucket's bounds, either of which may be `null`.
 * @throws If the market type cannot describe a bucket, or the thresholds needed
 *   for that type are missing.
 *
 * @example
 * ```typescript
 * const info = await orderbook.getMarketInfo(queryId);
 * const bounds = bucketBoundsFromMarketData(decodeMarketData(info.queryComponents));
 * // { lower: 4.04, upper: 4.33 }
 * ```
 */
export function bucketBoundsFromMarketData(
  marketData: Pick<MarketData, "type" | "thresholds">
): BucketBounds {
  const marketType = marketData.type;
  const thresholds = marketData.thresholds ?? [];

  const threshold = (index: number): number => {
    if (thresholds.length <= index) {
      throw new Error(
        `a '${marketType}' market needs at least ${index + 1} threshold(s), ` +
          `got ${thresholds.length}`
      );
    }
    return Number(thresholds[index]);
  };

  switch (marketType) {
    case "below":
      return { lower: null, upper: threshold(0) };
    case "above":
      return { lower: threshold(0), upper: null };
    case "between":
      return { lower: threshold(0), upper: threshold(1) };
    case "equals": {
      // thresholds are (target, tolerance), NOT (lower, upper). Reading them
      // positionally the way `between` is read would give an inverted bucket and
      // be silently wrong rather than loud.
      const target = threshold(0);
      const tolerance = threshold(1);
      return { lower: target - tolerance, upper: target + tolerance };
    }
    default:
      throw new Error(
        `cannot derive bucket bounds from a '${marketType}' market`
      );
  }
}
