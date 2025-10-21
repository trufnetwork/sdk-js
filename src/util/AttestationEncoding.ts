/**
 * Argument encoding for attestation requests
 *
 * This module encodes action arguments into the canonical format expected by
 * the node's request_attestation action. It uses kwil-js's native encoding
 * to ensure perfect compatibility with kwil-db's EncodedValue.MarshalBinary() format.
 */

import { Utils, Types } from '@trufnetwork/kwil-js';

/**
 * Encodes action arguments into canonical bytes using kwil-js utilities.
 *
 * Format: [arg_count:uint32(LE)][length:uint32(LE)][encoded_arg1][length:uint32(LE)][encoded_arg2]...
 *
 * Each encoded_arg uses kwil-db's EncodedValue.MarshalBinary() format.
 *
 * @param args - Array of arguments to encode
 * @returns Encoded bytes
 * @throws Error if any argument cannot be encoded
 */
export function encodeActionArgs(args: any[]): Uint8Array {
  // Calculate total size needed
  const encodedArgs: Uint8Array[] = [];
  let totalSize = 4; // arg_count (uint32)

  // Encode each argument using kwil-js utilities
  for (let i = 0; i < args.length; i++) {
    try {
      // Convert value to EncodedValue using kwil-js
      const encodedValue: Types.EncodedValue = Utils.formatEncodedValue(args[i]);

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
 * Reads a uint32 value in little-endian format (for testing)
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
}
