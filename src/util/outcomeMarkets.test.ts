/**
 * The v2 outcome actions (ids 13-16, node v2.6.8): Go byte parity, the node's
 * bounds, and the read back through decodeMarketData.
 */

import { describe, it, expect } from "vitest";
import { sha256 } from "ethers";
import { Types, Utils } from "@trufnetwork/kwil-js";
import {
  buildIndexChangeInRangeV2QueryComponents,
  buildPriceAboveThresholdV2QueryComponents,
  buildPriceBelowThresholdV2QueryComponents,
  buildValueInRangeV2QueryComponents,
  decodeMarketData,
  encodeIndexChangeActionArgs,
  encodeIndexChangeV2ActionArgs,
  encodePriceThresholdV2ActionArgs,
  encodeQueryComponents,
  encodeValueInRangeV2ActionArgs,
  isMarketRefunded,
  OUTCOME_MAX_SPAN_SECONDS,
  OUTCOME_MAX_TOLERANCE_SECONDS,
  toOutcomeNumeric,
} from "./orderbookHelpers";
import {
  decodeEncodedValue,
  decodeQueryComponents,
  encodeEncodedArgs,
  readUint32LE,
} from "./AttestationEncoding";

const DP = "0x4710A8D8F0D845da110086812a32De6d90d7ff5C";
const SID = "stcpi0000000000000000000000000us";
const T = 1767225600;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/**
 * Bytes sdk-go produces for the same inputs: contractsapi.EncodeActionArgs and
 * EncodeQueryComponents over kwil-db/core v0.4.3-0.20260615121733-0d71bd259558,
 * with int64 time fields, ParseDecimalExplicit(v, 36, 18) numerics, an untyped
 * nil for an open bound and the data provider lowercased. `args` is the full
 * encoding; the query components are pinned by their sha256.
 */
