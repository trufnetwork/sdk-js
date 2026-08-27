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
 * Throws when a market's query timestamp could not be read.
 *
 * Every binary action carries one at argument 2; only `frozenAt` is nullable. A
 * null timestamp stringifies to `"null"` in the market identity, so two
 * malformed markets would COLLIDE on that component and match each other — the
 * identity check failing open in exactly the case it exists to catch. Better to
 * refuse a market we cannot pin down than to match it by accident.
 *
 * Unknown action types are left alone: their layout is unknown, so argument 2
 * need not be a timestamp at all, and {@link bucketBoundsFromMarketData} already
 * turns them away with a clearer message.
 *
 * @internal Not part of the package's public surface.
 */
export function requireQueryTime(
  queryId: number,
  marketData: Pick<MarketData, "type" | "timestamp">
): void {
  // `== null` on purpose: it catches undefined as well as null. `timestamp` is
  // optional on MarketData so hand-built objects still compile, and one that
  // omits it is exactly as unpinnable as one that decoded to null.
  if (marketData.type !== "unknown" && marketData.timestamp == null) {
    throw new Error(
      `market ${queryId} carries no readable query timestamp, so it cannot ` +
        `be matched against the other buckets of its market`
    );
  }
}

/**
 * Turns one bucket market's decoded data into its `[lower, upper)` bounds.
 *
 * `null` means open-ended, which is how the outer two buckets of a market are
 * always struck. Bounds are half-open upstream, so a value landing exactly on a
 * boundary resolves the upper bucket only.
 *
 * `"above"`, `"below"`, `"between"` and `"equals"` markets are struck in the
 * stream's own units; `"change_between"` markets are struck in percent, against
 * the stream's value one time_interval earlier. This function does not
 * distinguish them — a caller comparing bounds across markets has to know it is
 * comparing like with like.
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
    const value = Number(thresholds[index]);
    if (!Number.isFinite(value)) {
      // Number("abc") is NaN, which would flow all the way into the forecast
      // and surface as a NaN value rather than as this market being unreadable.
      throw new Error(
        `threshold ${index} of a '${marketType}' market is not a number: ` +
          `'${thresholds[index]}'`
      );
    }
    return value;
  };

  /**
   * A threshold slot that may be struck open, which a decoded market holds as an
   * empty string in place rather than as a shorter array. Only
   * `"change_between"` markets have one; every other type's bounds are all
   * present, so they read through {@link threshold} and an empty slot is an
   * error there rather than a tail.
   */
  const optionalThreshold = (index: number): number | null => {
    if (thresholds.length <= index) {
      throw new Error(
        `a '${marketType}' market needs ${index + 1} threshold slot(s), ` +
          `got ${thresholds.length}`
      );
    }
    return thresholds[index] === "" ? null : threshold(index);
  };

  switch (marketType) {
    case "below":
      return { lower: null, upper: threshold(0) };
    case "above":
      return { lower: threshold(0), upper: null };
    case "between": {
      const lower = threshold(0);
      const upper = threshold(1);
      // Bounds are half-open [lower, upper), so lower === upper is an empty
      // bucket and lower > upper is an inverted one. Neither can hold an
      // outcome, and both would quietly distort the tiling.
      if (lower >= upper) {
        throw new Error(
          `a '${marketType}' market needs lower < upper, got [${lower}, ${upper})`
        );
      }
      return { lower, upper };
    }
    case "change_between": {
      // Percentage-change buckets, already half-open upstream and already in
      // the open-ended shape this function returns, so the bounds pass through
      // rather than being derived. Note the units differ from every other case:
      // these are percent, against the stream's value one time_interval
      // earlier, where "above"/"below"/"between" are in the stream's own units.
      const lower = optionalThreshold(0);
      const upper = optionalThreshold(1);
      // Both tails open would describe the whole number line. The node action
      // refuses to be created that way, so a market reaching here like that is
      // malformed rather than unbounded.
      if (lower === null && upper === null) {
        throw new Error(
          `a '${marketType}' market needs at least one bound, got neither`
        );
      }
      if (lower !== null && upper !== null && lower >= upper) {
        throw new Error(
          `a '${marketType}' market needs lower < upper, got [${lower}, ${upper})`
        );
      }
      return { lower, upper };
    }
    case "equals": {
      // thresholds are (target, tolerance), NOT (lower, upper). Reading them
      // positionally the way `between` is read would give an inverted bucket and
      // be silently wrong rather than loud.
      const target = threshold(0);
      const tolerance = threshold(1);
      if (tolerance <= 0) {
        throw new Error(
          `an '${marketType}' market needs a positive tolerance, got ${tolerance}`
        );
      }
      const lower = target - tolerance;
      const upper = target + tolerance;
      // A positive tolerance does not guarantee a non-empty bucket. Near the
      // float limits the sum can overflow to Infinity, and a tolerance small
      // enough relative to the target is absorbed entirely, collapsing both
      // edges onto the same value: 1e300 +/- 1e-300 is 1e300 twice.
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower >= upper) {
        throw new Error(
          `an '${marketType}' market with target ${target} and tolerance ` +
            `${tolerance} does not describe a usable bucket: ` +
            `[${lower}, ${upper})`
        );
      }
      return { lower, upper };
    }
    default:
      throw new Error(
        `cannot derive bucket bounds from a '${marketType}' market`
      );
  }
}
