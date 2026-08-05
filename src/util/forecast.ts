/**
 * Market-implied point forecast from prediction-market order book state.
 *
 * Prediction markets price RANGES. A five-bucket EPS market says "38% chance EPS
 * lands between $4.33 and $4.62"; it never says "EPS will be $4.47". This module
 * inverts that. Given the order books across every bucket of one market, it
 * produces the single number the book is collectively implying, together with how
 * tightly the book pins that number down.
 *
 *     market says            ->   this module says
 *     "34% between 2.40-2.63"     "2.43, margin of error 0.02"
 *
 * ## How it works
 *
 * A market is N buckets, each its own query_id and its own binary book, and the
 * outer two are open-ended:
 *
 *     bucket 1  (-inf, B1)      bucket 2  [B1, B2)   ...   bucket N  [Bn-1, +inf)
 *
 * Bounds are HALF-OPEN, matching how the markets are actually created
 * (`value < upper`, `value >= lower AND value < upper`, `value >= lower`). So the
 * buckets are mutually exclusive and exhaustive, and a value landing exactly on a
 * boundary resolves the UPPER bucket only.
 *
 * 1. Each bucket's book implies a probability. Two-sided is the mid, with
 *    confidence from how tight the spread is. One-sided takes the quoted side and
 *    steps across by the market's own median half-spread, at reduced confidence:
 *    on real books the open tail buckets are often bid-only at a penny, and
 *    treating that as the midpoint of [0.01, 1.0] calls a dead tail a coin flip.
 *    That single mistake handed MSFT's two tails 27% each and buried the real
 *    distribution, so the rule matters more than it looks.
 *
 * 2. Bucket probabilities are normalised to sum to 1, since independent books
 *    never sum to exactly 1 on their own because of spreads and staleness. A
 *    bucket with no orders at all takes the residual the quoted buckets leave
 *    behind rather than an invented value.
 *
 * 3. Those give the implied CDF at each interior boundary: the probability the
 *    outcome lands at or below B_k is the sum of the buckets up to k.
 *
 * The point estimate is the MEDIAN read directly off that CDF (rank method):
 * walk up the cumulative probabilities until they cross 50% and interpolate
 * within the bucket where the crossing happens. No distribution shape is
 * assumed for anything interior. The published band is P10..P90 read the same
 * way. When a requested percentile falls inside an OPEN-ENDED outer bucket the
 * books contain no information about how far out it lies, so an exponential
 * tail matched to the adjacent bucket's density supplies a number, and the
 * result is flagged (`valueBasis` / `p10Basis` / `p90Basis` = "tail") so
 * consumers can decide whether to show it. Markets struck so that the mass
 * stays between the outer boundaries never need the tail model at all.
 *
 * `confidence` per bucket is (1 - spread) * min(1, n / median(n)) with n the
 * thinner side's committed dollars, standardised against the market's own
 * depth so no external constant is needed. It does not move the median; it is
 * published as book quality and drives warnings.
 *
 * @module
 */

// Translated from truflation/prediction-bots @ main 21fe4f3 (PR #37), upstream
// path market-maker-bot/src/market_maker_bot/forecast.py, by way of the
// byte-identical mirror in trufnetwork/sdk-py (src/trufnetwork_sdk_py/forecast.py).
//
// sdk-py can keep a verbatim copy and re-sync with a diff. TypeScript cannot, so
// this is a hand translation and drift has to be caught by BEHAVIOUR instead:
// forecast.test.ts and forecastDepth.test.ts are ports of the upstream suites,
// including the frozen live NVDA book, and are the contract that keeps the two
// SDKs agreeing. Change the algorithm upstream first, then port it here and
// re-run both suites.
//
// Verified against sdk-py over 39 shared cases (best-quote and depth paths,
// tails, the discrete fallback, dutch books, dust griefing, the frozen NVDA
// book) and against a live mainnet market, where value, p10, p90, margin and
// sigma all came back bit-identical.
//
// The residual is ~1e-16, worst case 6.5 ULP, and it has one cause: CPython
// 3.12 gave `sum()` compensated (Neumaier) summation for floats, so the Python
// sums are slightly MORE accurate than the plain left-to-right ones here.
// Reproducing that would mean a compensated adder at every sum site, coupling
// this file to a CPython implementation detail that upstream's source does not
// state — it just says `sum(...)` — and making the translation harder to read
// against the original, which is the whole maintenance strategy. Not worth it
// for a difference fourteen orders of magnitude below the published margin of
// error.
//
// It is not purely invisible: a sum landing within 1e-16 of a rounding boundary
// can move the last digit of a warning STRING (a live book read 1.0725 in
// Python and 1.0724999999999998 here, printing "1.073" against "1.072"). The
// forecast numbers are unaffected. If a re-verification reports differences at
// 1e-16, or a warning digit off by one, this is why.
//
// One deliberate omission: upstream still carries `_fit_normal`, the
// weighted-least-squares normal fit on the probit scale that the rank method
// replaced. It is unreachable there — nothing calls it — so it is not
// translated, which also spares this file an inverse-normal CDF that JavaScript
// has no standard-library answer for. If it is ever wired back up upstream, it
// has to be written here from scratch, not ported.

import { consolidateSide } from "./consolidatedBook";
import type { BookLevel } from "./consolidatedBook";

/** A bracket at least this wide contributes essentially nothing. */
const MIN_CONFIDENCE = 1e-3;

/**
 * Half-spread used to complete a one-sided quote when the market gives us
 * nothing better. Bounds keep a pathological book from imputing a silly step.
 */