const GO_GOLDEN: Array<{
  name: string;
  action: string;
  input: Record<string, string | number | null>;
  args: string;
  queryComponentsSha256: string;
}> = [
  {
    name: "above daily",
    action: "price_above_threshold_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, threshold: "50000" },
    args:
      "060000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180370000000000120000000000000000076e756d6572696300002400120100190000000135303030302e303030303030303030303030303030303030",
    queryComponentsSha256: "876386cdf6c1769ace670428aeaf32f3a058569b5cc724633d8d0799cf2be413",
  },
  {
    name: "below negative fraction",
    action: "price_below_threshold_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, threshold: "-0.5" },
    args:
      "060000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180340000000000120000000000000000076e756d657269630000240012010016000000012d302e353030303030303030303030303030303030",
    queryComponentsSha256: "69e127a1c5aad8ee3066c186238796149ec9357f04c0f0af57ff07d210339793",
  },
  {
    name: "above zero tolerance, T 0",
    action: "price_above_threshold_v2",
    input: { timestamp: 0, window: 1, tolerance: 0, threshold: "4.25" },
    args:
      "060000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e743800000000000100090000000100000000000000002400000000000f000000000000000004696e743800000000000100090000000100000000000000012400000000000f000000000000000004696e74380000000000010009000000010000000000000000330000000000120000000000000000076e756d65726963000024001201001500000001342e323530303030303030303030303030303030",
    queryComponentsSha256: "5af0a2a62b5d864c8ae94f0b9d785e41340e28a0093b1af2f5cb939e786535ab",
  },
  {
    name: "range closed",
    action: "value_in_range_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, minValue: "4.04", maxValue: "4.33" },
    args:
      "070000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180330000000000120000000000000000076e756d65726963000024001201001500000001342e303430303030303030303030303030303030330000000000120000000000000000076e756d65726963000024001201001500000001342e333330303030303030303030303030303030",
    queryComponentsSha256: "96a9f07d4fba9f74b97e7c6422cb06128fec17f4f07080e42125d3fbf563f96e",
  },
  {
    name: "range open below",
    action: "value_in_range_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, minValue: null, maxValue: "4.04" },
    args:
      "070000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e743800000000000100090000000100000000000151801700000000000f0000000000000000046e756c6c00000000000000330000000000120000000000000000076e756d65726963000024001201001500000001342e303430303030303030303030303030303030",
    queryComponentsSha256: "19d235c97903cc467e0a42573457a9950b375243e577617d05adf90e31fe4379",
  },
  {
    name: "range open above",
    action: "value_in_range_v2",
    input: { timestamp: 1767225600, window: 1728000, tolerance: 1728000, minValue: "4.33", maxValue: null },
    args:
      "070000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e743800000000000100090000000100000000001a5e002400000000000f000000000000000004696e743800000000000100090000000100000000001a5e00330000000000120000000000000000076e756d65726963000024001201001500000001342e3333303030303030303030303030303030301700000000000f0000000000000000046e756c6c00000000000000",
    queryComponentsSha256: "c5e19472bf0b124afd21d90c9ed5e5536c1e9569339b0516558ef6163040ce91",
  },
  {
    name: "above tiny",
    action: "price_above_threshold_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, threshold: "0.000000000000000001" },
    args:
      "060000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180240000000000120000000000000000076e756d6572696300002400120100060000000131452d3138",
    queryComponentsSha256: "403cf7057dc4ccdf5e2a79737b1690f1fb8d7243f8fd514bdeb5efb0eb1899ef",
  },
  {
    name: "below negative zero",
    action: "price_below_threshold_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, threshold: "-0" },
    args:
      "060000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180340000000000120000000000000000076e756d657269630000240012010016000000012d302e303030303030303030303030303030303030",
    queryComponentsSha256: "723a4abf433ce204baab4c9b8294500fd11a994a6c4850ab8163115ab89ab958",
  },
  {
    name: "range tiny bounds",
    action: "value_in_range_v2",
    input: { timestamp: 1767225600, window: 259200, tolerance: 86400, minValue: "-0.0000001", maxValue: "0.00000012" },
    args:
      "070000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000003f4802400000000000f000000000000000004696e74380000000000010009000000010000000000015180300000000000120000000000000000076e756d657269630000240012010012000000012d312e3030303030303030303030452d372f0000000000120000000000000000076e756d65726963000024001201001100000001312e3230303030303030303030452d37",
    queryComponentsSha256: "2015b8de66aab699dc7e0969de0789aaaff0420dd90db1716a1643b9da07b643",
  },
  {
    name: "change closed",
    action: "index_change_in_range_v2",
    input: { timestamp: 1767225600, window: 7776000, tolerance: 172800, timeInterval: 31536000, minChange: "2", maxChange: "3" },
    args:
      "080000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000076a7002400000000000f000000000000000004696e7438000000000001000900000001000000000002a3002400000000000f000000000000000004696e74380000000000010009000000010000000001e13380330000000000120000000000000000076e756d65726963000024001201001500000001322e303030303030303030303030303030303030330000000000120000000000000000076e756d65726963000024001201001500000001332e303030303030303030303030303030303030",
    queryComponentsSha256: "c1e7c1f212a8aa9ce13388c96f897e2a6b9ccbb6e46ac25b5a0c3fa20a240e6f",
  },
  {
    name: "change open below",
    action: "index_change_in_range_v2",
    input: { timestamp: 1767225600, window: 7776000, tolerance: 172800, timeInterval: 31536000, minChange: null, maxChange: "-0.5" },
    args:
      "080000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e7438000000000001000900000001000000000076a7002400000000000f000000000000000004696e7438000000000001000900000001000000000002a3002400000000000f000000000000000004696e74380000000000010009000000010000000001e133801700000000000f0000000000000000046e756c6c00000000000000340000000000120000000000000000076e756d657269630000240012010016000000012d302e353030303030303030303030303030303030",
    queryComponentsSha256: "20da155a5776f47289d77f347dafc856a99ecdc7e55d021fb94f0e75016056a5",
  },
  {
    name: "change open above",
    action: "index_change_in_range_v2",
    input: { timestamp: 1767225600, window: 315360000, tolerance: 3888000, timeInterval: 315360000, minChange: "123456789012345678.123456789012345678", maxChange: null },
    args:
      "080000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e7438000000000001000900000001000000006955b9002400000000000f000000000000000004696e74380000000000010009000000010000000012cc03002400000000000f000000000000000004696e743800000000000100090000000100000000003b53802400000000000f000000000000000004696e74380000000000010009000000010000000012cc0300440000000000120000000000000000076e756d657269630000240012010026000000013132333435363738393031323334353637382e3132333435363738393031323334353637381700000000000f0000000000000000046e756c6c00000000000000",
    queryComponentsSha256: "01957bcaf48ff10f076f37fca589fc6644fad16d8edba934af302a451d3ece0c",
  },
];

