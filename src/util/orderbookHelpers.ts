/**
 * Order Book Helper Utilities
 *
 * Provides encoding functions for query components and byte conversion utilities.
 */

import { ethers } from "ethers";
import { Utils } from "@trufnetwork/kwil-js";
import {
  encodeActionArgs as encodeActionArgsKwil,
  decodeActionArgs,
  decodeQueryComponents
} from "./AttestationEncoding";
import type { DecodedTransactionPayload } from "./TransactionPayload";

/**
 * Structured content of a prediction market's query components
 */
export interface MarketData {
  dataProvider: string;
  streamId: string;
  actionId: string;
  type: "above" | "below" | "between" | "equals" | "change_between" | "unknown";
  /**
   * The market's strike values in the order the action declares them, one entry
   * per slot. A `"change_between"` market may strike an open tail, which reads
   * back as an empty string in place rather than a shorter array — dropping it
   * would slide the remaining bound into the wrong position.
   */
  thresholds: string[];
  /**
   * The point in the stream the query observes, in unix seconds. Every bucket
   * of one market shares it; null only when the arguments could not be read.
   *
   * Optional here so that code building a MarketData by hand — fixtures, mocks,
   * anything predating the forecast API — still compiles. Anything that came
   * out of {@link decodeMarketData} is a {@link DecodedMarketData}, where it is
   * required and needs no undefined check.
   */
  timestamp?: number | null;
  /**
   * The block height the data is pinned to. Encoded as NULL to mean "latest",
   * so null is a real value rather than a decode failure. Optional for the
   * same reason as `timestamp`.
   */
  frozenAt?: number | null;
}

/**
 * A {@link MarketData} that came off the chain rather than being built by hand.
 *
 * `decodeMarketData` always populates the time fields, so callers reading a
 * decoded market get `number | null` and never have to rule out `undefined`.
 */
export interface DecodedMarketData extends MarketData {
  timestamp: number | null;
  frozenAt: number | null;
}

/**
 * Decodes ABI-encoded query_components into high-level MarketData.
 *
 * @param encoded - ABI-encoded bytes (from marketInfo.queryComponents)
 * @returns Object with decoded market details
 *
 * @example
 * ```typescript
 * const market = decodeMarketData(marketInfo.queryComponents);
 * console.log(`Market type: ${market.type}, Threshold: ${market.thresholds[0]}`);
 * ```
 */