const DEFAULT_HALF_SPREAD = 0.06;
const MIN_HALF_SPREAD = 0.01;
const MAX_HALF_SPREAD = 0.2;

/**
 * A quote below this notional is treated as absent. Size does not enter the
 * forecast itself, so without a floor a single tiny order at a silly price moves
 * the published number as much as a real one: one 90c bid on a dead tail shifted
 * a bimodal market by 8 units, for 90c of risk. Only applied when sizes are
 * supplied; callers that pass none keep the unfiltered behaviour.
 */
export const MIN_QUOTE_NOTIONAL_CENT_SHARES = 100;

/**
 * The buckets are mutually exclusive and exhaustive, so the asks must cost at
 * least 1 and the bids must not pay more than 1. Outside these, someone is
 * giving money away. Warned on rather than normalised silently.
 */
const DUTCH_BOOK_TOLERANCE = 0.02;

/**
 * Depth path only. A side whose ENTIRE ladder holds less than this many dollars
 * is treated as absent: with the full book summed, dust cannot hide in front of
 * a real order, so a small floor is enough to make sub-dollar griefing quotes
 * weightless. Tunable.
 */
export const DEPTH_MIN_SIDE_NOTIONAL_USD = 5.0;

/**
 * Disclosure threshold only, never part of the math: a market whose books hold
 * less than this in total gets a warning attached, because relative
 * standardisation cannot see absolute poverty.
 */
export const LOW_TOTAL_NOTIONAL_WARN_USD = 50.0;

/**
 * A second density peak only counts as real multimodality if it reaches this
 * fraction of the tallest peak; below it is quote noise.
 */
export const PEAK_PROMINENCE = 0.2;

/** Where a percentile came from, and therefore how far to trust it. */
export type ForecastBasis = "interior" | "tail" | "unresolved";

/** How the point estimate was produced. */
export type ForecastMethod = "rank" | "discrete";

export type { BookLevel };

/**
 * One bucket's bounds and its best two-sided quote, in cents.
 *
 * `lower`/`upper` are `null` for the open-ended outer buckets. Prices are the
 * positive 1-99 cent convention for the bucket's YES side; `null` (or omitted)
 * means no resting order on that side.
 */
export interface BucketBook {
  /** Inclusive lower bound, `null` when the bucket is open below. */
  lower: number | null;
  /** Exclusive upper bound, `null` when the bucket is open above. */
  upper: number | null;
  /** Best bid in cents, `null`/omitted when nothing rests on the bid. */
  bestBid?: number | null;
  /** Best ask in cents, `null`/omitted when nothing rests on the ask. */
  bestAsk?: number | null;
  /** The bucket's market id, carried through to the result. */
  queryId?: number | null;
  /** Shares at the best bid. Supply it to enable the dust floor. */
  bidSize?: number | null;
  /** Shares at the best ask. Supply it to enable the dust floor. */
  askSize?: number | null;
}

/**
 * One bucket's FULL ladders on all four sides.
 *
 * The YES and NO books are consolidated inside this module because the
 * inversion is executable, not merely informative. Verified on testnet
 * (2026-08-03): the protocol's fill hierarchy matches EXACT inverses. A resting
 * BUY NO at p mint-matches an incoming BUY YES at 100-p (one pair minted for
 * $1), and a resting SELL NO at p burn-matches an incoming SELL YES at 100-p
 * (one pair merged for $1). So:
 *
 *     consolidated bids = yesBids + (100 - p for every NO ask)
 *     consolidated asks = yesAsks + (100 - p for every NO bid)
 *
 * both sides hittable at exactly the inverted price. There is no
 * price-improvement crossing: near-inverses (sums other than 100) rest.
 */
export interface BucketDepth {
  /** Inclusive lower bound, `null` when the bucket is open below. */
  lower: number | null;
  /** Exclusive upper bound, `null` when the bucket is open above. */
  upper: number | null;
  /** Resting YES buy orders, best first or unsorted. */
  yesBids?: readonly BookLevel[];
  /** Resting YES sell orders. */
  yesAsks?: readonly BookLevel[];
  /** Resting NO buy orders; these become executable YES asks. */
  noBids?: readonly BookLevel[];
  /** Resting NO sell orders; these become executable YES bids. */
  noAsks?: readonly BookLevel[];
  /** The bucket's market id, carried through to the result. */
  queryId?: number | null;
}

/** What one bucket's book implies about its probability. */
export interface BucketEstimate {
  queryId: number | null;
  lower: number | null;
  upper: number | null;
  /** Normalised; sums to 1 across the market. */
  probability: number;
  /** Before normalisation. */
  rawProbability: number;
  /** 0 = no usable quote, 1 = tight two-sided. */
  confidence: number;
  oneSided: boolean;
  quoted: boolean;
}

/**
 * The single value a market's order books imply.
 *
 * `value` is the MEDIAN of the implied distribution. `p10`/`p90` are the
 * published band. Each carries a basis flag: "interior" means it was read
 * between real strikes with no shape assumption; "tail" means it fell inside an
 * open-ended outer bucket and rests on the exponential tail model; "unresolved"
 * means the market has too few strikes to place it at all.
 *
 * `marginOfError` is kept for downstream compatibility as half the P10..P90
 * band; `sigma` as the band scaled to a normal-equivalent standard deviation
 * (band / 2.5631). Prefer the quantiles directly.
 */