const builders: Record<string, (input: never) => Uint8Array> = {
  price_above_threshold_v2: buildPriceAboveThresholdV2QueryComponents,
  price_below_threshold_v2: buildPriceBelowThresholdV2QueryComponents,
  value_in_range_v2: buildValueInRangeV2QueryComponents,
  index_change_in_range_v2: buildIndexChangeInRangeV2QueryComponents,
};

/** Each argument's declared type and its number of data items, e.g. "int8/1". */
function declaredTypes(args: Uint8Array): string[] {
  const types: string[] = [];
  let offset = 0;
  const count = readUint32LE(args, offset);
  offset += 4;
  for (let i = 0; i < count; i++) {
    const length = readUint32LE(args, offset);
    offset += 4;
    const { value } = decodeEncodedValue(args.slice(offset, offset + length), 0);
    offset += length;
    const name = value.type.metadata.every((m) => m === 0)
      ? value.type.name
      : `${value.type.name}(${value.type.metadata.join(",")})`;
    types.push(`${name}/${value.data.length}`);
  }
  return types;
}

describe("v2 args match sdk-go byte for byte", () => {
  it.each(GO_GOLDEN.map((g) => [g.name, g] as const))("%s", (_name, golden) => {
    const queryComponents = builders[golden.action]({
      dataProvider: DP,
      streamId: SID,
      ...golden.input,
    } as never);
    expect(hex(decodeQueryComponents(queryComponents).args)).toBe(golden.args);
    expect(sha256(queryComponents)).toBe(`0x${golden.queryComponentsSha256}`);
  });

  it("encodes INT8, NULL and NUMERIC values as Go does", () => {
    // Per-value encodings from kwil-db/core EncodeValue; the slice drops the
    // arg count and the length prefix.
    const one = (value: Types.EncodedValue) =>
      hex(encodeEncodedArgs([value]).slice(8));
    expect(one(Utils.formatEncodedValue(1700000000, Utils.DataType.Int))).toBe(
      "00000f000000000000000004696e7438000000000001000900000001000000006553f100"
    );
    expect(one({ type: Utils.DataType.Null, data: [] })).toBe(
      "00000f0000000000000000046e756c6c00000000000000"
    );
    expect(
      one(
        Utils.formatEncodedValue(
          "2.000000000000000000",
          Utils.DataType.Numeric(36, 18)
        )
      )
    ).toBe(
      "0000120000000000000000076e756d65726963000024001201001500000001322e303030303030303030303030303030303030"
    );
  });

  it("leaves v1 encoding exactly as it was", () => {
    // index_change_in_range as encoded before v2: kwil-js INT8 metadata and a
    // NULL bound typed numeric with one [0x00] item.
    expect(
      hex(
        encodeIndexChangeActionArgs(DP, SID, T, 1600000000, 31536000, null, "-0.5", 7)
      )
    ).toBe(
      "080000004600000000000f00000000000000000474657874000000000001002b000000013078343731306138643866306438343564613131303038363831326133326465366439306437666635633c00000000000f0000000000000000047465787400000000000100210000000173746370693030303030303030303030303030303030303030303030303075732400000000000f000000000000000004696e743800000a000001000900000001000000006955b9002400000000000f000000000000000004696e743800000a000001000900000001000000005f5e10002400000000000f000000000000000004696e74380000080000010009000000010000000001e133801f0000000000120000000000000000076e756d65726963000024001201000100000000340000000000120000000000000000076e756d657269630000240012010016000000012d302e3530303030303030303030303030303030302400000000000f000000000000000004696e74380000010000010009000000010000000000000007"
    );
  });
});