export function decodeMarketData(encoded: string | Uint8Array): DecodedMarketData {
  const bytes = dbBytesToUint8Array(encoded);
  const { dataProvider, streamId, actionId, args: argsBytes } = decodeQueryComponents(bytes);
  const args = decodeActionArgs(argsBytes);

  const market: DecodedMarketData = {
    dataProvider,
    streamId,
    actionId,
    type: "unknown",
    thresholds: [],
    timestamp: null,
    frozenAt: null,
  };

  /** INT8 arguments arrive as bigint, and NULL is a value rather than an error. */
  const argInt = (index: number): number | null => {
    if (index >= args.length) return null;
    const value = args[index];
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  /**
   * A NUMERIC argument as a threshold slot. An open tail is SQL NULL on the
   * wire and is held here as an empty string, keeping the slot so the surviving
   * bound stays in position. The other cases call `.toString()` directly, which
   * throws on null — they can, because their bounds are never nullable.
   */
  const argThreshold = (index: number): string => {
    const value = args[index];
    return value === null || value === undefined ? "" : value.toString();
  };

  /**
   * Every binary action takes ($data_provider, $stream_id, $timestamp, ...,
   * $frozen_at), so the timestamp is always argument 2 and frozen_at is always
   * last. Only the arguments in between change shape, and they are not all
   * thresholds: index_change_in_range carries $base_time and $time_interval
   * ahead of its two bounds.
   */
  const readQueryTime = (frozenAtIndex: number): void => {
    // Both slots have to exist for either to mean anything. A truncated
    // argument list would otherwise leave frozenAt null, which is
    // indistinguishable from the explicit ABI NULL that every well-formed
    // market carries to mean "latest" — so a malformed market would match a
    // healthy one on that component of its identity. Leaving timestamp null
    // instead hands the whole market to the caller's readability check.
    if (args.length <= frozenAtIndex) return;
    market.timestamp = argInt(2);
    market.frozenAt = argInt(frozenAtIndex);
  };

  // Map action_id to market type and thresholds
  // Based on 040-binary-attestation-actions.sql and
  // 055-index-change-attestation-action.sql
  switch (actionId) {
    case "price_above_threshold":
      market.type = "above";
      if (args.length >= 4) {
        market.thresholds.push(args[3].toString());
      }
      readQueryTime(4);
      break;
    case "price_below_threshold":
      market.type = "below";
      if (args.length >= 4) {
        market.thresholds.push(args[3].toString());
      }
      readQueryTime(4);
      break;
    case "value_in_range":
      market.type = "between";
      if (args.length >= 5) {
        market.thresholds.push(args[3].toString(), args[4].toString());
      }
      readQueryTime(5);
      break;
    case "value_equals":
      market.type = "equals";
      if (args.length >= 5) {
        market.thresholds.push(args[3].toString(), args[4].toString());
      }
      readQueryTime(5);
      break;
    case "index_change_in_range":
      // Its own type rather than "between": these bounds are half-open and
      // either may be NULL for an open tail, which "between" consumers parse as
      // a number and would reject.
      market.type = "change_between";
      if (args.length >= 7) {
        // 5 and 6, not 3 and 4: $base_time and $time_interval come first.
        market.thresholds.push(argThreshold(5), argThreshold(6));
      }
      readQueryTime(7);
      break;
  }

  return market;
}

/**
 * A decoded `create_market` transaction: its five action arguments turned into structured fields,
 * with the ABI-encoded `query_components` further decoded into {@link MarketData}. Returned by
 * {@link decodeCreateMarketPayload}.
 */
export interface CreateMarketPayload {
  /** Collateral bridge namespace, e.g. `"eth_usdc"` / `"hoodi_tt2"`. */
  bridge: string;
  /** The raw ABI-encoded query_components bytes (kept for hashing / re-decoding). */
  queryComponents: Uint8Array;
  /**
   * The query_components decoded into a market type and its thresholds, or `null` when they can't
   * be decoded — a committed-but-execution-failed create_market can carry empty/garbage
   * query_components, and an explorer should still see the top-level fields.
   */
  market: DecodedMarketData | null;
  /** Unix timestamp at which the market settles. */
  settleTime: number;
  /** Maximum bid-ask spread allowed, in cents. */
  maxSpread: number;
  /** Minimum order size in the bridge token's base units (string to avoid precision loss). */
  minOrderSize: string;
}

/** The on-chain action name whose payload {@link decodeCreateMarketPayload} understands. */
const CREATE_MARKET_ACTION = "create_market";

/**
 * Decodes a `create_market` transaction (as returned by `TransactionAction.getTransactionInput`)
 * into a structured {@link CreateMarketPayload}, including the market details nested inside its
 * ABI-encoded `query_components` argument.
 *
 * This is the transaction-level counterpart to `OrderbookAction.createMarket`: it knows
 * create_market's argument order (`$bridge, $query_components, $settle_time, $max_spread,
 * $min_order_size`), so a block explorer or indexer reading the transaction doesn't have to.
 *
 * @param payload - A decoded execute payload from `getTransactionInput` / `decodeTransactionPayload`.
 * @returns The structured market creation, or `null` if `payload` is not a create_market call.
 *   Its `market` field is `null` when the query_components can't be decoded (e.g. a
 *   committed-but-failed create_market with empty/garbage components).
 * @throws If the call is a create_market but does not carry its five expected arguments.
 *
 * @example
 * ```typescript
 * const payload = await client.loadTransactionAction().getTransactionInput({ txId });
 * const created = decodeCreateMarketPayload(payload);
 * if (created) {
 *   console.log(created.market.type, created.market.thresholds, created.settleTime);
 * }
 * ```
 */
export function decodeCreateMarketPayload(
  payload: DecodedTransactionPayload
): CreateMarketPayload | null {
  if (payload.action !== CREATE_MARKET_ACTION) {
    return null;
  }

  const call = payload.arguments[0];
  if (!call || call.length < 5) {
    throw new Error(
      `create_market payload must carry 5 arguments ` +
        `($bridge, $query_components, $settle_time, $max_spread, $min_order_size), ` +
        `got ${call?.length ?? 0}`
    );
  }

  const [bridge, queryComponents, settleTime, maxSpread, minOrderSize] = call;
  const queryComponentsBytes = dbBytesToUint8Array(
    queryComponents as string | Uint8Array
  );

  let market: DecodedMarketData | null;
  try {
    market = decodeMarketData(queryComponentsBytes);
  } catch {
    // Non-fatal: a committed-but-execution-failed create_market can carry empty/garbage
    // query_components. Surface the top-level fields with a null market rather than crashing.
    market = null;
  }

  return {
    bridge: String(bridge),
    queryComponents: queryComponentsBytes,
    market,
    settleTime: Number(settleTime),
    maxSpread: Number(maxSpread),
    minOrderSize: String(minOrderSize),
  };
}

/**
 * Encodes action arguments for order book queries using Kwil's native encoding.
 *
 * @param dataProvider - Data provider's Ethereum address
 * @param streamId - Stream ID (32 characters)
 * @param timestamp - Unix timestamp for price/value check
 * @param threshold - Threshold value (as decimal string, e.g., "50000.00")
 * @param frozenAt - Block height for data snapshot (0 for latest)
 * @returns Kwil-encoded bytes compatible with call_dispatch
 *
 * @example
 * ```typescript
 * const args = encodeActionArgs(
 *   "0x1234567890abcdef1234567890abcdef12345678",
 *   "my_stream_id____________________", // 32 chars
 *   1700000000,
 *   "50000.00",
 *   0
 * );
 * ```
 */
export function encodeActionArgs(
  dataProvider: string,
  streamId: string,
  timestamp: number,
  threshold: string,
  frozenAt: number
): Uint8Array {
  // Use Kwil's native encoding format which is compatible with call_dispatch
  // The price_above_threshold action expects: ($data_provider TEXT, $stream_id TEXT, $timestamp INT8, $threshold NUMERIC(36, 18), $frozen_at INT8)
  return encodeActionArgsKwil(
    [
      dataProvider.toLowerCase(),  // TEXT: data provider address
      streamId,                    // TEXT: stream ID
      timestamp,                   // INT8: timestamp
      threshold,                   // NUMERIC: threshold - must specify type explicitly
      frozenAt === 0 ? null : frozenAt,  // INT8: frozen_at (null for latest)
    ],
    {
      // Argument 3 (threshold) must be NUMERIC(36, 18) to match price_above_threshold action signature
      3: Utils.DataType.Numeric(36, 18),
    }
  );
}

/**
 * Encodes action arguments for range-based markets using Kwil's native encoding.
 *
 * @param dataProvider - Data provider's Ethereum address
 * @param streamId - Stream ID
 * @param timestamp - Unix timestamp
 * @param minValue - Minimum value of range
 * @param maxValue - Maximum value of range
 * @param frozenAt - Block height (0 for latest)
 * @returns Kwil-encoded bytes compatible with call_dispatch
 */
export function encodeRangeActionArgs(
  dataProvider: string,
  streamId: string,
  timestamp: number,
  minValue: string,
  maxValue: string,
  frozenAt: number
): Uint8Array {
  // value_in_range expects: ($data_provider TEXT, $stream_id TEXT, $timestamp INT8, $min_value NUMERIC, $max_value NUMERIC, $frozen_at INT8)
  return encodeActionArgsKwil(
    [
      dataProvider.toLowerCase(),
      streamId,
      timestamp,
      minValue,
      maxValue,
      frozenAt === 0 ? null : frozenAt,
    ],
    {
      // Arguments 3, 4 (minValue, maxValue) must be NUMERIC(36, 18)
      3: Utils.DataType.Numeric(36, 18),
      4: Utils.DataType.Numeric(36, 18),
    }
  );
}

/**
 * Encodes action arguments for value equals markets using Kwil's native encoding.
 *
 * @param dataProvider - Data provider's Ethereum address
 * @param streamId - Stream ID
 * @param timestamp - Unix timestamp
 * @param targetValue - Target value
 * @param tolerance - Acceptable tolerance
 * @param frozenAt - Block height (0 for latest)
 * @returns Kwil-encoded bytes compatible with call_dispatch
 */
export function encodeEqualsActionArgs(
  dataProvider: string,
  streamId: string,
  timestamp: number,
  targetValue: string,
  tolerance: string,
  frozenAt: number
): Uint8Array {
  // value_equals expects: ($data_provider TEXT, $stream_id TEXT, $timestamp INT8, $target NUMERIC, $tolerance NUMERIC, $frozen_at INT8)
  return encodeActionArgsKwil(
    [
      dataProvider.toLowerCase(),
      streamId,
      timestamp,
      targetValue,
      tolerance,
      frozenAt === 0 ? null : frozenAt,
    ],
    {
      // Arguments 3, 4 (targetValue, tolerance) must be NUMERIC(36, 18)
      3: Utils.DataType.Numeric(36, 18),
      4: Utils.DataType.Numeric(36, 18),
    }
  );
}

/**
 * The scale of every NUMERIC the binary attestation actions declare.
 */
const NUMERIC_SCALE = 18;

/**
 * The greatest number of integer digits a NUMERIC(36,18) holds: 36 total digits
 * less the 18 the scale reserves.
 */
const NUMERIC_INTEGER_DIGITS = 36 - NUMERIC_SCALE;

/**
 * Renders a decimal string the way the chain stores a NUMERIC(36,18).
 *
 * The market's identity is the hash of its encoded arguments, and a bound is
 * encoded as text — so `"2"` and `"2.000000000000000000"` are two different
 * markets asking the same question. sdk-go and sdk-py both parse a bound into a
 * decimal before encoding, which renders it at full scale; passing the caller's
 * string through unchanged, as the older encoders here do, leaves a bucket
 * struck from JavaScript carrying different bytes from the same bucket struck
 * from Python.
 *
 * This closes the divergence in the bound itself. It does not, on its own, make
 * the whole argument list byte-identical across SDKs: kwil-js and kwil-db's Go
 * encoder also disagree on the metadata they attach to an INT8 and on how they
 * lay out a NULL, for every argument of every action. Those live below this
 * package.
 *
 * Accepts an optionally signed integer with an optional fractional part, and
 * nothing else. The three rejections are the cases where this rendering and the
 * Go one part company:
 *
 *  - more than 18 decimal places, which a NUMERIC(36,18) silently rounds;
 *  - more than 18 integer digits, which overflows the precision;
 *  - a non-zero magnitude below 1e-6, which Go renders in exponent form
 *    (`1E-18`) rather than as a decimal run.
 *
 * A bound too small to write as `0.000001` is not a percentage anyone strikes a
 * market on, so refusing it locally is better than encoding bytes that silently
 * fail to match.
 *
 * @param value - The bound as written by the caller, e.g. `"2"` or `"-0.5"`.
 * @param field - Argument name, used only to make the error message point somewhere.
 * @returns The same number at exactly 18 decimal places.
 * @throws If `value` is not a plain decimal, or cannot be rendered the way Go renders it.
 *
 * @internal Not part of the package's public surface.
 */
export function toCanonicalNumeric(value: string, field: string): string {
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value);
  if (!match) {
    throw new Error(
      `${field} must be a decimal number, optionally signed, with no exponent ` +
        `(e.g. "2", "-0.5"), got '${value}'`
    );
  }

  const [, sign, rawInteger, rawFraction = ""] = match;
  if (rawFraction.length > NUMERIC_SCALE) {
    throw new Error(
      `${field} carries ${rawFraction.length} decimal places; a NUMERIC(36,${NUMERIC_SCALE}) ` +
        `holds ${NUMERIC_SCALE} and would round the rest away: '${value}'`
    );
  }

  // Leading zeros are dropped before the digit count, so "007" is three digits
  // wide rather than one, and so the rendering matches Go's for the same value.
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  if (integer.length > NUMERIC_INTEGER_DIGITS) {
    throw new Error(
      `${field} needs ${integer.length} integer digits; a NUMERIC(36,${NUMERIC_SCALE}) ` +
        `holds ${NUMERIC_INTEGER_DIGITS}: '${value}'`
    );
  }

  const fraction = rawFraction.padEnd(NUMERIC_SCALE, "0");

  // Below 1e-6 Go switches to exponent form. The test is on the digits rather
  // than on Number(value), which would have already lost them.
  const isZero = integer === "0" && !/[1-9]/.test(fraction);
  if (!isZero && integer === "0" && !/[1-9]/.test(fraction.slice(0, 6))) {
    throw new Error(
      `${field} is smaller than 1e-6, which encodes in exponent form and would ` +
        `not match the same bound written from another SDK: '${value}'`
    );
  }

  // The sign survives a zero magnitude on purpose: Go renders "-0" as
  // "-0.000000000000000000", and dropping the minus here would change the bytes.
  return `${sign}${integer}.${fraction}`;
}

