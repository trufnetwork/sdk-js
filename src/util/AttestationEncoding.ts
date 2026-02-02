/**
 * Argument encoding for attestation requests
 *
 * This module encodes action arguments into the canonical format expected by
 * the node's request_attestation action. It uses kwil-js's native encoding
 * to ensure perfect compatibility with kwil-db's EncodedValue.MarshalBinary() format.
 */

import { Utils, Types } from '@trufnetwork/kwil-js';
import { AbiCoder } from 'ethers';

/**
 * Type hint for specifying explicit types when encoding arguments.
 * Use Utils.DataType from kwil-js (e.g., Utils.DataType.Numeric(36, 18))
 *
 * DataInfo structure: { name: VarType, is_array: boolean, metadata?: number[] }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TypeHint = any;

/**
 * Encodes action arguments into canonical bytes using kwil-js utilities.
 *
 * Format: [arg_count:uint32(LE)][length:uint32(LE)][encoded_arg1][length:uint32(LE)][encoded_arg2]...
 *
 * Each encoded_arg uses kwil-db's EncodedValue.MarshalBinary() format.
 *
 * @param args - Array of arguments to encode
 * @param types - Optional map of argument index to type hint (for NUMERIC, etc.)
 * @returns Encoded bytes
 * @throws Error if any argument cannot be encoded
 */
export function encodeActionArgs(args: any[], types?: Record<number, TypeHint>): Uint8Array {
  // Calculate total size needed
  const encodedArgs: Uint8Array[] = [];
  let totalSize = 4; // arg_count (uint32)

  // Encode each argument using kwil-js utilities
  for (let i = 0; i < args.length; i++) {
    try {
      // Convert value to EncodedValue using kwil-js
      // If type hint is provided, use it; otherwise let kwil-js infer the type
      const typeHint = types?.[i];
      const encodedValue: Types.EncodedValue = Utils.formatEncodedValue(args[i], typeHint);

      // Serialize EncodedValue to bytes using kwil-js
      const argBytes = Utils.encodeEncodedValue(encodedValue);

      encodedArgs.push(argBytes);
      totalSize += 4 + argBytes.length; // length prefix + data
    } catch (err) {
      throw new Error(`Failed to encode arg ${i}: ${err}`);
    }
  }

  // Allocate buffer
  const buffer = new Uint8Array(totalSize);
  let offset = 0;

  // Write argument count (little-endian uint32)
  writeUint32LE(buffer, args.length, offset);
  offset += 4;

  // Write each encoded argument with length prefix
  for (let i = 0; i < encodedArgs.length; i++) {
    const encodedArg = encodedArgs[i];

    // Write length (little-endian uint32)
    writeUint32LE(buffer, encodedArg.length, offset);
    offset += 4;

    // Write encoded argument bytes
    buffer.set(encodedArg, offset);
    offset += encodedArg.length;
  }

  return buffer;
}

/**
 * Writes a uint32 value in little-endian format
 * Used for writing arg count and length prefixes
 *
 * @param buffer - Target buffer
 * @param value - Value to write
 * @param offset - Offset in buffer
 */
function writeUint32LE(buffer: Uint8Array, value: number, offset: number): void {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >> 8) & 0xff;
  buffer[offset + 2] = (value >> 16) & 0xff;
  buffer[offset + 3] = (value >> 24) & 0xff;
}

/**
 * Reads a uint32 value in little-endian format
 *
 * @param buffer - Source buffer
 * @param offset - Offset in buffer
 * @returns The uint32 value
 */
export function readUint32LE(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Reads a uint16 value in little-endian format
 *
 * @param buffer - Source buffer
 * @param offset - Offset in buffer
 * @returns The uint16 value
 */
export function readUint16LE(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] | (buffer[offset + 1] << 8)) >>> 0;
}

/**
 * Reads a uint32 value in big-endian format
 *
 * @param buffer - Source buffer
 * @param offset - Offset in buffer
 * @returns The uint32 value
 */
export function readUint32BE(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] << 24) |
    (buffer[offset + 1] << 16) |
    (buffer[offset + 2] << 8) |
    buffer[offset + 3]
  ) >>> 0;
}