describe("v2 argument layout", () => {
  it("declares every slot with the node's exact type and no frozen_at", () => {
    expect(
      declaredTypes(encodePriceThresholdV2ActionArgs(DP, SID, T, 259200, 86400, "4"))
    ).toEqual(["text/1", "text/1", "int8/1", "int8/1", "int8/1", "numeric(36,18)/1"]);
    expect(
      declaredTypes(encodeValueInRangeV2ActionArgs(DP, SID, T, 259200, 86400, "4", "5"))
    ).toEqual([
      "text/1",
      "text/1",
      "int8/1",
      "int8/1",
      "int8/1",
      "numeric(36,18)/1",
      "numeric(36,18)/1",
    ]);
    expect(
      declaredTypes(
        encodeIndexChangeV2ActionArgs(DP, SID, T, 7776000, 172800, 31536000, "2", "3")
      )
    ).toEqual([
      "text/1",
      "text/1",
      "int8/1",
      "int8/1",
      "int8/1",
      "int8/1",
      "numeric(36,18)/1",
      "numeric(36,18)/1",
    ]);
  });

  it("writes an open tail as Go's NULL, in its own slot", () => {
    expect(
      declaredTypes(encodeValueInRangeV2ActionArgs(DP, SID, T, 259200, 86400, null, "5")).slice(5)
    ).toEqual(["null/0", "numeric(36,18)/1"]);
    expect(
      declaredTypes(
        encodeIndexChangeV2ActionArgs(DP, SID, T, 7776000, 172800, 31536000, "2", undefined)
      ).slice(6)
    ).toEqual(["numeric(36,18)/1", "null/0"]);
  });

  it("lowercases the data provider in the args and the components", () => {
    const components = buildValueInRangeV2QueryComponents({
      dataProvider: DP,
      streamId: SID,
      timestamp: T,
      window: 259200,
      tolerance: 86400,
      minValue: "1",
    });
    expect(decodeMarketData(components).dataProvider).toBe(DP.toLowerCase());
    expect(
      hex(encodeValueInRangeV2ActionArgs(DP.toLowerCase(), SID, T, 259200, 86400, "1", null))
    ).toBe(hex(decodeQueryComponents(components).args));
  });
});