/**
 * Compares two canonical NUMERIC(36,18) strings as the node compares them.
 *
 * Removing the decimal point leaves the value scaled by 1e18, which is exact in
 * a BigInt and orders the way the node's NUMERIC comparison does. `Number` would
 * not: it runs out of mantissa well before 36 digits.
 */
function compareCanonicalNumeric(left: string, right: string): number {
  const scaled = (value: string): bigint => BigInt(value.replace(".", ""));
  const a = scaled(left);
  const b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Encodes action arguments for index-change markets using Kwil's native encoding.
 *
 * The order below IS the contract with the node action, which reads its
 * arguments positionally: an argument in the wrong slot produces a market that
 * attests against the wrong numbers and can never be corrected.
 *
 * @param dataProvider - Data provider's Ethereum address
 * @param streamId - Stream ID
 * @param timestamp - Unix timestamp to measure the change at
 * @param baseTime - Index base date, or null/undefined for the stream's default.
 *   Unlike `frozenAt`, 0 is not a sentinel here — it is the epoch.
 * @param timeInterval - Seconds to look back for the comparison value (e.g. 31536000 for YoY)
 * @param minChange - Lower bound in percent, inclusive; null/undefined for an open tail
 * @param maxChange - Upper bound in percent, exclusive; null/undefined for an open tail
 * @param frozenAt - Block height (0 for latest)
 * @returns Kwil-encoded bytes compatible with call_dispatch
 * @throws If both bounds are open, `timeInterval` is not a positive integer, or a
 *   bound cannot be rendered as a NUMERIC(36,18) — see {@link toCanonicalNumeric}.
 */
export function encodeIndexChangeActionArgs(
  dataProvider: string,
  streamId: string,
  timestamp: number,
  baseTime: number | null | undefined,
  timeInterval: number,
  minChange: string | null | undefined,
  maxChange: string | null | undefined,
  frozenAt: number
): Uint8Array {
  if (!Number.isInteger(timeInterval) || timeInterval <= 0) {
    throw new Error(
      `time_interval must be a positive whole number of seconds, got ${timeInterval}`
    );
  }

  // An empty string is how a decoded market holds an open tail; as an input it
  // is far more likely to be an unset variable than a deliberate one, and
  // toCanonicalNumeric would reject it with a less useful message.
  for (const [field, bound] of [
    ["min_change", minChange],
    ["max_change", maxChange],
  ] as const) {
    if (bound === "") {
      throw new Error(`${field} is empty; pass null to strike an open tail`);
    }
  }

  const min = minChange == null ? null : toCanonicalNumeric(minChange, "min_change");
  const max = maxChange == null ? null : toCanonicalNumeric(maxChange, "max_change");

  // Both tails open would describe the whole number line, which the node action
  // refuses; raising it here turns a spent transaction into a local error.
  if (min === null && max === null) {
    throw new Error("at least one of min_change or max_change is required");
  }
  // The node refuses min >= max, comparing at NUMERIC(36,18). Comparing the
  // canonical renderings rather than the caller's strings is what lets this
  // happen at the same precision: as written, "10" sorts below "9".
  if (min !== null && max !== null && compareCanonicalNumeric(min, max) >= 0) {
    throw new Error(
      `min_change must be less than max_change, got [${minChange}, ${maxChange})`
    );
  }

  // index_change_in_range expects: ($data_provider TEXT, $stream_id TEXT, $timestamp INT8,
  // $base_time INT8, $time_interval INT, $min_change NUMERIC(36,18), $max_change NUMERIC(36,18),
  // $frozen_at INT8)
  return encodeActionArgsKwil(
    [
      dataProvider.toLowerCase(),
      streamId,
      timestamp,
      baseTime ?? null,
      timeInterval,
      min,
      max,
      frozenAt === 0 ? null : frozenAt,
    ],
    {
      // Arguments 5, 6 (minChange, maxChange) must be NUMERIC(36, 18). A null
      // carrying the hint still encodes as SQL NULL, which is the open tail.
      5: Utils.DataType.Numeric(36, 18),
      6: Utils.DataType.Numeric(36, 18),
    }
  );
}

/**
 * Encodes full query components for market creation.
 *
 * The query components are ABI-encoded as a tuple:
 * (address dataProvider, bytes32 streamId, string actionId, bytes args)
 *
 * @param dataProvider - Data provider's Ethereum address
 * @param streamId - Stream ID (will be padded to 32 bytes)
 * @param actionId - Action identifier (e.g., "price_above_threshold")
 * @param args - Pre-encoded action arguments from encodeActionArgs()
 * @returns ABI-encoded query components
 *
 * @example
 * ```typescript
 * const args = encodeActionArgs(...);
 * const queryComponents = encodeQueryComponents(
 *   "0x1234567890abcdef1234567890abcdef12345678",
 *   "my_stream_id____________________",
 *   "price_above_threshold",
 *   args
 * );
 * ```
 */
export function encodeQueryComponents(
  dataProvider: string,
  streamId: string,
  actionId: string,
  args: Uint8Array
): Uint8Array {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const streamIdBytes = stringToBytes32(streamId);

  const encoded = abiCoder.encode(
    ["address", "bytes32", "string", "bytes"],
    [dataProvider, streamIdBytes, actionId, args]
  );

  return ethers.getBytes(encoded);
}

/**
 * Converts a string to bytes32, padding with zeros if needed.
 *
 * @param str - String to convert (max 32 characters)
 * @returns bytes32 as hex string
 */
export function stringToBytes32(str: string): string {
  // Convert string to UTF-8 bytes
  const bytes = ethers.toUtf8Bytes(str);

  // Ensure it's not longer than 32 bytes
  if (bytes.length > 32) {
    throw new Error(`String too long for bytes32: ${str.length} characters`);
  }

  // Pad to 32 bytes
  return ethers.zeroPadValue(bytes, 32);
}

/**
 * Converts a hex string to Uint8Array.
 *
 * @param hex - Hex string (with or without 0x prefix)
 * @returns Uint8Array
 *
 * @example
 * ```typescript
 * const bytes = hexToBytes("0x1234abcd");
 * const bytes2 = hexToBytes("1234abcd");
 * ```
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex : "0x" + hex;
  return ethers.getBytes(cleanHex);
}

/**
 * Checks if a string appears to be base64 encoded.
 *
 * @param str - String to check
 * @returns true if string appears to be base64
 */
function isBase64(str: string): boolean {
  // Remove potential 0x prefix for checking
  const s = str.startsWith("0x") ? str.slice(2) : str;
  // Base64 strings contain +, /, or = which are not valid hex
  return /[+/=]/.test(s) || !/^[0-9a-fA-F]*$/.test(s);
}

/**
 * Decodes a base64 string to Uint8Array.
 *
 * @param b64 - Base64 string (may have 0x prefix from kwil-js)
 * @returns Uint8Array
 */
function base64ToBytes(b64: string): Uint8Array {
  // Remove potential 0x prefix that kwil-js might add
  const cleanB64 = b64.startsWith("0x") ? b64.slice(2) : b64;

  // In Node.js, use Buffer
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(cleanB64, "base64"));
  }

  // In browser, use atob
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts a database bytes value (hex or base64) to Uint8Array.
 * kwil-js may return BYTEA as hex or base64 depending on version/context.
 *
 * @param value - Hex string, base64 string, or Uint8Array
 * @returns Uint8Array
 */