export interface MarketForecast {
  /** The median of the implied distribution. */
  value: number;
  /** Half the P10..P90 band. NOT a standard error — see the class note. */
  marginOfError: number;
  /** The band scaled to a normal-equivalent standard deviation. */
  sigma: number;
  method: ForecastMethod;
  buckets: BucketEstimate[];
  warnings: string[];
  p10: number | null;
  p90: number | null;
  valueBasis: ForecastBasis;
  p10Basis: ForecastBasis;
  p90Basis: ForecastBasis;
  multimodal: boolean;
  nPeaks: number;
  /** `value - marginOfError`. */
  low: number;
  /** `value + marginOfError`. */
  high: number;
}

/** The flat form of a {@link MarketForecast}, for SDKs and the indexer. */
export interface MarketForecastJSON {
  value: number;
  valueBasis: ForecastBasis;
  p10: number | null;
  p90: number | null;
  p10Basis: ForecastBasis;
  p90Basis: ForecastBasis;
  marginOfError: number;
  low: number;
  high: number;
  sigma: number;
  method: ForecastMethod;
  multimodal: boolean;
  probabilities: number[];
  warnings: string[];
}

/** Flat form for SDKs and the indexer. */
export function forecastToJSON(forecast: MarketForecast): MarketForecastJSON {
  return {
    value: forecast.value,
    valueBasis: forecast.valueBasis,
    p10: forecast.p10,
    p90: forecast.p90,
    p10Basis: forecast.p10Basis,
    p90Basis: forecast.p90Basis,
    marginOfError: forecast.marginOfError,
    low: forecast.low,
    high: forecast.high,
    sigma: forecast.sigma,
    method: forecast.method,
    multimodal: forecast.multimodal,
    probabilities: forecast.buckets.map((b) => b.probability),
    warnings: [...forecast.warnings],
  };
}

// ============================================
// Quote helpers
// ============================================

/**
 * Resolve an exact `.5` tie to even, the way Python's format spec does.
 *
 * `toFixed` breaks ties away from zero, so a 62.5% mass warning reads "63%" here
 * and "62%" in sdk-py — a cosmetic split, but the warning strings are published
 * output and the two SDKs are meant to agree character for character.
 *
 * Only exact ties are touched; everything else is handed back untouched for
 * `toFixed` to round, which it already does correctly off the exact value. A
 * real tie survives the scaling here: a double can only sit exactly on a decimal
 * `.5` if it is dyadic, and a dyadic value times a power of ten is exact.
 */
