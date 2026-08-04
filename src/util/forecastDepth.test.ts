/**
 * Tests for the depth-weighted forecast path.
 *
 * The depth path consolidates the YES and NO ladders inside the module (the
 * inversion is executable via exact-inverse mint/burn matching, verified on
 * testnet 2026-08-03) and weights each bucket by committed notional rather than
 * reading best quotes alone.
 *
 * Ported case-for-case from sdk-py's tests/test_forecast_depth.py.
 */

import { describe, it, expect } from "vitest";
import {
  BookLevel,
  BucketBook,
  BucketDepth,
  bucketEstimateFromDepth,
  consolidatedAsks,
  consolidatedBids,
  forecastFromBuckets,
  forecastFromDepth,
} from "./forecast";

// MSFT-shaped bounds, as on mainnet.
const BOUNDS: [number | null, number | null][] = [
  [null, 4.04],
  [4.04, 4.33],
  [4.33, 4.62],
  [4.62, 4.92],
  [4.92, null],
];

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Symmetric YES ladders plus the exact NO mirror our MM would post. */
function ladder(mid: number, size = 100, levels = 3, spread = 2, step = 1) {
  const yesBids: BookLevel[] = [];
  const yesAsks: BookLevel[] = [];
  for (let k = 0; k < levels; k++) {
    yesBids.push({ price: round4(mid - spread / 2 - k * step), size });
    yesAsks.push({ price: round4(mid + spread / 2 + k * step), size });
  }
  const noBids = yesAsks.map((l) => ({ price: round4(100 - l.price), size: l.size }));
  const noAsks = yesBids.map((l) => ({ price: round4(100 - l.price), size: l.size }));
  return { yesBids, yesAsks, noBids, noAsks };
}

function build(
  mids: (number | null)[],
  sizes?: number[],
  bounds: [number | null, number | null][] = BOUNDS
): BucketDepth[] {
  return bounds.map(([lower, upper], i) => {
    const mid = mids[i];
    if (mid === null || mid === undefined) return { lower, upper };
    return { lower, upper, ...ladder(mid, sizes ? sizes[i] : 100) };
  });
}

describe("YES/NO consolidation", () => {
  it("turns a NO bid into an executable ask", () => {
    const asks = consolidatedAsks({
      lower: null,
      upper: 4.04,
      noBids: [{ price: 83, size: 50 }],
    });
    expect(asks).toHaveLength(1);
    expect(asks[0].price).toBeCloseTo(17, 10);
    expect(asks[0].size).toBe(50);
  });

  it("turns a NO ask into an executable bid", () => {
    const bids = consolidatedBids({
      lower: null,
      upper: 4.04,
      noAsks: [{ price: 95, size: 40 }],
    });
    expect(bids).toHaveLength(1);
    expect(bids[0].price).toBeCloseTo(5, 10);
  });

  it("sorts the consolidated sides best first", () => {
    const depth: BucketDepth = {
      lower: null,
      upper: 4.04,
      yesBids: [{ price: 30, size: 10 }],
      yesAsks: [{ price: 40, size: 10 }],
      noBids: [{ price: 65, size: 10 }], // -> ask at 35, better than the YES ask
      noAsks: [{ price: 68, size: 10 }], // -> bid at 32, better than the YES bid
    };
    expect(consolidatedBids(depth)[0].price).toBeCloseTo(32, 10);
    expect(consolidatedAsks(depth)[0].price).toBeCloseTo(35, 10);
  });
});