export function dbBytesToUint8Array(
  value: string | Uint8Array
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (typeof value === "string") {
    if (isBase64(value)) {
      return base64ToBytes(value);
    }
    return hexToBytes(value);
  }

  throw new Error(`Unexpected bytes value type: ${typeof value}`);
}

/**
 * Converts a Uint8Array to hex string with 0x prefix.
 *
 * @param bytes - Uint8Array to convert
 * @returns Hex string with 0x prefix
 *
 * @example
 * ```typescript
 * const hex = bytesToHex(new Uint8Array([0x12, 0x34]));
 * // Returns "0x1234"
 * ```
 */
export function bytesToHex(bytes: Uint8Array): string {
  return ethers.hexlify(bytes);
}

/**
 * Validates a price value for order operations.
 *
 * @param price - Price to validate (1-99)
 * @param operation - Operation name for error message
 * @throws Error if price is invalid
 */
export function validatePrice(price: number, operation: string): void {
  if (!Number.isInteger(price)) {
    throw new Error(`${operation}: Price must be an integer`);
  }
  if (price < 1 || price > 99) {
    throw new Error(`${operation}: Price must be between 1 and 99 cents`);
  }
}

/**
 * Validates an amount value for order operations.
 *
 * @param amount - Amount to validate (must be positive)
 * @param operation - Operation name for error message
 * @throws Error if amount is invalid
 */