function halfToEven(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  if (scaled - floor !== 0.5) return value;
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

/** Python's `f"{x:.Nf}"`. */
function fixed(value: number, digits: number): string {
  return halfToEven(value, digits).toFixed(digits);
}

/** Python's `f"{x:+.1f}"`. */
function signed1(value: number): string {
  return (value >= 0 ? "+" : "") + fixed(value, 1);
}

/** Python's `f"{x:,.0f}"`. */
function grouped0(value: number): string {
  return fixed(value, 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Drop a top-of-book quote too small to mean anything.
 *
 * LIMITATION: this only sees the best level. If a dust order is sitting in
 * front of a real one, dropping it here marks the whole bucket unpriced rather
 * than falling back to the real quote behind it, which can be worse than not
 * filtering at all. Callers that hold the full book should instead pass the best
 * level whose size clears the floor, and leave the size fields unset. This is a
 * backstop, not the fix.
 */
function usableQuote(
  price: number | null | undefined,
  size: number | null | undefined
): number | null {
  if (price === null || price === undefined) return null;
  if (size === null || size === undefined) return price;
  return price * size >= MIN_QUOTE_NOTIONAL_CENT_SHARES ? price : null;
}

/** The bucket's best bid, or `null` when it is absent or below the dust floor. */
export function usableBid(book: BucketBook): number | null {
  return usableQuote(book.bestBid, book.bidSize);
}

/** The bucket's best ask, or `null` when it is absent or below the dust floor. */
export function usableAsk(book: BucketBook): number | null {
  return usableQuote(book.bestAsk, book.askSize);
}

/**
 * The bucket's executable bid ladder: its YES bids plus every NO ask inverted
 * to the YES price it is hittable at. Best (highest) first.
 *
 * A native and an inverted level landing on the same price merge into one
 * entry. Everything downstream here sums price x size or walks the ladder in
 * price order, so merging leaves the forecast numbers unchanged. Callers that
 * need the native/inverse split should use {@link consolidateSide} directly.
 */
export function consolidatedBids(depth: BucketDepth): BookLevel[] {
  return consolidateSide(depth.yesBids ?? [], depth.noAsks ?? [], "bid").map(
    (level) => ({ price: level.price, size: level.total })
  );
}

/**
 * The bucket's executable ask ladder: its YES asks plus every NO bid inverted
 * to the YES price it is hittable at. Best (lowest) first. Same-price levels
 * merge, as in {@link consolidatedBids}.
 */
export function consolidatedAsks(depth: BucketDepth): BookLevel[] {
  return consolidateSide(depth.yesAsks ?? [], depth.noBids ?? [], "ask").map(
    (level) => ({ price: level.price, size: level.total })
  );
}

/** The consolidated best quotes, for the spread and dutch-book helpers. */
export function bestView(depth: BucketDepth): BucketBook {
  const bids = consolidatedBids(depth);
  const asks = consolidatedAsks(depth);
  return {
    lower: depth.lower,
    upper: depth.upper,
    bestBid: bids.length ? bids[0].price : null,
    bestAsk: asks.length ? asks[0].price : null,
    queryId: depth.queryId ?? null,
  };
}

/**
 * Half the market's median two-sided spread, as a probability.
 *
 * Used to complete one-sided quotes. A missing side is usually an artifact of
 * the market maker's own quoting (no inventory to sell, or the self-cross guard
 * suppressing a leg) rather than a statement about probability, so the other
 * side is still informative once shifted by the spread this market actually
 * trades.
 */
export function typicalHalfSpread(buckets: readonly BucketBook[]): number {
  const spreads: number[] = [];
  for (const b of buckets) {
    const bid = b.bestBid;
    const ask = b.bestAsk;
    if (bid === null || bid === undefined) continue;
    if (ask === null || ask === undefined) continue;
    if (ask < bid) continue;
    spreads.push((ask - bid) / 100);
  }
  if (!spreads.length) return DEFAULT_HALF_SPREAD;
  spreads.sort((a, b) => a - b);
  const mid = Math.floor(spreads.length / 2);
  const median =
    spreads.length % 2 ? spreads[mid] : (spreads[mid - 1] + spreads[mid]) / 2;
  return Math.max(MIN_HALF_SPREAD, Math.min(median / 2, MAX_HALF_SPREAD));
}

/** What one bucket's best quote says, before normalisation. */
export interface BucketQuoteEstimate {
  /** `null` when the bucket is unquoted or crossed. NOT 0.5. */
  probability: number | null;
  confidence: number;
  oneSided: boolean;
  quoted: boolean;
}

/**
 * Turn one bucket's best quote into a probability, confidence and flags.
 *
 * Two-sided is the easy case: the mid, with confidence from how tight the
 * spread is.
 *
 * One-sided needs care. Treating a lone 1c bid as the midpoint of [0.01, 1.0]
 * would call it a coin flip, which is badly wrong: on real mainnet books the
 * open tail buckets are frequently bid-only at a penny, and the midpoint rule
 * handed them 27% each and buried the actual distribution. The quoted side is
 * the only real information, so we take it and step across by the market's own
 * half-spread, then mark the confidence down.
 *
 * An unquoted bucket returns `null`. It is NOT 0.5: the caller assigns it the
 * residual probability the quoted buckets leave behind, which is what the
 * market actually implies about it.
 */
export function bucketProbability(
  bestBid: number | null | undefined,
  bestAsk: number | null | undefined,
  halfSpread: number = DEFAULT_HALF_SPREAD
): BucketQuoteEstimate {
  const bid = bestBid ?? null;
  const ask = bestAsk ?? null;
  const quoted = bid !== null || ask !== null;
  if (!quoted) {
    return { probability: null, confidence: 0, oneSided: false, quoted: false };
  }

  const oneSided = bid === null || ask === null;

  if (!oneSided) {
    const lo = Math.max(0, Math.min(1, (bid as number) / 100));
    const hi = Math.max(0, Math.min(1, (ask as number) / 100));
    if (hi < lo) {
      // Crossed book: bid above ask. Either stale, or free money. Keeping the
      // midpoint at low confidence would still let the bogus probability enter
      // the normalisation and shift every CDF point, because confidence only
      // affects weighting. Treat it as unquoted so the caller can assign it the
      // residual instead.
      return { probability: null, confidence: 0, oneSided, quoted };
    }
    return {
      probability: (lo + hi) / 2,
      confidence: 1 - (hi - lo),
      oneSided,
      quoted,
    };
  }

  let p =
    bid !== null ? bid / 100 + halfSpread : (ask as number) / 100 - halfSpread;
  p = Math.max(0, Math.min(1, p));
  // Confidence of a two-sided book at this spread, halved: we inferred one side
  // rather than observing it.
  return {
    probability: p,
    confidence: Math.max(MIN_CONFIDENCE, (1 - 2 * halfSpread) / 2),
    oneSided,
    quoted,
  };
}

// ============================================
// Shared back half of the pipeline
// ============================================

/**
 * Probability-weighted bucket midpoints, for when the rank read cannot run.
 *
 * The open tails have no midpoint, so they are represented by their finite edge
 * pushed out by half the average interior width. Cruder than a rank read and
 * biased toward the centre, which is why it is only a fallback.
 */
function discreteFallback(
  estimates: readonly BucketEstimate[],
  boundaries: readonly number[]
): { value: number; sigma: number } {
  const widths: number[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    widths.push(boundaries[i + 1] - boundaries[i]);
  }
  const pad = widths.length
    ? widths.reduce((a, b) => a + b, 0) / widths.length / 2
    : 0;

  const points: number[] = [];
  const probs: number[] = [];
  for (const est of estimates) {
    if (est.lower === null && est.upper === null) continue;
    let point: number;
    if (est.lower === null) {
      point = (est.upper as number) - pad;
    } else if (est.upper === null) {
      point = est.lower + pad;
    } else {
      point = (est.lower + est.upper) / 2;
    }
    points.push(point);
    probs.push(est.probability);
  }

  const total = probs.reduce((a, b) => a + b, 0);
  if (total <= 0 || !points.length) return { value: NaN, sigma: NaN };

  const mean = points.reduce((acc, x, i) => acc + probs[i] * x, 0) / total;
  const variance =
    points.reduce((acc, x, i) => acc + probs[i] * (x - mean) ** 2, 0) / total;
  return { value: mean, sigma: Math.sqrt(Math.max(variance, 0)) };
}

/**
 * A margin of error for the discrete fallback.
 *
 * Publishing `sigma` here would be wrong: sigma is how uncertain the OUTCOME is,
 * not how well the book pins our estimate. The fallback also represents each
 * open tail by an invented point, so its centre is genuinely less trustworthy
 * than a rank read, so sigma is scaled down by the number of buckets we could
 * actually read.
 *
 * Upstream's docstring also claims a floor "so a fallback can never claim to be
 * tighter than a real fit". No floor is implemented there, and adding one here
 * would silently diverge from sdk-py, so the claim is dropped rather than the
 * behaviour changed. Worth raising upstream.
 */
function discreteMargin(
  sigma: number,
  estimates: readonly BucketEstimate[]
): number {
  const quoted = estimates.filter((e) => e.quoted).length || 1;
  const conf =
    estimates.reduce((acc, e) => acc + e.confidence, 0) /
    Math.max(estimates.length, 1);
  return (sigma * (1 - 0.5 * conf)) / Math.sqrt(quoted);
}

/**
 * Mutually exclusive and exhaustive buckets bound the book.
 *
 * Buying YES in every bucket guarantees exactly 1, so the asks must sum to at
 * least 1. Minting a pair in every bucket and selling all the YES also settles
 * at 1, so the bids must not sum to more than 1. A violation is risk-free money
 * against us.
 */
function dutchBookWarning(buckets: readonly BucketBook[]): string | null {
  const asks = buckets.map(usableAsk);
  const bids = buckets.map(usableBid);
  if (asks.every((a) => a !== null)) {
    const total = (asks as number[]).reduce((a, b) => a + b, 0) / 100;
    if (total < 1 - DUTCH_BOOK_TOLERANCE) {
      return (
        `DUTCH BOOK: asks sum to ${fixed(total, 3)}; buying every bucket costs ` +
        `${fixed(total, 3)} and settles at 1.000, a risk-free ` +
        `${fixed((1 - total) * 100, 1)}c per dollar against us`
      );
    }
  }
  if (bids.every((b) => b !== null)) {
    const total = (bids as number[]).reduce((a, b) => a + b, 0) / 100;
    if (total > 1 + DUTCH_BOOK_TOLERANCE) {
      return (
        `DUTCH BOOK: bids sum to ${fixed(total, 3)}; minting and selling every ` +
        `bucket pays ${fixed(total, 3)} against a cost of 1.000, a risk-free ` +
        `${fixed((total - 1) * 100, 1)}c per dollar against us`
      );
    }
  }
  return null;
}

/**
 * Percentile `q` read directly off the piecewise-linear implied CDF.
 *
 * Interior crossings interpolate between real strikes and assume nothing beyond
 * uniform density within the bucket. A crossing inside an open-ended outer
 * bucket needs a shape for the tail; we use an exponential decay matched to the
 * adjacent interior bucket's density, and flag the result "tail" so consumers
 * know it rests on that assumption. With fewer than two boundaries there is no
 * interior at all and no density to anchor a tail, so the answer is unresolved.
 */
function rankQuantile(
  bounds: readonly number[],
  probs: readonly number[],
  q: number
): { value: number | null; basis: ForecastBasis } {
  const k = probs.length;
  const cum: number[] = [];
  let run = 0;
  for (let i = 0; i < k - 1; i++) {
    run += probs[i];
    cum.push(run);
  }
  if (bounds.length < 2) return { value: null, basis: "unresolved" };

  for (let i = 1; i < k - 1; i++) {
    // interior buckets
    const loC = cum[i - 1];
    const hiC = cum[i];
    if (loC <= q && q <= hiC) {
      const loB = bounds[i - 1];
      const hiB = bounds[i];
      if (hiC <= loC) return { value: (loB + hiB) / 2, basis: "interior" };
      const frac = (q - loC) / (hiC - loC);
      return { value: loB + frac * (hiB - loB), basis: "interior" };
    }
  }

  const widths: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    widths.push(bounds[i + 1] - bounds[i]);
  }

  if (q < cum[0]) {
    // lower open tail
    const dens = widths[0] > 0 ? probs[1] / widths[0] : 0;
    if (dens <= 0 || cum[0] <= 0) return { value: null, basis: "unresolved" };
    const lam = dens / cum[0];
    return { value: bounds[0] + Math.log(q / cum[0]) / lam, basis: "tail" };
  }

  // upper open tail
  const upperMass = probs[k - 1];
  const dens = widths[widths.length - 1] > 0 ? probs[k - 2] / widths[widths.length - 1] : 0;
  if (dens <= 0 || upperMass <= 0) return { value: null, basis: "unresolved" };
  const lam = dens / upperMass;
  return {
    value:
      bounds[bounds.length - 1] -
      Math.log(Math.max(1 - q, 1e-12) / upperMass) / lam,
    basis: "tail",
  };
}

/**
 * Prominent local maxima of the interior density profile.
 *
 * A peak only counts if it reaches {@link PEAK_PROMINENCE} of the tallest one,
 * so a penny-noise bump next to a 96% bucket does not read as bimodality. Open
 * tails carry no density profile, so tail-heavy bimodality is seen through the
 * interior buckets adjacent to the tails.
 */
function countPeaks(bounds: readonly number[], probs: readonly number[]): number {
  const dens: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const w = bounds[i + 1] - bounds[i];
    dens.push(w > 0 ? probs[i + 1] / w : 0);
  }
  if (!dens.length) return 1;
  const top = Math.max(...dens);
  if (top <= 0) return 1;
  let peaks = 0;
  for (let i = 0; i < dens.length; i++) {
    const d = dens[i];
    const isMax =
      (i === 0 || d > dens[i - 1]) &&
      (i === dens.length - 1 || d >= dens[i + 1]);
    if (isMax && d >= PEAK_PROMINENCE * top) peaks += 1;
  }
  return Math.max(peaks, 1);
}

/** One bucket's identity, as `assemble` needs it. */
interface BucketMeta {
  lower: number | null;
  upper: number | null;
  queryId: number | null;
}

function buildForecast(
  value: number,
  marginOfError: number,
  sigma: number,
  method: ForecastMethod,
  buckets: BucketEstimate[],
  warnings: string[],
  extra: Partial<MarketForecast> = {}
): MarketForecast {
  return {
    value,
    marginOfError,
    sigma,
    method,
    buckets,
    warnings,
    p10: null,
    p90: null,
    valueBasis: "interior",
    p10Basis: "interior",
    p90Basis: "interior",
    multimodal: false,
    nPeaks: 1,
    low: value - marginOfError,
    high: value + marginOfError,
    ...extra,
  };
}

/**
 * Shared back half of the pipeline: normalise the per-bucket estimates, build
 * the implied CDF, read the percentiles off it, or fall back.
 *
 * `bidsCents` is each bucket's best bid, used only to bound what an unpriced
 * bucket could claim.
 */
function assemble(
  meta: readonly BucketMeta[],
  bidsCents: readonly (number | null)[],
  raw: readonly (number | null)[],
  confs: readonly number[],
  oneSidedFlags: readonly boolean[],
  quotedFlags: readonly boolean[],
  warnings: string[]
): MarketForecast | null {
  if (!quotedFlags.some(Boolean)) return null;

  const nMissing = raw.filter((p) => p === null).length;
  const nUnquoted = quotedFlags.filter((q) => !q).length;
  const nCrossed = nMissing - nUnquoted;
  if (nUnquoted) {
    warnings.push(`${nUnquoted} of ${meta.length} buckets unquoted`);
  }
  if (nCrossed) {
    warnings.push(
      `${nCrossed} bucket(s) crossed (bid above ask); treated as unpriced`
    );
  }
  if (oneSidedFlags.some(Boolean)) {
    warnings.push(
      `${oneSidedFlags.filter(Boolean).length} bucket(s) one-sided; ` +
        `margin of error widened`
    );
  }

  const quotedTotal = raw.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  if (quotedTotal <= 0) return null;
  if (Math.abs(quotedTotal - 1) > DUTCH_BOOK_TOLERANCE) {
    // Independent books never sum to exactly 1. Report the SIGNED deviation
    // rather than a wide dead band: the direction says whether the book is over-
    // or under-priced, and a wide window hides real boxes.
    warnings.push(
      `bucket mids sum to ${fixed(quotedTotal, 3)} ` +
        `(${signed1((quotedTotal - 1) * 100)}c per dollar) before normalising`
    );
  }

  let filled = [...raw];
  if (nMissing) {
    // An unpriced bucket is UNKNOWN, not impossible. Its probability is bounded
    // above by whatever the other buckets' BIDS do not already claim, since bids
    // are a lower bound on their true probabilities. Take the midpoint of that
    // interval. Asserting zero is a strong claim the book never made.
    let bidClaim = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== null) bidClaim += (bidsCents[i] ?? 0) / 100;
    }
    const headroom = Math.max(0, 1 - bidClaim);
    const est = headroom / (2 * nMissing);
    filled = raw.map((p) => (p === null ? est : p));
  }

  const total = filled.reduce<number>((acc, p) => acc + (p ?? 0), 0);
  if (total <= 0) return null;
  const probs = filled.map((p) => (p ?? 0) / total);

  const estimates: BucketEstimate[] = meta.map((m, i) => ({
    queryId: m.queryId,
    lower: m.lower,
    upper: m.upper,
    probability: probs[i],
    rawProbability: raw[i] ?? 0,
    confidence: confs[i],
    oneSided: oneSidedFlags[i],
    quoted: quotedFlags[i],
  }));

  const bounds = meta
    .slice(0, -1)
    .map((m) => m.upper)
    .filter((u): u is number => u !== null);

  if (bounds.length !== meta.length - 1) {
    warnings.push("bucket bounds incomplete; falling back to discrete estimate");
    const { value, sigma } = discreteFallback(estimates, bounds);
    if (Number.isNaN(value)) return null;
    return buildForecast(
      value,
      discreteMargin(sigma, estimates),
      sigma,
      "discrete",
      estimates,
      warnings
    );
  }

  // Rank method: read the percentiles straight off the implied CDF.
  const med = rankQuantile(bounds, probs, 0.5);
  const p10 = rankQuantile(bounds, probs, 0.1);
  const p90 = rankQuantile(bounds, probs, 0.9);

  if (med.value === null) {
    warnings.push(
      "median unresolvable from these strikes; falling back to discrete estimate"
    );
    const { value, sigma } = discreteFallback(estimates, bounds);
    if (Number.isNaN(value)) return null;
    return buildForecast(
      value,
      discreteMargin(sigma, estimates),
      sigma,
      "discrete",
      estimates,
      warnings
    );
  }

  if (med.basis === "tail") {
    const outside = probs[0] >= 0.5 ? probs[0] : probs[probs.length - 1];
    warnings.push(
      `median lies beyond the outer strikes (${fixed(outside * 100, 0)}% of mass ` +
        `in an open-ended bucket); value depends on the assumed tail shape`
    );
  }
  for (const [name, basis] of [
    ["p10", p10.basis],
    ["p90", p90.basis],
  ] as const) {
    if (basis === "tail") {
      warnings.push(`${name} falls in an open tail; tail-model dependent`);
    } else if (basis === "unresolved") {
      warnings.push(`${name} unresolvable from these strikes`);
    }
  }

  const nPeaks = countPeaks(bounds, probs);
  const multimodal = nPeaks >= 2;
  if (multimodal) {
    warnings.push(
      `market shows ${nPeaks} probability clusters; a single point ` +
        `forecast misrepresents it, publish the clusters instead`
    );
  }

  let margin: number;
  let sigma: number;
  if (p10.value !== null && p90.value !== null) {
    const band = Math.max(p90.value - p10.value, 0);
    margin = band / 2;
    sigma = band / 2.5631; // P10..P90 of a normal spans 2.5631 sigma
  } else {
    margin = 0;
    sigma = 0;
    warnings.push("band unresolvable; margin and sigma reported as 0");
  }

  return buildForecast(
    med.value,
    margin,
    sigma,
    "rank",
    estimates,
    warnings,
    {
      p10: p10.value,
      p90: p90.value,
      valueBasis: med.basis,
      p10Basis: p10.basis,
      p90Basis: p90.basis,
      multimodal,
      nPeaks,
    }
  );
}