/**
 * Reads a uint16 value in big-endian format
 *
 * @param buffer - Source buffer
 * @param offset - Offset in buffer
 * @returns The uint16 value
 */
export function readUint16BE(buffer: Uint8Array, offset: number): number {
  return ((buffer[offset] << 8) | buffer[offset + 1]) >>> 0;
}

/**
 * Decoded data type information
 */
export interface DecodedDataType {
  name: string;
  is_array: boolean;
  metadata: number[];
}

/**
 * Decoded EncodedValue structure
 */
export interface DecodedEncodedValue {
  type: DecodedDataType;
  data: Uint8Array[];
}

/**
 * Decoded query result row
 */
export interface DecodedRow {
  values: any[];
}

/**
 * Parsed attestation payload structure
 */
export interface ParsedAttestationPayload {
  version: number;
  algorithm: number;
  blockHeight: bigint;
  dataProvider: string;
  streamId: string;
  actionId: number;
  arguments: any[];
  result: DecodedRow[];
}

/**
 * Decodes DataType from bytes (reverse of encodeDataType)
 *
 * @param buffer - Source buffer
 * @param offset - Starting offset
 * @returns Decoded data type and new offset
 */
function decodeDataType(buffer: Uint8Array, offset: number): { type: DecodedDataType; offset: number } {
  // Version (uint16 BE)
  const version = readUint16BE(buffer, offset);
  offset += 2;

  if (version !== 0) {
    throw new Error(`Unsupported DataType version: ${version}`);
  }

  // Name length (uint32 BE)
  const nameLen = readUint32BE(buffer, offset);
  offset += 4;

  // Name bytes
  const nameBytes = buffer.slice(offset, offset + nameLen);
  const name = new TextDecoder().decode(nameBytes);
  offset += nameLen;

  // is_array (1 byte boolean)
  const is_array = buffer[offset] === 1;
  offset += 1;

  // Metadata (2 x uint16 BE)
  const metadata0 = readUint16BE(buffer, offset);
  offset += 2;
  const metadata1 = readUint16BE(buffer, offset);
  offset += 2;

  return {
    type: {
      name,
      is_array,
      metadata: [metadata0, metadata1],
    },
    offset,
  };
}

/**
 * Decodes an EncodedValue from bytes (reverse of encodeEncodedValue)
 *
 * @param buffer - Source buffer containing the encoded value
 * @param offset - Starting offset (default 0)
 * @returns Decoded value and new offset
 */
export function decodeEncodedValue(
  buffer: Uint8Array,
  offset: number = 0
): { value: DecodedEncodedValue; offset: number } {
  // Version (uint16 LE)
  const version = readUint16LE(buffer, offset);
  offset += 2;

  if (version !== 0) {
    throw new Error(`Unsupported EncodedValue version: ${version}`);
  }

  // Type length (uint32 LE)
  const typeLen = readUint32LE(buffer, offset);
  offset += 4;

  // Type bytes
  const typeBytes = buffer.slice(offset, offset + typeLen);
  const { type } = decodeDataType(typeBytes, 0);
  offset += typeLen;

  // Data array length (uint16 LE)
  const dataLen = readUint16LE(buffer, offset);
  offset += 2;

  // Data items
  const data: Uint8Array[] = [];
  for (let i = 0; i < dataLen; i++) {
    // Data item length (uint32 LE)
    const itemLen = readUint32LE(buffer, offset);
    offset += 4;

    // Data item bytes
    const itemBytes = buffer.slice(offset, offset + itemLen);
    data.push(itemBytes);
    offset += itemLen;
  }

  return {
    value: { type, data },
    offset,
  };
}

/**
 * Converts a decoded EncodedValue to a JavaScript value
 *
 * @param decoded - Decoded EncodedValue
 * @returns JavaScript value (string, number, boolean, null, Uint8Array, or array)
 */