export function validateAmount(amount: number, operation: string): void {
  if (!Number.isInteger(amount)) {
    throw new Error(`${operation}: Amount must be an integer`);
  }
  if (amount <= 0) {
    throw new Error(`${operation}: Amount must be positive`);
  }
  if (amount > 1_000_000_000) {
    throw new Error(`${operation}: Amount exceeds maximum (1,000,000,000)`);
  }
}

/**
 * Validates a bridge identifier.
 *
 * eth_usdc (USDC) and eth_truf (TRUF) are the production mainnet bridges;
 * the others are testnet / legacy aliases retained for local-node and
 * integration test use. ethereum_bridge was the legacy mainnet TRUF bridge.
 *
 * @param bridge - Bridge identifier to validate
 * @throws Error if bridge is invalid
 */
/**
 * Validates a wallet address argument for the by-wallet portfolio getters (migration 051): a
 * 20-byte hex address, with or without a 0x prefix, matching the node's get_positions_by_wallet /
 * get_collateral_by_wallet normalization.
 *
 * @param wallet - The wallet address to validate.
 * @throws Error if it is empty, not 40 hex characters (after an optional 0x prefix), or non-hex.
 */
export function validateWalletHex(wallet: string): void {
  if (!wallet) {
    throw new Error("wallet address is required");
  }
  const hex =
    wallet.startsWith("0x") || wallet.startsWith("0X") ? wallet.slice(2) : wallet;
  if (hex.length !== 40) {
    throw new Error(
      `wallet address must be 40 hex characters (after an optional 0x prefix), got ${hex.length}`
    );
  }
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) {
    throw new Error("wallet address contains invalid hex characters");
  }
}