describe("v2 validation follows the node bounds and no further", () => {
  const price = (
    o: Partial<{
      timestamp: number;
      window: number;
      tolerance: number;
      threshold: string | null;
    }> = {}
  ) =>
    encodePriceThresholdV2ActionArgs(
      DP,
      SID,
      o.timestamp ?? T,
      o.window ?? 259200,
      o.tolerance ?? 86400,
      (o.threshold === undefined ? "4" : o.threshold) as string
    );
  const change = (
    o: Partial<{
      window: number;
      tolerance: number;
      timeInterval: number;
      min: string | null;
      max: string | null;
    }> = {}
  ) =>
    encodeIndexChangeV2ActionArgs(
      DP,
      SID,
      T,
      o.window ?? 7776000,
      o.tolerance ?? 172800,
      o.timeInterval ?? 31536000,
      o.min === undefined ? "2" : o.min,
      o.max === undefined ? "3" : o.max
    );
  const range = (min: string | null | undefined, max: string | null | undefined) =>
    encodeValueInRangeV2ActionArgs(DP, SID, T, 259200, 86400, min, max);

  it("accepts every edge the node accepts", () => {
    expect(() => price({ timestamp: 0 })).not.toThrow();
    expect(() => price({ window: 1, tolerance: 0 })).not.toThrow();
    expect(() => price({ window: 86400, tolerance: 86400 })).not.toThrow();
    expect(() =>
      price({
        window: OUTCOME_MAX_SPAN_SECONDS,
        tolerance: OUTCOME_MAX_TOLERANCE_SECONDS,
      })
    ).not.toThrow();
    expect(() => change({ window: 100, tolerance: 100, timeInterval: 201 })).not.toThrow();
    expect(() => change({ timeInterval: OUTCOME_MAX_SPAN_SECONDS })).not.toThrow();
    expect(() => change({ window: 1, tolerance: 0, timeInterval: 1 })).not.toThrow();
    // Below 1e-6 Go writes exponent form, and the node takes it.
    expect(() => price({ threshold: "0.000000000000000001" })).not.toThrow();
    expect(() => range("-0.0000001", "0.0000001")).not.toThrow();
    expect(() =>
      price({ threshold: "-123456789012345678.123456789012345678" })
    ).not.toThrow();
  });

  it("refuses a timestamp, window or tolerance the node refuses", () => {
    expect(() => price({ timestamp: -1 })).toThrow(/timestamp must be a whole number/);
    expect(() => price({ timestamp: 1.5 })).toThrow(/timestamp must be a whole number/);
    expect(() => price({ window: 0 })).toThrow(
      "window must be a whole number of seconds in (0, 315360000], got 0"
    );
    expect(() => price({ window: OUTCOME_MAX_SPAN_SECONDS + 1 })).toThrow(/window must be/);
    expect(() => price({ window: 86400.5 })).toThrow(/window must be/);
    expect(() => price({ tolerance: -1 })).toThrow(
      "tolerance must be a whole number of seconds in [0, 3888000], got -1"
    );
    expect(() =>
      price({
        window: OUTCOME_MAX_SPAN_SECONDS,
        tolerance: OUTCOME_MAX_TOLERANCE_SECONDS + 1,
      })
    ).toThrow(/tolerance must be/);
    expect(() => price({ window: 86399, tolerance: 86400 })).toThrow(
      "window (86399) must not be less than tolerance (86400)"
    );
  });

  it("refuses an interval the node refuses", () => {
    expect(() => change({ timeInterval: 0 })).toThrow(/time_interval must be a whole number/);
    expect(() => change({ timeInterval: OUTCOME_MAX_SPAN_SECONDS + 1 })).toThrow(
      /time_interval must be/
    );
    expect(() => change({ timeInterval: 345600 })).toThrow(
      "time_interval (345600) must be more than twice tolerance (172800)"
    );
  });

  it("requires a threshold", () => {
    expect(() => price({ threshold: null })).toThrow("threshold is required");
    expect(() => price({ threshold: "" })).toThrow("threshold is empty");
    expect(() => price({ threshold: "NaN" })).toThrow(/threshold must be a decimal number/);
  });

  it("refuses both tails open, an empty bound and an empty or inverted range", () => {
    expect(() => range(null, undefined)).toThrow(
      "at least one of min_value or max_value is required"
    );
    expect(() => change({ min: null, max: null })).toThrow(
      "at least one of min_change or max_change is required"
    );
    expect(() => range("", "5")).toThrow(
      "min_value is empty; pass null to strike an open tail"
    );
    expect(() => range("5", "5.0")).toThrow(/min_value must be less than max_value/);
    expect(() => range("10", "9")).toThrow(/min_value must be less than max_value/);
    expect(() => range("-0", "0")).toThrow(/min_value must be less than max_value/);
    expect(() => range("0.0000001", "0.00000001")).toThrow(
      /min_value must be less than max_value/
    );
    // Ordered as numbers, not as text.
    expect(() => range("9", "10")).not.toThrow();
  });

  it("renders bounds as Go does", () => {
    expect(toOutcomeNumeric("2", "x")).toBe("2.000000000000000000");
    expect(toOutcomeNumeric("-0", "x")).toBe("-0.000000000000000000");
    expect(toOutcomeNumeric("0.000001", "x")).toBe("0.000001000000000000");
    expect(toOutcomeNumeric("0.0000001", "x")).toBe("1.00000000000E-7");
    expect(toOutcomeNumeric("-0.00000012", "x")).toBe("-1.20000000000E-7");
    expect(toOutcomeNumeric("0.000000000000000001", "x")).toBe("1E-18");
    expect(() => toOutcomeNumeric("0.0000000000000000001", "x")).toThrow(/decimal places/);
    expect(() => toOutcomeNumeric("1234567890123456789", "x")).toThrow(/integer digits/);
  });
});