describe("the walk mid", () => {
  it("gives the mid on symmetric depth", () => {
    const est = bucketEstimateFromDepth({
      lower: null,
      upper: 4.04,
      ...ladder(40),
    });
    expect(est.probability).toBeCloseTo(0.4, 6);
    expect(est.quoted).toBe(true);
    expect(est.oneSided).toBe(false);
    expect(est.notionalUsd).toBeGreaterThan(0);
  });

  it("does not move the price when the ladder is imbalanced", () => {
    // Size imbalance is denomination and inventory, not opinion (issue #36): on
    // this venue all resting flow is the MM's own, so extra size behind the walk
    // must leave the estimate exactly where it was.
    const { yesBids, yesAsks } = ladder(40);
    const heavy = yesBids.map((l) => ({ price: l.price, size: l.size * 10 }));
    const pHeavy = bucketEstimateFromDepth({
      lower: null,
      upper: 4.04,
      yesBids: heavy,
      yesAsks,
    }).probability;
    const pFlat = bucketEstimateFromDepth({
      lower: null,
      upper: 4.04,
      yesBids,
      yesAsks,
    }).probability;
    expect(pHeavy).toBeCloseTo(pFlat!, 12);
  });

  it("stays between the best bid and the best ask", () => {
    // The book only pins the truth to [best bid, best ask]; a published
    // probability outside the executable bracket is dutch-bookable. The old
    // microprice gave 18.4 on this real NVDA bucket against a best ask of 17.
    const depth: BucketDepth = {
      lower: null,
      upper: 1.91,
      yesBids: [
        { price: 4, size: 386 },
        { price: 3, size: 519 },
        { price: 1, size: 1558 },
      ],
      noBids: [
        { price: 83, size: 6 },
        { price: 81, size: 25 },
      ],
      noAsks: [
        { price: 97, size: 3 },
        { price: 99, size: 20 },
      ],
    };
    const p = bucketEstimateFromDepth(depth).probability!;
    expect(p).toBeGreaterThanOrEqual(consolidatedBids(depth)[0].price / 100);
    expect(p).toBeLessThanOrEqual(consolidatedAsks(depth)[0].price / 100);
  });

  it("prices a fragmented side instead of dropping it", () => {
    // $5.77 of real asks split across two sub-$5 levels must still price the
    // side (the floor is on the side total, never per level), so splitting an
    // order into small clips cannot silence a side.
    const est = bucketEstimateFromDepth({
      lower: null,
      upper: 1.91,
      yesBids: [{ price: 4, size: 386 }],
      // asks at 17 ($1.02) and 19 ($4.75)
      noBids: [
        { price: 83, size: 6 },
        { price: 81, size: 25 },
      ],
    });
    expect(est.quoted).toBe(true);
    expect(est.oneSided).toBe(false);
    // sell $5 at 4c; buy $5 = $1.02 at 17 then $3.98 at 19 -> 18.59; mid 11.3
    expect(Math.abs(est.probability! - 0.113)).toBeLessThan(0.001);
  });

  it("gives no weight to size behind the walk", () => {
    // 100k shares added at 1c behind the first $5 of bids must not move the
    // estimate by a single bit.
    const { yesBids, yesAsks, noBids, noAsks } = ladder(40);
    const base = bucketEstimateFromDepth({
      lower: null,
      upper: 4.04,
      yesBids,
      yesAsks,
      noBids,
      noAsks,
    }).probability;
    const spammed = [...yesBids, { price: 1, size: 100_000 }];
    const p = bucketEstimateFromDepth({
      lower: null,
      upper: 4.04,
      yesBids: spammed,
      yesAsks,
      noBids,
      noAsks,
    }).probability;
    expect(p).toBe(base);
  });

  it("walks a thin touch into the real depth", () => {
    // A $1.68 best ask cannot speak for the side alone: the $5 walk carries into
    // the next level, blending 42 and 45 by their committed dollars.
    const p = bucketEstimateFromDepth({
      lower: 2.06,
      upper: 2.21,
      yesBids: [
        { price: 30, size: 7 },
        { price: 29, size: 54 },
        { price: 27, size: 58 },
      ],
      yesAsks: [
        { price: 42, size: 4 },
        { price: 45, size: 44 },
      ],
    }).probability!;
    // sell $5: $2.10 at 30 + $2.90 at 29 = 29.42; buy $5: $1.68 at 42 +
    // $3.32 at 45 = 43.99; mid 36.7
    expect(Math.abs(p - 0.367)).toBeLessThan(0.001);
  });

  it("standardises confidence within the market", () => {
    // Confidence compares each bucket to its OWN market's median depth, so a
    // bucket at typical depth earns the full spread quality and a bucket at a
    // fraction of typical depth is discounted proportionally. No external dollar
    // constant is involved, and one whale bucket cannot crush the rest because
    // the standard is the median.
    const threeBounds: [number | null, number | null][] = [
      [null, 1.0],
      [1.0, 2.0],
      [2.0, null],
    ];
    const f = forecastFromDepth(
      build([62.5, 31.25, 6.25], [500, 500, 20], threeBounds)
    )!;
    const confs = f.buckets.map((b) => b.confidence);
    expect(confs[0]).toBeCloseTo(confs[1], 10);
    expect(confs[2]).toBeLessThan(confs[1] * 0.2);

    const whale = forecastFromDepth(
      build([62.5, 31.25, 6.25], [500, 50000, 500], threeBounds)
    )!;
    // A whale in one bucket must not crush its siblings' confidence.
    expect(whale.buckets[0].confidence).toBeCloseTo(confs[0], 2);
  });
});