export function validateBridge(bridge: string): void {
  const validBridges = [
    "eth_usdc",
    "eth_truf",
    "hoodi_tt2",
    "sepolia_bridge",
    "ethereum_bridge",
  ];
  if (!validBridges.includes(bridge)) {
    throw new Error(
      `Invalid bridge: ${bridge}. Must be one of: ${validBridges.join(", ")}`
    );
  }
}

/**
 * Validates max spread for market creation.
 *
 * @param maxSpread - Max spread to validate (1-50)
 * @throws Error if maxSpread is invalid
 */
export function validateMaxSpread(maxSpread: number): void {
  if (!Number.isInteger(maxSpread)) {
    throw new Error("Max spread must be an integer");
  }
  if (maxSpread < 1 || maxSpread > 50) {
    throw new Error("Max spread must be between 1 and 50 cents");
  }
}

/**
 * Validates settle time for market creation.
 *
 * @param settleTime - Unix timestamp to validate (must be in future)
 * @throws Error if settleTime is invalid
 */
export function validateSettleTime(settleTime: number): void {
  const now = Math.floor(Date.now() / 1000);
  if (settleTime <= now) {
    throw new Error("Settle time must be in the future");
  }
}

/**
 * Converts settled filter boolean to the value for Kuneiform.
 *
 * @param filter - Boolean filter (null/undefined=all, true=settled, false=active)
 * @returns Boolean or null (null=all, true/false=filter by settled status)
 */
export function settledFilterToBoolean(
  filter: boolean | null | undefined
): boolean | null {
  if (filter === null || filter === undefined) {
    return null; // All markets
  }
  return filter; // passed to `WHERE settled = $settled_filter`
}