export function decodedValueToJS(decoded: DecodedEncodedValue): any {
  // Handle NULL values (data array is empty or first item indicates null)
  if (decoded.data.length === 0) {
    return null;
  }

  // Check the null indicator (first byte of first data item)
  const firstItem = decoded.data[0];
  if (firstItem.length === 0 || firstItem[0] === 0) {
    return null;
  }

  // Extract actual value bytes (skip null indicator byte)
  const valueBytes = firstItem.slice(1);

  // Decode based on type name
  const typeName = decoded.type.name.toLowerCase();

  if (decoded.type.is_array) {
    // Handle array types
    const result: any[] = [];
    for (const item of decoded.data) {
      if (item.length === 0 || item[0] === 0) {
        result.push(null);
      } else {
        const itemBytes = item.slice(1);
        result.push(decodeSingleValue(typeName, itemBytes));
      }
    }
    return result;
  }

  // Handle scalar types
  return decodeSingleValue(typeName, valueBytes);
}

/**
 * Decodes a single value based on type name
 */
function decodeSingleValue(typeName: string, bytes: Uint8Array): any {
  switch (typeName) {
    case 'text':
    case 'uuid':
      return new TextDecoder().decode(bytes);

    case 'int':
    case 'int8':
    case 'integer':
      // Decode as 8-byte signed int64 (big-endian as per kwil-db)
      if (bytes.length === 8) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        // Use getBigInt64 to properly decode signed int64
        return view.getBigInt64(0, false); // false = big-endian
      }
      throw new Error(`Invalid integer byte length: expected 8, got ${bytes.length}`);

    case 'bool':
    case 'boolean':
      return bytes.length > 0 && bytes[0] === 1;

    case 'numeric':
    case 'decimal':
      return new TextDecoder().decode(bytes);

    case 'bytea':
    case 'blob':
      return bytes;

    default:
      // Unknown type, return as string if possible
      try {
        return new TextDecoder().decode(bytes);
      } catch {
        return bytes;
      }
  }
}

/**
 * Decodes canonical query result bytes into rows and columns
 *
 * Format:
 * [row_count: uint32 LE]
 *   [col_count: uint32 LE]
 *     [col_len: uint32 LE][col_bytes: EncodedValue.MarshalBinary()]
 *     ...
 *   [col_count: uint32 LE]
 *     ...
 *
 * @param data - Canonical query result bytes
 * @returns Array of decoded rows
 */
export function decodeCanonicalQueryResult(data: Uint8Array): DecodedRow[] {
  let offset = 0;

  // Row count (uint32 LE)
  if (data.length < 4) {
    throw new Error('Data too short for row count');
  }

  const rowCount = readUint32LE(data, offset);
  offset += 4;

  const rows: DecodedRow[] = [];

  for (let i = 0; i < rowCount; i++) {
    // Column count (uint32 LE)
    if (offset + 4 > data.length) {
      throw new Error(`Data too short for column count at row ${i}`);
    }

    const colCount = readUint32LE(data, offset);
    offset += 4;

    const values: any[] = [];

    for (let j = 0; j < colCount; j++) {
      // Column length (uint32 LE)
      if (offset + 4 > data.length) {
        throw new Error(`Data too short for column ${j} length at row ${i}`);
      }

      const colLen = readUint32LE(data, offset);
      offset += 4;

      // Column bytes
      if (offset + colLen > data.length) {
        throw new Error(`Data too short for column ${j} bytes at row ${i}`);
      }

      const colBytes = data.slice(offset, offset + colLen);

      // Decode the EncodedValue
      const { value: decodedValue } = decodeEncodedValue(colBytes, 0);

      // Convert to JavaScript value
      const jsValue = decodedValueToJS(decodedValue);
      values.push(jsValue);

      offset += colLen;
    }

    rows.push({ values });
  }

  return rows;
}

/**
 * Decodes ABI-encoded datapoints result (timestamps and values)
 *
 * Format: abi.encode(uint256[] timestamps, int256[] values)
 *
 * @param data - ABI-encoded bytes
 * @returns Array of decoded rows with [timestamp, value] pairs
 */
