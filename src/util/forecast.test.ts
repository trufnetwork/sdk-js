/**
 * Tests for the market-implied point forecast (best-quote path).
 *
 * Ported case-for-case from sdk-py's tests/test_forecast.py, which is itself the
 * upstream prediction-bots suite. Keeping the cases aligned is what proves the
 * two SDKs agree: forecast.ts is a hand translation, so behaviour is the only
 * thing that can be diffed.
 */

import { describe, it, expect } from "vitest";
import {
  BucketBook,
  bucketProbability,
  forecastFromBuckets,
  forecastToJSON,
} from "./forecast";

// MSFT EPS 2026 Q3 bucket layout, as configured on mainnet.
const MSFT_BOUNDS: [number | null, number | null][] = [
  [null, 4.04],
  [4.04, 4.33],
  [4.33, 4.62],
  [4.62, 4.92],
  [4.92, null],
];

/** Books quoting each bucket at the given cents, with a symmetric spread. */
function build(
  cents: (number | null)[],
  bounds: [number | null, number | null][] = MSFT_BOUNDS,
  spread = 2
): BucketBook[] {
  return bounds.map(([lower, upper], i) => {
    const c = cents[i];
    if (c === null || c === undefined) return { lower, upper };
    return {
      lower,
      upper,
      bestBid: Math.max(1, c - spread / 2),
      bestAsk: Math.min(99, c + spread / 2),
    };
  });
}

/** `forecastFromBuckets`, asserting it produced something. */
function forecast(buckets: BucketBook[]) {
  const f = forecastFromBuckets(buckets);
  expect(f).not.toBeNull();
  return f!;
}

describe("bucketProbability", () => {
  it("takes the midpoint of a two-sided quote", () => {
    const { probability, confidence, oneSided, quoted } = bucketProbability(
      38,
      42
    );
    expect(probability).toBeCloseTo(0.4, 10);
    expect(confidence).toBeCloseTo(0.96, 10);
    expect(oneSided).toBe(false);
    expect(quoted).toBe(true);
  });

  it("is more confident about a tighter spread", () => {
    const tight = bucketProbability(39, 41).confidence;
    const wide = bucketProbability(20, 60).confidence;
    expect(tight).toBeGreaterThan(wide);
  });

  it("steps a one-sided book across by the half spread", () => {
    // A lone bid is real information, but it is a BID: the fair value sits a
    // half-spread above it, not at the midpoint of [bid, 1].
    const { probability, confidence, oneSided, quoted } = bucketProbability(
      30,
      null,
      0.06
    );
    expect(oneSided).toBe(true);
    expect(quoted).toBe(true);
    expect(probability).toBeCloseTo(0.36, 10);
    expect(confidence).toBeLessThan(0.75);
  });

  it("does not read a lone penny bid as a coin flip", () => {
    // The bug live books exposed: the [0.01, 1.0] midpoint made dead tails 50%.
    const { probability } = bucketProbability(1, null, 0.06);
    expect(probability).toBeCloseTo(0.07, 10);
    expect(probability!).toBeLessThan(0.15);
  });

  it("returns null rather than a number for an empty book", () => {
    const { probability, confidence, oneSided, quoted } = bucketProbability(
      null,
      null
    );
    expect(probability).toBeNull();
    expect(confidence).toBe(0);
    expect(quoted).toBe(false);
    expect(oneSided).toBe(false);
  });

  it("distrusts a crossed book", () => {
    expect(bucketProbability(60, 40).confidence).toBeLessThanOrEqual(1e-3);
  });
});