// ============================================
// Entry points
// ============================================

/**
 * Collapse one market's bucket books into a single implied value, from best
 * quotes only.
 *
 * Buckets must be supplied in ascending order and span the whole line, with the
 * first open below and the last open above. Returns `null` when the book carries
 * no usable information at all. When full ladders are available, prefer
 * {@link forecastFromDepth}, which weights by committed notional.
 */
export function forecastFromBuckets(
  buckets: readonly BucketBook[]
): MarketForecast | null {
  const warnings: string[] = [];

  if (buckets.length < 2) return null;

  const half = typicalHalfSpread(buckets);

  const dutch = dutchBookWarning(buckets);
  if (dutch) warnings.push(dutch);

  const raw: (number | null)[] = [];
  const confs: number[] = [];
  const oneSidedFlags: boolean[] = [];
  const quotedFlags: boolean[] = [];
  for (const b of buckets) {
    const est = bucketProbability(usableBid(b), usableAsk(b), half);
    raw.push(est.probability);
    confs.push(est.confidence);
    oneSidedFlags.push(est.oneSided);
    quotedFlags.push(est.quoted);
  }

  return assemble(
    buckets.map((b) => ({
      lower: b.lower,
      upper: b.upper,
      queryId: b.queryId ?? null,
    })),
    buckets.map(usableBid),
    raw,
    confs,
    oneSidedFlags,
    quotedFlags,
    warnings
  );
}