// --- the issue #36 book, frozen ---------------------------------------------

// Live NVDA EPS book, 2026-08-03. Under the old share-weighted microprice the
// five raw estimates summed to 1.359 and two buckets priced above their own best
// ask. The walk mid must keep every bucket inside its touch and the raw sum near
// 1 (spread-wide, not ladder-wide).

const NVDA_FROZEN: BucketDepth[] = [
  {
    lower: null,
    upper: 1.91,
    yesBids: [
      { price: 4, size: 386 },
      { price: 3, size: 519 },
      { price: 1, size: 1558 },
    ],
    noBids: [
      { price: 83, size: 6 },
      { price: 81, size: 25 },
    ],
    noAsks: [
      { price: 97, size: 3 },
      { price: 99, size: 20 },
    ],
  },
  {
    lower: 1.91,
    upper: 2.06,
    yesBids: [
      { price: 17, size: 96 },
      { price: 16, size: 18 },
      { price: 14, size: 122 },
    ],
    noBids: [
      { price: 70, size: 19 },
      { price: 68, size: 29 },
    ],
    noAsks: [{ price: 84, size: 5 }],
  },
  {
    lower: 2.06,
    upper: 2.21,
    yesBids: [
      { price: 30, size: 7 },
      { price: 29, size: 54 },
      { price: 27, size: 58 },
    ],
    yesAsks: [
      { price: 42, size: 4 },
      { price: 45, size: 44 },
    ],
    noBids: [
      { price: 57, size: 7 },
      { price: 55, size: 28 },
    ],
    noAsks: [{ price: 70, size: 16 }],
  },
  {
    lower: 2.21,
    upper: 2.35,
    yesBids: [
      { price: 15, size: 62 },
      { price: 14, size: 111 },
      { price: 12, size: 130 },
    ],
    yesAsks: [{ price: 27, size: 35 }],
    noBids: [
      { price: 72, size: 16 },
      { price: 70, size: 29 },
    ],
    noAsks: [{ price: 99, size: 6 }],
  },
  {
    lower: 2.35,
    upper: null,
    yesBids: [
      { price: 4, size: 499 },
      { price: 3, size: 667 },
      { price: 1, size: 2000 },
    ],
    noBids: [
      { price: 75, size: 37 },
      { price: 74, size: 24 },
      { price: 73, size: 51 },
    ],
    noAsks: [
      { price: 97, size: 3 },
      { price: 99, size: 20 },
    ],
  },
];

describe("the frozen NVDA book", () => {
  it("keeps every bucket inside its touch", () => {
    for (const depth of NVDA_FROZEN) {
      const p = bucketEstimateFromDepth(depth).probability!;
      expect(p).toBeGreaterThanOrEqual(consolidatedBids(depth)[0].price / 100);
      expect(p).toBeLessThanOrEqual(consolidatedAsks(depth)[0].price / 100);
    }
  });

  it("keeps the raw sum spread-wide rather than inflated", () => {
    const total = NVDA_FROZEN.reduce(
      (acc, d) => acc + bucketEstimateFromDepth(d).probability!,
      0
    );
    const lo =
      NVDA_FROZEN.reduce((acc, d) => acc + consolidatedBids(d)[0].price, 0) / 100;
    const hi =
      NVDA_FROZEN.reduce((acc, d) => acc + consolidatedAsks(d)[0].price, 0) / 100;
    expect(total).toBeGreaterThanOrEqual(lo);
    expect(total).toBeLessThanOrEqual(hi);
    // was 1.359 under the microprice
    expect(total).toBeLessThan(1.1);
  });
});

