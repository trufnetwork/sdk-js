import { describe, it, expect } from "vitest";
import {
  encodeActionArgs,
  encodeQueryComponents,
  encodeRangeActionArgs,
  encodeEqualsActionArgs,
  encodeIndexChangeActionArgs,
  toCanonicalNumeric,
  stringToBytes32,
  hexToBytes,
  bytesToHex,
  validatePrice,
  validateAmount,
  validateBridge,
  validateMaxSpread,
  validateSettleTime,
  settledFilterToBoolean,
  decodeCreateMarketPayload,
} from "./orderbookHelpers";
import type { DecodedTransactionPayload } from "./TransactionPayload";
import {
  decodeEncodedValue,
  encodeActionArgs as encodeKwilArgs,
  readUint32LE,
} from "./AttestationEncoding";
import { Utils } from "@trufnetwork/kwil-js";

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

  describe("toCanonicalNumeric", () => {
    // Expected values produced by kwil-db's NUMERIC(36,18) renderer
    // (types.ParseDecimalExplicit(v, 36, 18).String()), which is what sdk-go and
    // sdk-py encode. The market hash is over these bytes, so a divergence here
    // means the same bucket struck from two SDKs is two different markets.
    const asGoRendersIt: [string, string][] = [
      ["0", "0.000000000000000000"],
      ["2", "2.000000000000000000"],
      ["2.5", "2.500000000000000000"],
      ["-0.5", "-0.500000000000000000"],
      ["10", "10.000000000000000000"],
      ["9", "9.000000000000000000"],
      ["1.335", "1.335000000000000000"],
      ["-33.659022158930734676", "-33.659022158930734676"],
      ["0.000001", "0.000001000000000000"],
      ["-0.000001", "-0.000001000000000000"],
      ["12.3456789012345678", "12.345678901234567800"],
      ["999999999999999999.999999999999999999", "999999999999999999.999999999999999999"],
      // Rendered from the value, not copied from the input: leading zeros go,
      // a bare trailing point is fine, and a negative zero keeps its sign.
      ["007", "7.000000000000000000"],
      ["2.", "2.000000000000000000"],
      ["-0", "-0.000000000000000000"],
    ];

    it.each(asGoRendersIt)("renders %s as the chain stores it", (input, expected) => {
      expect(toCanonicalNumeric(input, "bound")).toBe(expected);
    });

    it("rejects more decimal places than a NUMERIC(36,18) holds", () => {
      // Go rounds this away silently; refusing it locally means the bound that
      // gets encoded is always the bound that was written.
      expect(() => toCanonicalNumeric("0.0000000000000000001", "min_change")).toThrow(
        /min_change carries 19 decimal places/
      );
    });

    it("rejects a magnitude past the precision", () => {
      expect(() => toCanonicalNumeric("1000000000000000000", "max_change")).toThrow(
        /max_change needs 19 integer digits/
      );
    });

    it("rejects a value below 1e-6, which Go renders in exponent form", () => {
      // Go gives "1.00000000000E-7" here, so padding to 18 places would encode
      // different bytes for the same number.
      expect(() => toCanonicalNumeric("0.0000001", "min_change")).toThrow(/exponent form/);
      // ...but a zero is not "below 1e-6": Go renders it as a decimal run.
      expect(() => toCanonicalNumeric("0.000000000000000000", "min_change")).not.toThrow();
    });

    it("rejects notations the chain renderer would not echo back", () => {
      for (const bad of ["1e3", "+2", "", "abc", "2,5", " 2"]) {
        expect(() => toCanonicalNumeric(bad, "min_change")).toThrow(
          /min_change must be a decimal number/
        );
      }
    });
  });

  describe("encodeIndexChangeActionArgs", () => {
    const encode = (
      overrides: Partial<{
        baseTime: number | null;
        timeInterval: number;
        minChange: string | null;
        maxChange: string | null;
        frozenAt: number;
      }> = {}
    ) =>
      encodeIndexChangeActionArgs(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        1700000000,
        overrides.baseTime ?? null,
        overrides.timeInterval ?? 31536000,
        overrides.minChange === undefined ? "2" : overrides.minChange,
        overrides.maxChange === undefined ? "3" : overrides.maxChange,
        overrides.frozenAt ?? 0
      );

    it("encodes a two-sided bucket", () => {
      const result = encode();
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it("encodes either open tail", () => {
      expect(() => encode({ minChange: null })).not.toThrow();
      expect(() => encode({ maxChange: null })).not.toThrow();
    });

    it("rejects a bucket with both tails open", () => {
      // The whole number line. The node action refuses it, so refusing here
      // turns a spent transaction into a local error.
      expect(() => encode({ minChange: null, maxChange: null })).toThrow(
        /at least one of min_change or max_change/
      );
    });

    it("rejects an empty-string bound", () => {
      // "" is how a DECODED market holds an open tail. As an input it is far
      // more likely to be an unset variable.
      expect(() => encode({ minChange: "" })).toThrow(
        /min_change is empty; pass null/
      );
      expect(() => encode({ maxChange: "" })).toThrow(
        /max_change is empty; pass null/
      );
    });

    it("rejects a non-positive or fractional time interval", () => {
      expect(() => encode({ timeInterval: 0 })).toThrow(/time_interval must be a positive/);
      expect(() => encode({ timeInterval: -31536000 })).toThrow(/time_interval must be a positive/);
      expect(() => encode({ timeInterval: 1.5 })).toThrow(/time_interval must be a positive/);
    });

    it("rejects an inverted or empty bucket", () => {
      expect(() => encode({ minChange: "3", maxChange: "2" })).toThrow(
        /min_change must be less than max_change/
      );
      // Equal bounds are half-open [2, 2): empty, and no outcome can land in it.
      expect(() => encode({ minChange: "2", maxChange: "2" })).toThrow(
        /min_change must be less than max_change/
      );
      // ...including when the two strings differ but the numbers do not.
      expect(() => encode({ minChange: "2", maxChange: "2.0" })).toThrow(
        /min_change must be less than max_change/
      );
    });

    it("declares each argument's type in the slot the action expects", () => {
      // The values alone cannot show this: a bound sent as TEXT decodes to the
      // same string as one sent as NUMERIC, but it is different bytes on the
      // wire — a different market hash, and an argument the action would refuse.
      const declaredTypes = (args: Uint8Array): string[] => {
        const types: string[] = [];
        let offset = 0;
        const count = readUint32LE(args, offset);
        offset += 4;
        for (let i = 0; i < count; i++) {
          const length = readUint32LE(args, offset);
          offset += 4;
          const { value } = decodeEncodedValue(args.slice(offset, offset + length), 0);
          offset += length;
          types.push(
            value.type.name === "numeric"
              ? `numeric(${value.type.metadata.join(",")})`
              : value.type.name
          );
        }
        return types;
      };

      // ($data_provider TEXT, $stream_id TEXT, $timestamp INT8, $base_time INT8,
      //  $time_interval INT, $min_change NUMERIC(36,18), $max_change NUMERIC(36,18),
      //  $frozen_at INT8), with NULL standing in for the two absent INT8s.
      expect(declaredTypes(encode())).toEqual([
        "text",
        "text",
        "int8",
        "null",
        "int8",
        "numeric(36,18)",
        "numeric(36,18)",
        "null",
      ]);

      // An open tail is a NULL in the bound's own slot, not a missing argument:
      // the slot keeps its declared NUMERIC type and carries a null flag.
      expect(declaredTypes(encode({ minChange: null }))).toEqual([
        "text",
        "text",
        "int8",
        "null",
        "int8",
        "numeric(36,18)",
        "numeric(36,18)",
        "null",
      ]);

      // base_time and frozen_at are carried when they are given.
      expect(
        declaredTypes(encode({ baseTime: 1600000000, frozenAt: 1234567 }))
      ).toEqual([
        "text",
        "text",
        "int8",
        "int8",
        "int8",
        "numeric(36,18)",
        "numeric(36,18)",
        "int8",
      ]);
    });

    it("orders the bounds as numbers, not as strings", () => {
      // "10" sorts below "9" as text. A string comparison would reject this
      // perfectly ordinary bucket.
      expect(() => encode({ minChange: "9", maxChange: "10" })).not.toThrow();
      expect(() => encode({ minChange: "-33.7", maxChange: "-2" })).not.toThrow();
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

    const indexChangeComponents = (
      minChange: string | null,
      maxChange: string | null,
      timestamp = 1700000000,
      frozenAt = 0
    ): Uint8Array =>
      encodeQueryComponents(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        "index_change_in_range",
        encodeIndexChangeActionArgs(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          timestamp,
          null,
          31536000,
          minChange,
          maxChange,
          frozenAt
        )
      );

    it("should round-trip index_change_in_range", async () => {
      const { decodeMarketData } = await importHelper();
      const decoded = decodeMarketData(indexChangeComponents("2", "3"));

      // Its own type: "between" consumers parse both bounds as numbers, which
      // an open tail would break.
      expect(decoded.type).toBe("change_between");
      // Read from arguments 5 and 6. Reading 3 and 4 the way value_in_range
      // does would yield base_time and time_interval, which are also numbers
      // and so would be silently wrong rather than loud.
      expect(decoded.thresholds).toEqual([
        "2.000000000000000000",
        "3.000000000000000000",
      ]);
      expect(decoded.timestamp).toBe(1700000000);
      expect(decoded.frozenAt).toBeNull();
    });

    it("should hold an open bottom tail in place", async () => {
      const { decodeMarketData } = await importHelper();
      const decoded = decodeMarketData(indexChangeComponents(null, "1"));
      // Two slots, not one. Dropping the empty slot would slide "1" into the
      // lower bound and turn "below 1%" into "1% or more".
      expect(decoded.thresholds).toEqual(["", "1.000000000000000000"]);
    });

    it("should hold an open top tail in place", async () => {
      const { decodeMarketData } = await importHelper();
      const decoded = decodeMarketData(indexChangeComponents("4", null));
      expect(decoded.thresholds).toEqual(["4.000000000000000000", ""]);
    });

    it("should read frozen_at from the eighth argument", async () => {
      const { decodeMarketData } = await importHelper();
      const decoded = decodeMarketData(
        indexChangeComponents("2", "3", 1700000000, 1234567)
      );
      // Index 7, not 5: the two bounds sit where the older actions keep
      // frozen_at, so reading position 5 would report a threshold as a height.
      expect(decoded.frozenAt).toBe(1234567);
      expect(decoded.timestamp).toBe(1700000000);
    });

    it("should leave a truncated index-change market unpinned", async () => {
      const { decodeMarketData } = await importHelper();
      // Seven arguments: enough for both bounds, one short of frozen_at.
      const truncated = encodeKwilArgs(
        [TEST_DATA_PROVIDER, TEST_STREAM_ID, 1700000000, null, 31536000, "2", "3"],
        {
          5: Utils.DataType.Numeric(36, 18),
          6: Utils.DataType.Numeric(36, 18),
        }
      );
      const decoded = decodeMarketData(
        encodeQueryComponents(
          TEST_DATA_PROVIDER,
          TEST_STREAM_ID,
          "index_change_in_range",
          truncated
        )
      );
      expect(decoded.timestamp).toBeNull();
      expect(decoded.frozenAt).toBeNull();
    });
  });

  describe("decodeCreateMarketPayload", () => {
    const buildQueryComponents = () =>
      encodeQueryComponents(
        TEST_DATA_PROVIDER,
        TEST_STREAM_ID,
        "price_above_threshold",
        encodeActionArgs(TEST_DATA_PROVIDER, TEST_STREAM_ID, 1700000000, "50.00", 0)
      );

    // A create_market call as decodeTransactionPayload surfaces it: create_market's on-chain
    // signature is ($bridge TEXT, $query_components BYTEA, $settle_time INT8, $max_spread INT,
    // $min_order_size INT8), so args decode to string, Uint8Array, and bigint (INT/INT8) respectively.
    const createMarketTx = (
      queryComponents: Uint8Array
    ): DecodedTransactionPayload => ({
      namespace: "main",
      action: "create_market",
      arguments: [
        // min_order_size is 1e18 + 1: NOT exactly representable as an IEEE-754 double, so it pins
        // that the field is kept as a string (a String(Number(...)) regression would drop the +1).
        ["hoodi_tt2", queryComponents, 1700003600n, 10n, 1000000000000000001n],
      ],
    });

    it("decodes a create_market transaction into structured fields", () => {
      const queryComponents = buildQueryComponents();
      const decoded = decodeCreateMarketPayload(createMarketTx(queryComponents));

      expect(decoded).not.toBeNull();
      expect(decoded!.bridge).toBe("hoodi_tt2");
      expect(decoded!.settleTime).toBe(1700003600);
      expect(decoded!.maxSpread).toBe(10);
      expect(decoded!.minOrderSize).toBe("1000000000000000001");
      expect(decoded!.queryComponents).toEqual(queryComponents);
    });

    it("decodes the nested market details from query_components", () => {
      const decoded = decodeCreateMarketPayload(createMarketTx(buildQueryComponents()));

      expect(decoded!.market).not.toBeNull();
      expect(decoded!.market!.type).toBe("above");
      expect(decoded!.market!.thresholds).toEqual(["50.00"]);
      expect(decoded!.market!.streamId).toBe(TEST_STREAM_ID);
      expect(decoded!.market!.dataProvider).toBe(TEST_DATA_PROVIDER.toLowerCase());
    });

    it("keeps the top-level fields and leaves market null when query_components can't be decoded", () => {
      // A committed-but-execution-failed create_market can still carry empty/garbage
      // query_components; an explorer must get the top-level fields, not an opaque crash.
      const badTx: DecodedTransactionPayload = {
        namespace: "main",
        action: "create_market",
        arguments: [
          ["hoodi_tt2", new Uint8Array(), 1700003600n, 10n, 1000000000000000000n],
        ],
      };
      const decoded = decodeCreateMarketPayload(badTx);
      expect(decoded).not.toBeNull();
      expect(decoded!.market).toBeNull();
      expect(decoded!.bridge).toBe("hoodi_tt2");
      expect(decoded!.settleTime).toBe(1700003600);
    });

    it("returns null when the transaction is not a create_market", () => {
      const notMarket: DecodedTransactionPayload = {
        namespace: "main",
        action: "insert_records",
        arguments: [["0xabc", "stream"]],
      };
      expect(decodeCreateMarketPayload(notMarket)).toBeNull();
    });

    it("throws when a create_market call is missing arguments", () => {
      const truncated: DecodedTransactionPayload = {
        namespace: "main",
        action: "create_market",
        arguments: [["hoodi_tt2"]],
      };
      expect(() => decodeCreateMarketPayload(truncated)).toThrow(/create_market/);
    });
  });
});
