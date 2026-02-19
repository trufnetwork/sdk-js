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

/**
 * Structured content of a prediction market's query components
 */
export interface MarketData {
  dataProvider: string;
  streamId: string;
  actionId: string;
  type: "above" | "below" | "between" | "equals" | "unknown";
  thresholds: string[];
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
export function decodeMarketData(encoded: string | Uint8Array): MarketData {
  const bytes = dbBytesToUint8Array(encoded);
  const { dataProvider, streamId, actionId, args: argsBytes } = decodeQueryComponents(bytes);
  const args = decodeActionArgs(argsBytes);

  const market: MarketData = {
    dataProvider,
    streamId,
    actionId,
    type: "unknown",
    thresholds: [],
  };

  // Map action_id to market type and thresholds
  // Based on 040-binary-attestation-actions.sql
  switch (actionId) {
    case "price_above_threshold":
      market.type = "above";
      if (args.length >= 4) {
        market.thresholds.push(args[3].toString());
      }
      break;
    case "price_below_threshold":
      market.type = "below";
      if (args.length >= 4) {
        market.thresholds.push(args[3].toString());
      }
      break;
    case "value_in_range":
      market.type = "between";
      if (args.length >= 5) {
        market.thresholds.push(args[3].toString(), args[4].toString());
      }
      break;
    case "value_equals":
      market.type = "equals";
      if (args.length >= 5) {
        market.thresholds.push(args[3].toString(), args[4].toString());
      }
      break;
  }

  return market;
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
 * @param bridge - Bridge identifier to validate
 * @throws Error if bridge is invalid
 */
export function validateBridge(bridge: string): void {
  const validBridges = ["hoodi_tt2", "sepolia_bridge", "ethereum_bridge"];
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
 * @param filter - Boolean filter (null/undefined=all, true=unsettled, false=settled)
 * @returns Boolean or null (null=all, true/false=filter by settled status)
 */
export function settledFilterToBoolean(
  filter: boolean | null | undefined
): boolean | null {
  if (filter === null || filter === undefined) {
    return null; // All markets
  }
  return filter; // true=unsettled, false=settled
}
