import { describe, it, expect } from "vitest";
import {
  encodeActionArgs,
  encodeQueryComponents,
  encodeRangeActionArgs,
  encodeEqualsActionArgs,
  stringToBytes32,
  hexToBytes,
  bytesToHex,
  validatePrice,
  validateAmount,
  validateBridge,
  validateMaxSpread,
  validateSettleTime,
  settledFilterToBoolean,
} from "./orderbookHelpers";

// Valid 32-character stream ID for testing
const TEST_STREAM_ID = "stbtc000000000000000000000000000"; // exactly 32 chars
const TEST_DATA_PROVIDER = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";

describe("orderbookHelpers", () => {
  describe("stringToBytes32", () => {
    it("should convert a short string to bytes32", () => {
      const result = stringToBytes32("test");
      expect(result).toMatch(/^0x/);
      expect(result.length).toBe(66); // 0x + 64 hex chars
    });

    it("should convert a 32-char string to bytes32", () => {
      const str = "abcdefghijklmnopqrstuvwxyz123456";
      expect(str.length).toBe(32);
      const result = stringToBytes32(str);
      expect(result).toMatch(/^0x/);
      expect(result.length).toBe(66);
    });

    it("should throw for strings longer than 32 bytes", () => {
      const longStr = "a".repeat(33);
      expect(() => stringToBytes32(longStr)).toThrow("String too long");
    });
  });

  describe("hexToBytes", () => {
    it("should convert hex string with 0x prefix", () => {
      const result = hexToBytes("0x1234");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(0x12);
      expect(result[1]).toBe(0x34);
    });

    it("should convert hex string without 0x prefix", () => {
      const result = hexToBytes("abcd");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(2);
      expect(result[0]).toBe(0xab);
      expect(result[1]).toBe(0xcd);
    });
  });

  describe("bytesToHex", () => {
    it("should convert Uint8Array to hex string with 0x prefix", () => {
      const bytes = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
      const result = bytesToHex(bytes);
      expect(result).toBe("0x1234abcd");
    });

    it("should handle empty array", () => {
      const bytes = new Uint8Array([]);
      const result = bytesToHex(bytes);
      expect(result).toBe("0x");
    });
  });

  describe("validatePrice", () => {
    it("should accept valid prices (1-99)", () => {
      expect(() => validatePrice(1, "test")).not.toThrow();
      expect(() => validatePrice(50, "test")).not.toThrow();
      expect(() => validatePrice(99, "test")).not.toThrow();
    });

    it("should reject price 0", () => {
      expect(() => validatePrice(0, "test")).toThrow("between 1 and 99");
    });

    it("should reject price 100", () => {
      expect(() => validatePrice(100, "test")).toThrow("between 1 and 99");
    });

    it("should reject negative prices", () => {
      expect(() => validatePrice(-1, "test")).toThrow("between 1 and 99");
    });

    it("should reject non-integer prices", () => {
      expect(() => validatePrice(50.5, "test")).toThrow("must be an integer");
    });
  });

  describe("validateAmount", () => {
    it("should accept valid amounts", () => {
      expect(() => validateAmount(1, "test")).not.toThrow();
      expect(() => validateAmount(1000000, "test")).not.toThrow();
    });

    it("should reject zero amount", () => {
      expect(() => validateAmount(0, "test")).toThrow("must be positive");
    });

    it("should reject negative amounts", () => {
      expect(() => validateAmount(-1, "test")).toThrow("must be positive");
    });

    it("should reject amounts over 1 billion", () => {
      expect(() => validateAmount(1_000_000_001, "test")).toThrow("exceeds maximum");
    });

    it("should reject non-integer amounts", () => {
      expect(() => validateAmount(10.5, "test")).toThrow("must be an integer");
    });
  });

  describe("validateBridge", () => {
    it("should accept valid bridges", () => {
      expect(() => validateBridge("hoodi_tt2")).not.toThrow();
      expect(() => validateBridge("sepolia_bridge")).not.toThrow();
      expect(() => validateBridge("ethereum_bridge")).not.toThrow();
    });

    it("should reject invalid bridges", () => {
      expect(() => validateBridge("invalid")).toThrow("Invalid bridge");
      expect(() => validateBridge("")).toThrow("Invalid bridge");
    });
  });

  describe("validateMaxSpread", () => {
    it("should accept valid spreads (1-50)", () => {
      expect(() => validateMaxSpread(1)).not.toThrow();
      expect(() => validateMaxSpread(25)).not.toThrow();
      expect(() => validateMaxSpread(50)).not.toThrow();
    });

    it("should reject spread 0", () => {
      expect(() => validateMaxSpread(0)).toThrow("between 1 and 50");
    });

    it("should reject spread over 50", () => {
      expect(() => validateMaxSpread(51)).toThrow("between 1 and 50");
    });
  });

  describe("validateSettleTime", () => {
    it("should accept future timestamps", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      expect(() => validateSettleTime(futureTime)).not.toThrow();
    });

    it("should reject past timestamps", () => {
      const pastTime = Math.floor(Date.now() / 1000) - 3600;
      expect(() => validateSettleTime(pastTime)).toThrow("must be in the future");
    });

    it("should reject current timestamp", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(() => validateSettleTime(now)).toThrow("must be in the future");
    });
  });

  describe("settledFilterToBoolean", () => {
    it("should return null for null (all markets)", () => {
      expect(settledFilterToBoolean(null)).toBe(null);
    });

    it("should return null for undefined (all markets)", () => {
      expect(settledFilterToBoolean(undefined)).toBe(null);
    });

    it("should return true for true (unsettled)", () => {
      expect(settledFilterToBoolean(true)).toBe(true);
    });

    it("should return false for false (settled)", () => {
      expect(settledFilterToBoolean(false)).toBe(false);
    });
  });

  describe("encodeActionArgs", () => {
    it("should encode action arguments", () => {
      const result = encodeActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        "50000.00",
        1000
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should produce consistent output for same input", () => {
      const args = [
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        "50000.00",
        1000,
      ] as const;

      const result1 = encodeActionArgs(...args);
      const result2 = encodeActionArgs(...args);

      expect(bytesToHex(result1)).toBe(bytesToHex(result2));
    });
  });

  describe("encodeQueryComponents", () => {
    it("should encode query components", () => {
      const args = encodeActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        "50000.00",
        1000
      );

      const result = encodeQueryComponents(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        "price_above_threshold",
        args
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(args.length);
    });
  });

  describe("encodeRangeActionArgs", () => {
    it("should encode range action arguments", () => {
      const result = encodeRangeActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        "45000.00",
        "55000.00",
        1000
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("encodeEqualsActionArgs", () => {
    it("should encode equals action arguments", () => {
      const result = encodeEqualsActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        "50000.00",
        "100.00",
        1000
      );

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("decodeMarketData", () => {
    const importHelper = async () => {
        const { decodeMarketData } = await import("./orderbookHelpers");
        return { decodeMarketData };
    };

    it("should round-trip price_above_threshold", async () => {
      const { decodeMarketData } = await importHelper();
      const threshold = "100000.0";
      const args = encodeActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        threshold,
        0
      );

      const encoded = encodeQueryComponents(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        "price_above_threshold",
        args
      );

      const decoded = decodeMarketData(encoded);
      expect(decoded.type).toBe("above");
      expect(decoded.thresholds[0]).toBe(threshold);
      expect(decoded.dataProvider).toBe(TEST_DATA_PROVIDER.toLowerCase());
      expect(decoded.streamId).toBe(TEST_STREAM_ID);
    });

    it("should round-trip price_below_threshold", async () => {
        const { decodeMarketData } = await importHelper();
        const threshold = "4.5";
        const args = encodeActionArgs(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          1700000000,
          threshold,
          0
        );
  
        const encoded = encodeQueryComponents(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          "price_below_threshold",
          args
        );
  
        const decoded = decodeMarketData(encoded);
        expect(decoded.type).toBe("below");
        expect(decoded.thresholds[0]).toBe(threshold);
    });

    it("should round-trip value_in_range", async () => {
        const { decodeMarketData } = await importHelper();
        const min = "90000.0";
        const max = "110000.0";
        const args = encodeRangeActionArgs(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          1700000000,
          min,
          max,
          0
        );
  
        const encoded = encodeQueryComponents(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          "value_in_range",
          args
        );
  
        const decoded = decodeMarketData(encoded);
        expect(decoded.type).toBe("between");
        expect(decoded.thresholds).toEqual([min, max]);
    });

    it("should round-trip value_equals", async () => {
        const { decodeMarketData } = await importHelper();
        const target = "5.25";
        const tolerance = "0.01";
        const args = encodeEqualsActionArgs(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          1700000000,
          target,
          tolerance,
          0
        );
  
        const encoded = encodeQueryComponents(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          "value_equals",
          args
        );
  
        const decoded = decodeMarketData(encoded);
        expect(decoded.type).toBe("equals");
        expect(decoded.thresholds).toEqual([target, tolerance]);
    });
  });
});