describe("griefing", () => {
  const GRIEF_BOUNDS: [number | null, number | null][] = [
    [null, -2.0],
    [-2.0, -1.0],
    [-1.0, 1.0],
    [1.0, 2.0],
    [2.0, null],
  ];

  it("gives a dust ladder no weight", () => {
    // A 1-share 90c bid on a dead tail moved the old estimator by 8 units.
    // Summed over the full book it is $0.90, under the side floor, so absent.
    const base = build([45, 5, 1, 5, 45], undefined, GRIEF_BOUNDS);
    const f0 = forecastFromDepth(base)!;
    const griefed = [...base];
    griefed[4] = {
      lower: 2.0,
      upper: null,
      yesBids: [{ price: 90, size: 1 }],
    };
    const f1 = forecastFromDepth(griefed)!;
    // the dusted bucket contributes exactly what an unquoted one would
    const unquoted = forecastFromDepth([
      ...base.slice(0, 4),
      { lower: 2.0, upper: null },
    ])!;
    expect(f1.value).toBeCloseTo(unquoted.value, 10);
    expect(Math.abs(f1.value - f0.value)).toBeLessThan(8.0);
  });

  it("does count real size at the same price", () => {
    const base = build([45, 5, 1, 5, 45], undefined, GRIEF_BOUNDS);
    const sized = [...base];
    sized[4] = {
      lower: 2.0,
      upper: null,
      yesBids: [{ price: 90, size: 50 }], // $45 resting
    };
    const f0 = forecastFromDepth(base)!;
    const f1 = forecastFromDepth(sized)!;
    expect(f1.value).not.toBeCloseTo(f0.value, 6);
  });
});

describe("forecastFromDepth: degenerate input", () => {
  it("returns null when every book is empty", () => {
    expect(
      forecastFromDepth(BOUNDS.map(([lower, upper]) => ({ lower, upper })))
    ).toBeNull();
  });

  it("survives a one-sided bucket", () => {
    const threeBounds: [number | null, number | null][] = [
      [null, 1.0],
      [1.0, 2.0],
      [2.0, null],
    ];
    const buckets = build([62.5, 31.25, null], undefined, threeBounds);
    // ask-only after inversion
    buckets[2] = {
      lower: 2.0,
      upper: null,
      noBids: [{ price: 93, size: 100 }],
    };
    const f = forecastFromDepth(buckets);
    expect(f).not.toBeNull();
    expect(Number.isFinite(f!.value)).toBe(true);
  });

  it("quarantines a crossed consolidated touch", () => {
    // YES bid 61.5 vs NO bid 45 -> consolidated ask 55 < bid 61.5: the
    // arbitrage state. Must be quarantined, not averaged.
    const threeBounds: [number | null, number | null][] = [
      [null, 1.0],
      [1.0, 2.0],
      [2.0, null],
    ];
    const buckets = build([62.5, 31.25, 6.25], undefined, threeBounds);
    const crossed: BucketDepth = {
      lower: null,
      upper: 1.0,
      yesBids: [{ price: 61.5, size: 100 }],
      noBids: [{ price: 45, size: 100 }], // -> consolidated ask at 55, crossed
    };
    const f = forecastFromDepth([crossed, ...buckets.slice(1)])!;
    expect(f.warnings.some((w) => w.includes("crossed"))).toBe(true);
  });

  it("matches the quote path on symmetric books", () => {
    // On a symmetric mirrored book the depth path and the best-quote path must
    // agree on the probabilities (same mids, same residuals).
    const btcBounds: [number | null, number | null][] = [
      [null, 65000.0],
      [65000.0, 70000.0],
      [70000.0, null],
    ];
    const mids = [62.5, 31.25, 6.25];
    const depth = build(mids, undefined, btcBounds);
    const quotes: BucketBook[] = btcBounds.map(([lower, upper], i) => ({
      lower,
      upper,
      bestBid: mids[i] - 1,
      bestAsk: mids[i] + 1,
    }));
    const fd = forecastFromDepth(depth)!;
    const fq = forecastFromBuckets(quotes)!;
    fd.buckets.forEach((b, i) => {
      expect(b.probability).toBeCloseTo(fq.buckets[i].probability, 9);
    });
    expect(fd.value).toBeCloseTo(fq.value, 6);
  });
});