/**
 * `(vwapCents, notionalUsd, shares)` over a full ladder.
 *
 * The full-ladder VWAP no longer prices anything (see `walkPrice`); dollars are
 * the currency for confidence and the dust floors, since posting many shares of
 * a cheap side is not the same commitment as posting the same dollars.
 */
function sideStats(levels: readonly BookLevel[]): {
  vwapCents: number;
  notionalUsd: number;
  shares: number;
} {
  let centShares = 0;
  let shares = 0;
  for (const l of levels) {
    centShares += l.price * l.size;
    shares += l.size;
  }
  return {
    vwapCents: centShares / shares,
    notionalUsd: centShares / 100,
    shares,
  };
}

/**
 * Dollar-weighted price of executing `targetUsd` from the touch.
 *
 * Walk the ladder best-first, consuming each level's own notional until the
 * target is reached; the last level fills partially. Each committed dollar
 * carries the same weight regardless of the price it rests at, which is the
 * whole point: per-dollar influence must not depend on denomination, or penny
 * ladders (25 shares per dollar at 4c) out-vote real money.
 *
 * Callers guarantee the ladder holds at least `targetUsd` in total (the side
 * floor); if it somehow does not, the walk prices what is there.
 */
function walkPrice(levels: readonly BookLevel[], targetUsd: number): number {
  let remaining = targetUsd * 100; // cent-shares
  let weighted = 0;
  let taken = 0;
  for (const l of levels) {
    if (remaining <= 0) break;
    const take = Math.min(l.price * l.size, remaining);
    weighted += take * l.price;
    taken += take;
    remaining -= take;
  }
  return weighted / taken;
}