export function decodeABIDatapoints(data: Uint8Array): DecodedRow[] {
  // Handle empty data
  if (!data || data.length === 0) {
    return [];
  }

  const abiCoder = AbiCoder.defaultAbiCoder();

  try {
    // Decode as (uint256[], int256[])
    const decoded = abiCoder.decode(
      ['uint256[]', 'int256[]'],
      data
    );

    const timestamps = decoded[0] as bigint[];
    const values = decoded[1] as bigint[];

    if (timestamps.length !== values.length) {
      throw new Error(`Timestamp/value array length mismatch: ${timestamps.length} vs ${values.length}`);
    }

    const rows: DecodedRow[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      rows.push({
        values: [
          timestamps[i].toString(),
          // Convert from 18-decimal fixed point to decimal string
          formatFixedPoint(values[i], 18)
        ]
      });
    }

    return rows;
  } catch (err) {
    throw new Error(`Failed to decode ABI datapoints: ${err}`);
  }
}

/**
 * Formats a fixed-point integer value to decimal string
 *
 * @param value - BigInt value with fixed decimals
 * @param decimals - Number of decimal places
 * @returns Formatted decimal string
 */
function formatFixedPoint(value: bigint, decimals: number): string {
  const isNegative = value < 0n;
  const absValue = isNegative ? -value : value;

  const divisor = 10n ** BigInt(decimals);
  const integerPart = absValue / divisor;
  const fractionalPart = absValue % divisor;

  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

  // Remove trailing zeros from fractional part
  const trimmedFractional = fractionalStr.replace(/0+$/, '');

  if (trimmedFractional === '') {
    return `${isNegative ? '-' : ''}${integerPart}`;
  }

  return `${isNegative ? '-' : ''}${integerPart}.${trimmedFractional}`;
}

/**
 * Parses a canonical attestation payload (without signature)
 *
 * Payload format:
 * 1. Version (1 byte)
 * 2. Algorithm (1 byte, 0 = secp256k1)
 * 3. Block height (8 bytes, uint64 big-endian)
 * 4. Data provider (length-prefixed with 4 bytes big-endian)
 * 5. Stream ID (length-prefixed with 4 bytes big-endian)
 * 6. Action ID (2 bytes, uint16 big-endian)
 * 7. Arguments (length-prefixed with 4 bytes big-endian)
 * 8. Result (length-prefixed with 4 bytes big-endian)
 *
 * @param payload - Canonical payload bytes (without 65-byte signature)
 * @returns Parsed payload structure
 */