describe("forecastFromBuckets: the core estimate", () => {
  it("centres a symmetric market on the middle bucket", () => {
    // Mass symmetric about bucket 3 must imply its midpoint, (4.33+4.62)/2.
    const f = forecast(build([5, 20, 50, 20, 5]));
    expect(f.method).toBe("rank");
    expect(Math.abs(f.value - 4.475)).toBeLessThan(0.03);
    expect(f.valueBasis).toBe("interior");
  });

  it("moves with the mass", () => {
    const low = forecast(build([40, 30, 20, 7, 3])).value;
    const mid = forecast(build([5, 20, 50, 20, 5])).value;
    const high = forecast(build([3, 7, 20, 30, 40])).value;
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("lands inside the leading bucket", () => {
    const f = forecast(build([5, 10, 60, 20, 5]));
    expect(f.value).toBeGreaterThanOrEqual(4.33);
    expect(f.value).toBeLessThanOrEqual(4.62);
  });

  it("needs no assumed value for the open tails", () => {
    // Heavy mass in the unbounded top bucket must still give a finite answer
    // that sits above the last boundary.
    const f = forecast(build([1, 2, 7, 20, 70]));
    expect(Number.isFinite(f.value)).toBe(true);
    expect(f.value).toBeGreaterThan(4.92);
  });

  it("normalises the probabilities", () => {
    const f = forecast(build([10, 25, 55, 25, 10])); // sums to 125c
    const total = f.buckets.reduce((a, b) => a + b.probability, 0);
    expect(total).toBeCloseTo(1, 10);
    expect(f.warnings.some((w) => w.includes("sum to"))).toBe(true);
  });
});

describe("forecastFromBuckets: the two uncertainties", () => {
  it("publishes the band as the uncertainty statement", () => {
    // Under the rank method the band IS the uncertainty statement: the market
    // says the outcome lands in [p10, p90] with 80% probability. margin and
    // sigma are derived from it for compatibility.
    const f = forecast(build([5, 20, 50, 20, 5]));
    expect(f.p10).not.toBeNull();
    expect(f.p90).not.toBeNull();
    expect(f.p10!).toBeLessThan(f.value);
    expect(f.value).toBeLessThan(f.p90!);
    expect(f.marginOfError).toBeCloseTo((f.p90! - f.p10!) / 2, 10);
    expect(f.sigma).toBeCloseTo((f.p90! - f.p10!) / 2.5631, 10);
  });

  it("pins the value better on tight books than on wide ones", () => {
    const tight = forecast(build([5, 20, 50, 20, 5], MSFT_BOUNDS, 2));
    const wide = forecast(build([5, 20, 50, 20, 5], MSFT_BOUNDS, 30));
    expect(wide.marginOfError).toBeGreaterThan(tight.marginOfError);
  });

  it("widens the margin on one-sided books", () => {
    const twoSided = forecast(build([5, 20, 50, 20, 5]));
    const half: BucketBook[] = MSFT_BOUNDS.map(([lower, upper], i) => ({
      lower,
      upper,
      bestBid: [5, 20, 50, 20, 5][i],
      bestAsk: null,
    }));
    const oneSided = forecast(half);
    expect(oneSided.marginOfError).toBeGreaterThan(twoSided.marginOfError);
    expect(oneSided.warnings.some((w) => w.includes("one-sided"))).toBe(true);
  });

  it("brackets the value with low and high", () => {
    const f = forecast(build([5, 20, 50, 20, 5]));
    expect(f.low).toBeLessThan(f.value);
    expect(f.value).toBeLessThan(f.high);
    expect(f.high - f.low).toBeCloseTo(2 * f.marginOfError, 10);
  });
});

describe("forecastFromBuckets: degenerate input", () => {
  it("returns null when nothing is quoted", () => {
    expect(forecastFromBuckets(build([null, null, null, null, null]))).toBeNull();
  });

  it("returns null for too few buckets", () => {
    expect(
      forecastFromBuckets([
        { lower: null, upper: 4.0, bestBid: 40, bestAsk: 44 },
      ])
    ).toBeNull();
  });

  it("still estimates from a partial book", () => {
    const f = forecast(build([null, 20, 50, 20, null]));
    expect(Number.isFinite(f.value)).toBe(true);
    expect(f.warnings.some((w) => w.includes("unquoted"))).toBe(true);
  });

  it("gives unquoted buckets the residual, not a flat half", () => {
    // Quoted buckets sum to ~0.9, so the two unquoted ones share ~0.1 between
    // them, rather than being handed 0.5 each and swamping the distribution.
    const f = forecast(build([null, 20, 50, 20, null]));
    const probs = f.buckets.map((b) => b.probability);
    expect(probs[0]).toBeCloseTo(probs[4], 10);
    expect(probs[0]).toBeLessThan(0.1);
    expect(probs[2]).toBeGreaterThan(0.4);
  });

  it("does not let dead tails dominate a live middle", () => {
    // Reproduces the live MSFT book: penny-bid one-sided tails around a tight
    // two-sided middle. The tails must not come out level with the leader.
    const f = forecast([
      { lower: null, upper: 4.04, bestBid: 1, bestAsk: null },
      { lower: 4.04, upper: 4.33, bestBid: 16, bestAsk: 28 },
      { lower: 4.33, upper: 4.62, bestBid: 44, bestAsk: 56 },
      { lower: 4.62, upper: 4.92, bestBid: 9, bestAsk: 21 },
      { lower: 4.92, upper: null, bestBid: 1, bestAsk: null },
    ]);
    const probs = f.buckets.map((b) => b.probability);
    expect(probs[2]).toBe(Math.max(...probs));
    expect(probs[0]).toBeLessThan(0.15);
    expect(probs[4]).toBeLessThan(0.15);
    expect(f.value).toBeGreaterThanOrEqual(4.2);
    expect(f.value).toBeLessThanOrEqual(4.7);
  });

  it("does not explode when all the mass is in one bucket", () => {
    const f = forecast(build([1, 1, 95, 1, 1]));
    expect(Number.isFinite(f.value)).toBe(true);
    expect(Number.isFinite(f.marginOfError)).toBe(true);
    expect(f.value).toBeGreaterThanOrEqual(4.0);
    expect(f.value).toBeLessThanOrEqual(5.0);
  });

  it("survives a flat book rather than dividing by zero", () => {
    const f = forecast(build([20, 20, 20, 20, 20]));
    expect(Number.isFinite(f.value)).toBe(true);
  });

  it("serialises to a flat form", () => {
    const json = forecastToJSON(forecast(build([5, 20, 50, 20, 5])));
    expect(Object.keys(json)).toEqual(
      expect.arrayContaining([
        "value",
        "marginOfError",
        "low",
        "high",
        "sigma",
        "method",
      ])
    );
    expect(json.probabilities).toHaveLength(5);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("survives a non-monotonic set of quotes", () => {
    // Noisy quotes can imply a tiny negative probability step; the CDF walk must
    // not trip over it.
    const f = forecast(build([30, 1, 40, 1, 28]));
    expect(Number.isFinite(f.value)).toBe(true);
  });
});