/** What one bucket's full ladders say, before normalisation. */
export interface BucketDepthEstimate {
  /** `null` when the bucket is unquoted or crossed at the consolidated touch. */
  probability: number | null;
  /** The spread component of confidence. */
  quality: number;
  /** Committed dollars backing the estimate. */
  notionalUsd: number;
  oneSided: boolean;
  quoted: boolean;
}

/**
 * One bucket's implied probability from its full consolidated ladders.
 *
 * The probability is the midpoint of the two executable walk prices: the
 * dollar-weighted price of selling {@link DEPTH_MIN_SIDE_NOTIONAL_USD} into the
 * consolidated bids and of buying the same from the consolidated asks, clamped
 * into [best bid, best ask]. A book only pins the truth to that interval, so the
 * estimate must be a selection from it; depth beyond the first walk dollars is
 * inventory, not opinion, and moves confidence only.
 *
 * This replaced a full-book share-weighted microprice, which let cheap ladders
 * out-vote real money (a dollar at 4c is 25 shares, at 30c it is 3) and on live
 * books pushed every sub-50c bucket above its own best ask (prediction-bots
 * issue #36). Ladder imbalance moves the walk mid not at all: on this venue all
 * resting flow is the market maker's own, so imbalance carries no information
 * and would only be a free manipulation lever.
 *
 * `quality` is the spread component of confidence: (1 - spread) two-sided,
 * halved for a one-sided book whose missing side was inferred. `notionalUsd` is
 * the committed dollars backing the estimate: the THINNER side when both exist,
 * the quoted side otherwise. The caller standardises notional against the
 * market's own median depth to finish the confidence; no external constant is
 * involved.
 *
 * Sides whose whole ladder holds under {@link DEPTH_MIN_SIDE_NOTIONAL_USD} are
 * treated as absent: with the full book summed, dust cannot hide in front of a
 * real order. Trades are deliberately NOT used: resting depth is live, at-risk
 * capital, and the venue's only taker is a designed noise trader.
 */