describe("decodeMarketData reads v2 markets", () => {
  const base = { dataProvider: DP, streamId: SID, timestamp: T };

  it("reads price_above_threshold_v2 as above", () => {
    const market = decodeMarketData(
      buildPriceAboveThresholdV2QueryComponents({
        ...base,
        window: 259200,
        tolerance: 86400,
        threshold: "4.04",
      })
    );
    expect(market).toEqual({
      dataProvider: DP.toLowerCase(),
      streamId: SID,
      actionId: "price_above_threshold_v2",
      type: "above",
      thresholds: ["4.040000000000000000"],
      timestamp: T,
      frozenAt: null,
      baseTime: null,
      timeInterval: null,
      window: 259200,
      tolerance: 86400,
    });
  });

  it("reads price_below_threshold_v2 as below", () => {
    const market = decodeMarketData(
      buildPriceBelowThresholdV2QueryComponents({
        ...base,
        window: 1728000,
        tolerance: 1728000,
        threshold: "2.1",
      })
    );
    expect(market.type).toBe("below");
    expect(market.thresholds).toEqual(["2.100000000000000000"]);
    expect([market.window, market.tolerance]).toEqual([1728000, 1728000]);
  });

  it("reads value_in_range_v2 as range, holding an open tail in place", () => {
    const window = 259200;
    const tolerance = 86400;
    const bounded = decodeMarketData(
      buildValueInRangeV2QueryComponents({
        ...base,
        window,
        tolerance,
        minValue: "4.04",
        maxValue: "4.33",
      })
    );
    expect(bounded.type).toBe("range");
    expect(bounded.thresholds).toEqual(["4.040000000000000000", "4.330000000000000000"]);
    expect(bounded.frozenAt).toBeNull();

    const below = decodeMarketData(
      buildValueInRangeV2QueryComponents({ ...base, window, tolerance, maxValue: "4.04" })
    );
    expect(below.thresholds).toEqual(["", "4.040000000000000000"]);
    const above = decodeMarketData(
      buildValueInRangeV2QueryComponents({ ...base, window, tolerance, minValue: "4.33" })
    );
    expect(above.thresholds).toEqual(["4.330000000000000000", ""]);
  });

  it("reads index_change_in_range_v2 as change_between with its interval", () => {
    const market = decodeMarketData(
      buildIndexChangeInRangeV2QueryComponents({
        ...base,
        window: 7776000,
        tolerance: 172800,
        timeInterval: 31536000,
        minChange: null,
        maxChange: "2",
      })
    );
    expect(market).toMatchObject({
      actionId: "index_change_in_range_v2",
      type: "change_between",
      thresholds: ["", "2.000000000000000000"],
      timestamp: T,
      frozenAt: null,
      baseTime: null,
      timeInterval: 31536000,
      window: 7776000,
      tolerance: 172800,
    });
  });

  it("leaves window and tolerance null for a v1 market", () => {
    const market = decodeMarketData(
      encodeQueryComponents(
        DP.toLowerCase(),
        SID,
        "index_change_in_range",
        encodeIndexChangeActionArgs(DP, SID, T, null, 31536000, "2", "3", 0)
      )
    );
    expect(market.window).toBeNull();
    expect(market.tolerance).toBeNull();
    expect(market.timeInterval).toBe(31536000);
  });

  it("leaves a v2 market with the wrong argument count unread", () => {
    // One short and one extra. v2 has no defaults, so the node would have
    // created neither.
    const text = (v: string) => Utils.formatEncodedValue(v, Utils.DataType.Text);
    const int8 = (v: number) => Utils.formatEncodedValue(v, Utils.DataType.Int);
    const numeric = (v: string) =>
      Utils.formatEncodedValue(v, Utils.DataType.Numeric(36, 18));
    const head = [text(DP.toLowerCase()), text(SID), int8(T), int8(259200)];
    const short = encodeEncodedArgs([...head, numeric("4")]);
    const long = encodeEncodedArgs([...head, int8(86400), numeric("4"), int8(1)]);
    for (const args of [short, long]) {
      const market = decodeMarketData(
        encodeQueryComponents(DP.toLowerCase(), SID, "price_above_threshold_v2", args)
      );
      expect(market.type).toBe("above");
      expect(market.timestamp).toBeNull();
      expect(market.window).toBeNull();
      expect(market.thresholds).toEqual([]);
    }
  });
});

describe("isMarketRefunded", () => {
  it("is true only for a settled market with no winning outcome", () => {
    expect(isMarketRefunded({ settled: true, winningOutcome: null })).toBe(true);
    expect(isMarketRefunded({ settled: true })).toBe(true);
    expect(isMarketRefunded({ settled: true, winningOutcome: true })).toBe(false);
    expect(isMarketRefunded({ settled: true, winningOutcome: false })).toBe(false);
    expect(isMarketRefunded({ settled: false, winningOutcome: null })).toBe(false);
  });
});