export function parseAttestationPayload(payload: Uint8Array): ParsedAttestationPayload {
  let offset = 0;

  // 1. Version (1 byte)
  if (payload.length < 1) {
    throw new Error('Payload too short for version');
  }
  const version = payload[offset];
  offset += 1;

  // 2. Algorithm (1 byte)
  if (offset >= payload.length) {
    throw new Error('Payload too short for algorithm');
  }
  const algorithm = payload[offset];
  offset += 1;

  // 3. Block height (8 bytes, uint64 big-endian)
  if (offset + 8 > payload.length) {
    throw new Error('Payload too short for block height');
  }
  const blockHeightHigh = readUint32BE(payload, offset);
  const blockHeightLow = readUint32BE(payload, offset + 4);
  const blockHeight = (BigInt(blockHeightHigh) << 32n) | BigInt(blockHeightLow);
  offset += 8;

  // 4. Data provider (length-prefixed, 4 bytes big-endian)
  if (offset + 4 > payload.length) {
    throw new Error('Payload too short for data provider length');
  }
  const dataProviderLen = readUint32BE(payload, offset);
  offset += 4;

  if (offset + dataProviderLen > payload.length) {
    throw new Error('Payload too short for data provider');
  }
  const dataProviderBytes = payload.slice(offset, offset + dataProviderLen);
  // Data provider is typically a hex address (20 bytes for Ethereum address)
  // Try to decode as UTF-8 first, if it looks like a hex string keep it
  // Otherwise convert bytes to hex
  let dataProvider: string;
  if (dataProviderLen === 20) {
    // Likely an Ethereum address (20 bytes)
    dataProvider = '0x' + Array.from(dataProviderBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Try UTF-8 decoding
    try {
      const decoded = new TextDecoder().decode(dataProviderBytes);
      // Check if it looks like a hex address string (starts with "0x")
      if (decoded.startsWith('0x') && /^0x[0-9a-fA-F]+$/.test(decoded)) {
        dataProvider = decoded;
      } else {
        // Assume it's a valid UTF-8 string
        dataProvider = decoded;
      }
    } catch {
      // Fallback to hex
      dataProvider = '0x' + Array.from(dataProviderBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }
  offset += dataProviderLen;

  // 5. Stream ID (length-prefixed, 4 bytes big-endian)
  if (offset + 4 > payload.length) {
    throw new Error('Payload too short for stream ID length');
  }
  const streamIdLen = readUint32BE(payload, offset);
  offset += 4;

  if (offset + streamIdLen > payload.length) {
    throw new Error('Payload too short for stream ID');
  }
  const streamIdBytes = payload.slice(offset, offset + streamIdLen);
  const streamId = new TextDecoder().decode(streamIdBytes);
  offset += streamIdLen;

  // 6. Action ID (2 bytes, uint16 big-endian)
  if (offset + 2 > payload.length) {
    throw new Error('Payload too short for action ID');
  }
  const actionId = readUint16BE(payload, offset);
  offset += 2;

  // 7. Arguments (length-prefixed, 4 bytes big-endian)
  if (offset + 4 > payload.length) {
    throw new Error('Payload too short for arguments length');
  }
  const argsLen = readUint32BE(payload, offset);
  offset += 4;

  if (offset + argsLen > payload.length) {
    throw new Error('Payload too short for arguments');
  }
  const argsBytes = payload.slice(offset, offset + argsLen);
  offset += argsLen;

  // Decode arguments
  let args: any[] = [];
  if (argsLen > 0) {
    let argsOffset = 0;

    // Arguments format: [arg_count: uint32 LE][length: uint32 LE][encoded_arg]...
    const argCount = readUint32LE(argsBytes, argsOffset);
    argsOffset += 4;

    for (let i = 0; i < argCount; i++) {
      const argLen = readUint32LE(argsBytes, argsOffset);
      argsOffset += 4;

      const argBytes = argsBytes.slice(argsOffset, argsOffset + argLen);
      const { value: decodedArg } = decodeEncodedValue(argBytes, 0);
      args.push(decodedValueToJS(decodedArg));
      argsOffset += argLen;
    }
  }

  // 8. Result (length-prefixed, 4 bytes big-endian)
  if (offset + 4 > payload.length) {
    throw new Error('Payload too short for result length');
  }
  const resultLen = readUint32BE(payload, offset);
  offset += 4;

  if (offset + resultLen > payload.length) {
    throw new Error('Payload too short for result');
  }
  const resultBytes = payload.slice(offset, offset + resultLen);

  // Decode result (ABI-encoded as uint256[], int256[])
  const result = decodeABIDatapoints(resultBytes);

  return {
    version,
    algorithm,
    blockHeight,
    dataProvider,
    streamId,
    actionId,
    arguments: args,
    result,
  };
}

// Inline unit tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('encodeActionArgs', () => {
    it('should encode empty args', () => {
      const encoded = encodeActionArgs([]);
      expect(encoded.length).toBe(4); // Just arg_count
      expect(readUint32LE(encoded, 0)).toBe(0);
    });

    it('should encode single string arg', () => {
      const encoded = encodeActionArgs(['hello']);
      expect(encoded.length).toBeGreaterThan(4);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1

      // Check length prefix and data
      const argLen = readUint32LE(encoded, 4);
      expect(argLen).toBeGreaterThan(0);
    });

    it('should encode single number arg', () => {
      const encoded = encodeActionArgs([42]);
      expect(encoded.length).toBeGreaterThan(4);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1
    });

    it('should encode null arg', () => {
      const encoded = encodeActionArgs([null]);
      expect(encoded.length).toBeGreaterThan(4);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1

      // kwil-js handles null encoding internally
      const argLen = readUint32LE(encoded, 4);
      expect(argLen).toBeGreaterThan(0);
    });

    it('should encode boolean arg', () => {
      const encoded = encodeActionArgs([true]);
      expect(encoded.length).toBeGreaterThan(4);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1
    });

    it('should encode Uint8Array arg', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const encoded = encodeActionArgs([bytes]);
      expect(encoded.length).toBeGreaterThan(4);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1
    });

    it('should encode multiple args of different types', () => {
      const encoded = encodeActionArgs(['hello', 42, true, null]);
      expect(readUint32LE(encoded, 0)).toBe(4); // arg_count = 4
      expect(encoded.length).toBeGreaterThan(4);
    });

    it('should encode real-world get_record args', () => {
      const dataProvider = '0x4710a8d8f0d845da110086812a32de6d90d7ff5c';
      const streamId = 'stai0000000000000000000000000000';
      const fromTime = 1234567890;
      const toTime = 1234567900;
      const frozenAt = null;
      const useCache = false;

      const encoded = encodeActionArgs([
        dataProvider,
        streamId,
        fromTime,
        toTime,
        frozenAt,
        useCache,
      ]);

      expect(readUint32LE(encoded, 0)).toBe(6); // arg_count = 6
      expect(encoded.length).toBeGreaterThan(4);
    });

    it('should handle large strings', () => {
      const largeString = 'a'.repeat(10000);
      const encoded = encodeActionArgs([largeString]);
      expect(readUint32LE(encoded, 0)).toBe(1);
      expect(encoded.length).toBeGreaterThan(10000);
    });

    it('should encode array args', () => {
      const encoded = encodeActionArgs([['a', 'b', 'c']]);
      expect(readUint32LE(encoded, 0)).toBe(1); // arg_count = 1
      expect(encoded.length).toBeGreaterThan(4);
    });
  });

  describe('writeUint32LE and readUint32LE', () => {
    it('should round-trip uint32 values', () => {
      const buffer = new Uint8Array(4);
      const testValues = [0, 1, 255, 256, 65535, 16777215, 4294967295];

      for (const value of testValues) {
        writeUint32LE(buffer, value, 0);
        const read = readUint32LE(buffer, 0);
        expect(read).toBe(value);
      }
    });

    it('should use little-endian byte order', () => {
      const buffer = new Uint8Array(4);
      writeUint32LE(buffer, 0x12345678, 0);
      expect(buffer[0]).toBe(0x78);
      expect(buffer[1]).toBe(0x56);
      expect(buffer[2]).toBe(0x34);
      expect(buffer[3]).toBe(0x12);
    });
  });

  describe('readUint16LE and readUint16BE', () => {
    it('should read uint16 little-endian correctly', () => {
      const buffer = new Uint8Array([0x78, 0x56]);
      expect(readUint16LE(buffer, 0)).toBe(0x5678);
    });

    it('should read uint16 big-endian correctly', () => {
      const buffer = new Uint8Array([0x56, 0x78]);
      expect(readUint16BE(buffer, 0)).toBe(0x5678);
    });
  });

  describe('readUint32BE', () => {
    it('should read uint32 big-endian correctly', () => {
      const buffer = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
      expect(readUint32BE(buffer, 0)).toBe(0x12345678);
    });
  });

  describe('decodeCanonicalQueryResult', () => {
    it('should decode empty result (0 rows)', () => {
      const buffer = new Uint8Array(4);
      writeUint32LE(buffer, 0, 0); // row count = 0

      const result = decodeCanonicalQueryResult(buffer);
      expect(result.length).toBe(0);
    });

    it('should throw on invalid data', () => {
      const buffer = new Uint8Array(2); // Too short
      expect(() => decodeCanonicalQueryResult(buffer)).toThrow('Data too short for row count');
    });
  });

  describe('parseAttestationPayload', () => {
    it.todo('should parse payload with ABI-encoded result (TODO: need to construct synthetic test data with valid ABI encoding - see examples/attestation/index.ts for working integration test)');

    it('should throw on invalid version', () => {
      const payload = new Uint8Array(1);
      expect(() => parseAttestationPayload(payload)).toThrow();
    });
  });
}