export function bucketEstimateFromDepth(
  depth: BucketDepth,
  halfSpread: number = DEFAULT_HALF_SPREAD
): BucketDepthEstimate {
  let bids = consolidatedBids(depth);
  let asks = consolidatedAsks(depth);
  let bidNotional: number | null = null;
  let askNotional: number | null = null;

  if (bids.length) {
    const stats = sideStats(bids);
    bidNotional = stats.notionalUsd;
    if (bidNotional < DEPTH_MIN_SIDE_NOTIONAL_USD) {
      bids = [];
      bidNotional = null;
    }
  }
  if (asks.length) {
    const stats = sideStats(asks);
    askNotional = stats.notionalUsd;
    if (askNotional < DEPTH_MIN_SIDE_NOTIONAL_USD) {
      asks = [];
      askNotional = null;
    }
  }

  const quoted = bids.length > 0 || asks.length > 0;
  if (!quoted) {
    return {
      probability: null,
      quality: 0,
      notionalUsd: 0,
      oneSided: false,
      quoted: false,
    };
  }
  const oneSided = !(bids.length && asks.length);

  if (!oneSided) {
    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    if (bestBid >= bestAsk) {
      // Crossed at the consolidated touch: stale or free money.
      return {
        probability: null,
        quality: 0,
        notionalUsd: 0,
        oneSided,
        quoted,
      };
    }
    const walkBid = walkPrice(bids, DEPTH_MIN_SIDE_NOTIONAL_USD);
    const walkAsk = walkPrice(asks, DEPTH_MIN_SIDE_NOTIONAL_USD);
    let p = (walkBid + walkAsk) / 2;
    p = Math.max(bestBid, Math.min(bestAsk, p)) / 100;
    const spread = (bestAsk - bestBid) / 100;
    return {
      probability: Math.max(0, Math.min(1, p)),
      quality: Math.max(1 - spread, MIN_CONFIDENCE),
      notionalUsd: Math.min(bidNotional as number, askNotional as number),
      oneSided,
      quoted,
    };
  }

  let p: number;
  let notional: number;
  if (bids.length) {
    p = walkPrice(bids, DEPTH_MIN_SIDE_NOTIONAL_USD) / 100 + halfSpread;
    notional = bidNotional as number;
  } else {
    p = walkPrice(asks, DEPTH_MIN_SIDE_NOTIONAL_USD) / 100 - halfSpread;
    notional = askNotional as number;
  }
  const quality = (1 - 2 * halfSpread) / 2;
  return {
    probability: Math.max(0, Math.min(1, p)),
    quality: Math.max(quality, MIN_CONFIDENCE),
    notionalUsd: notional,
    oneSided,
    quoted,
  };
}

/**
 * Collapse one market's bucket books into a single implied value, using FULL YES
 * and NO ladders weighted by committed notional.
 *
 * This is the preferred entry point. The YES/NO consolidation happens here, per
 * bucket, because the inversion is executable on this venue (exact inverse
 * mint/burn matching, verified on testnet 2026-08-03), so callers should not
 * have to know the rule.
 */
export function forecastFromDepth(
  buckets: readonly BucketDepth[]
): MarketForecast | null {
  const warnings: string[] = [];

  if (buckets.length < 2) return null;

  const views = buckets.map(bestView);
  const half = typicalHalfSpread(views);

  const dutch = dutchBookWarning(views);
  if (dutch) warnings.push(dutch);

  const raw: (number | null)[] = [];
  const qualities: number[] = [];
  const notionals: number[] = [];
  const oneSidedFlags: boolean[] = [];
  const quotedFlags: boolean[] = [];
  for (const b of buckets) {
    const est = bucketEstimateFromDepth(b, half);
    raw.push(est.probability);
    qualities.push(est.quality);
    notionals.push(est.notionalUsd);
    oneSidedFlags.push(est.oneSided);
    quotedFlags.push(est.quoted);
  }

  // Confidence = quality * min(1, n / median(n)), the market standardised
  // against its own depth. Median rather than max or sum so a single whale
  // bucket cannot crush its siblings' credibility.
  const pricedN = notionals
    .filter((n, i) => raw[i] !== null && n > 0)
    .sort((a, b) => a - b);
  let medN = 0;
  if (pricedN.length) {
    const mid = Math.floor(pricedN.length / 2);
    medN =
      pricedN.length % 2 ? pricedN[mid] : (pricedN[mid - 1] + pricedN[mid]) / 2;
  }
  const confs: number[] = raw.map((p, i) => {
    if (p === null) return 0;
    if (medN > 0) {
      return Math.max(
        qualities[i] * Math.min(1, notionals[i] / medN),
        MIN_CONFIDENCE
      );
    }
    return qualities[i];
  });

  // Disclosure, never math: relative standardisation cannot see absolute
  // poverty, so a market that is thin EVERYWHERE gets a visible caveat.
  let totalUsd = 0;
  for (const b of buckets) {
    for (const side of [consolidatedBids(b), consolidatedAsks(b)]) {
      if (side.length) totalUsd += sideStats(side).notionalUsd;
    }
  }
  if (totalUsd < LOW_TOTAL_NOTIONAL_WARN_USD) {
    warnings.push(
      `total resting notional only $${grouped0(totalUsd)} across all buckets`
    );
  }

  return assemble(
    buckets.map((b) => ({
      lower: b.lower,
      upper: b.upper,
      queryId: b.queryId ?? null,
    })),
    views.map((v) => v.bestBid ?? null),
    raw,
    confs,
    oneSidedFlags,
    quotedFlags,
    warnings
  );
}
