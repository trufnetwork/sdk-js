import { Utils } from "@trufnetwork/kwil-js";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, decodeActionExecution } from "./decode";

/**
 * Tests for the native, kwil-free `EXECUTE_ACTION` decoder.
 *
 * The wire layout is a consensus contract, so these pin it two ways:
 *  1. A real byte vector produced by kwil-db's Go `ActionExecution.MarshalBinary`
 *     (cross-implementation parity, including a negative int64).
 *  2. Round-trips through the kwil-js encoder as a *test-only oracle* for each
 *     argument type. The production module never imports kwil-js; only this test
 *     file does, and `npm run check:v1` guards the published entry graph.
 */

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/**
 * Build an `execute` payload from decoded args by encoding each argument with the
 * kwil-js encoder and assembling the ActionExecution framing by hand (kwil-js
 * does not export a public `encodeActionExecution`). Little-endian, matching
 * kwil-db.
 */
function buildPayload(
  namespace: string,
  action: string,
  calls: Array<Array<{ v: unknown; o?: unknown }>>,
): Uint8Array {
  const enc = new TextEncoder();
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([
      n & 0xff,
      (n >> 8) & 0xff,
      (n >> 16) & 0xff,
      (n >> 24) & 0xff,
    ]);
  const lenPrefixed = (b: Uint8Array) => concat(u32(b.length), b);
  const str = (s: string) => lenPrefixed(enc.encode(s));

  const parts: Uint8Array[] = [
    u16(0),
    str(namespace),
    str(action),
    u16(calls.length),
  ];
  for (const call of calls) {
    parts.push(u16(call.length));
    for (const arg of call) {
      const ev = Utils.formatEncodedValue(arg.v as never, arg.o as never);
      parts.push(lenPrefixed(Utils.encodeEncodedValue(ev)));
    }
  }
  return concat(...parts);
}

const textArray = { name: "text", is_array: true, metadata: [0, 0] };
const numericType = { name: "numeric", is_array: false, metadata: [6, 3] };

describe("decodeActionExecution", () => {
  it("decodes a real Go-produced ActionExecution byte-for-byte", () => {
    // kwil-db core/types.ActionExecution.MarshalBinary for:
    //   namespace "main", action "insert_records",
    //   [["stream_a", int64(100), true], ["stream_b", int64(-5), false]]
    const goHex =
      "0000" + // uint16-LE version = 0
      "040000006d61696e" + // namespace: len=4, "main"
      "0e000000696e736572745f7265636f726473" + // action: len=14, "insert_records"
      "0200" + // numCalls = 2
      "0300" + // call 0: numArgs = 3
      "2400000000000f0000000000000000047465787400000000000100090000000173747265616d5f61" + // "stream_a"
      "2400000000000f000000000000000004696e74380000000000010009000000010000000000000064" + // int8 100
      "1d00000000000f000000000000000004626f6f6c00000000000100020000000101" + // bool true
      "0300" + // call 1: numArgs = 3
      "2400000000000f0000000000000000047465787400000000000100090000000173747265616d5f62" + // "stream_b"
      "2400000000000f000000000000000004696e7438000000000001000900000001fffffffffffffffb" + // int8 -5
      "1d00000000000f000000000000000004626f6f6c00000000000100020000000100"; // bool false

    const decoded = decodeActionExecution(hexToBytes(goHex));

    expect(decoded.namespace).toBe("main");
    expect(decoded.action).toBe("insert_records");
    expect(decoded.arguments).toEqual([
      ["stream_a", 100n, true],
      ["stream_b", -5n, false],
    ]);
    expect(decoded.types).toEqual([
      [
        { name: "text", isArray: false, metadata: [0, 0] },
        { name: "int8", isArray: false, metadata: [0, 0] },
        { name: "bool", isArray: false, metadata: [0, 0] },
      ],
      [
        { name: "text", isArray: false, metadata: [0, 0] },
        { name: "int8", isArray: false, metadata: [0, 0] },
        { name: "bool", isArray: false, metadata: [0, 0] },
      ],
    ]);
  });

  it("decodes an action with no calls", () => {
    const decoded = decodeActionExecution(
      buildPayload("", "create_streams", []),
    );
    expect(decoded.namespace).toBe("");
    expect(decoded.action).toBe("create_streams");
    expect(decoded.arguments).toEqual([]);
    expect(decoded.types).toEqual([]);
  });

  it("decodes a single-call deploy-style payload", () => {
    const decoded = decodeActionExecution(
      buildPayload("main", "create_streams", [
        [{ v: "st_temperature" }, { v: "primitive" }],
      ]),
    );
    expect(decoded.namespace).toBe("main");
    expect(decoded.action).toBe("create_streams");
    expect(decoded.arguments).toEqual([["st_temperature", "primitive"]]);
  });

  it("decodes each scalar argument type to its native value", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const bytea = new Uint8Array([1, 2, 3, 255]);
    const decoded = decodeActionExecution(
      buildPayload("main", "mixed", [
        [
          { v: "hello" }, // text
          { v: 42 }, // int8
          { v: true }, // bool
          { v: false }, // bool
          { v: uuid }, // uuid
          { v: bytea }, // bytea
          { v: "123.456", o: numericType }, // numeric
          { v: null }, // null
        ],
      ]),
    );

    expect(decoded.arguments[0]).toEqual([
      "hello",
      42n,
      true,
      false,
      uuid,
      bytea,
      "123.456",
      null,
    ]);
    expect(decoded.types[0]?.[6]).toEqual({
      name: "numeric",
      isArray: false,
      metadata: [6, 3],
    });
    expect(decoded.types[0]?.[7]).toEqual({
      name: "null",
      isArray: false,
      metadata: [0, 0],
    });
  });

  it("decodes array arguments, including null elements and empty arrays", () => {
    const decoded = decodeActionExecution(
      buildPayload("main", "arrays", [
        [
          { v: ["a", "b", "c"], o: textArray },
          { v: [null, "b"], o: textArray },
          { v: ["a", null], o: textArray },
          { v: [], o: textArray },
        ],
      ]),
    );

    expect(decoded.arguments[0]).toEqual([
      ["a", "b", "c"],
      [null, "b"],
      ["a", null],
      [],
    ]);
    expect(decoded.types[0]?.[3]).toEqual({
      name: "text",
      isArray: true,
      metadata: [0, 0],
    });
  });

  it("decodes a batched (multi-call) payload", () => {
    const decoded = decodeActionExecution(
      buildPayload("main", "insert_records", [
        [{ v: "stream_a" }, { v: 100 }],
        [{ v: "stream_b" }, { v: 200 }],
        [{ v: "stream_c" }, { v: 300 }],
      ]),
    );

    expect(decoded.arguments).toEqual([
      ["stream_a", 100n],
      ["stream_b", 200n],
      ["stream_c", 300n],
    ]);
    expect(decoded.types).toHaveLength(3);
  });

  it("accepts a base64 payload string", () => {
    const payload = buildPayload("main", "insert_records", [
      [{ v: "stream_a" }, { v: 7 }],
    ]);
    const decoded = decodeActionExecution(bytesToBase64(payload));
    expect(decoded.action).toBe("insert_records");
    expect(decoded.arguments).toEqual([["stream_a", 7n]]);
  });

  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes(bytes)).toBe(bytes);
  });

  it("rejects an unsupported version", () => {
    const bad = hexToBytes("0100" + "00000000" + "00000000" + "0000");
    expect(() => decodeActionExecution(bad)).toThrow(/version/i);
  });

  it("keeps a leading byte order mark in every string", () => {
    const payload = buildPayload("\uFEFFmain", "\uFEFFact", [
      [{ v: "\uFEFFhi" }],
    ]);
    const decoded = decodeActionExecution(payload);
    expect(decoded.namespace).toBe("\uFEFFmain");
    expect(decoded.action).toBe("\uFEFFact");
    expect(decoded.arguments[0]).toEqual(["\uFEFFhi"]);
  });

  it("rejects a string that is not valid UTF-8", () => {
    const enc = new TextEncoder();
    const bad = concat(
      hexToBytes("0000"),
      new Uint8Array([2, 0, 0, 0]),
      new Uint8Array([0x70, 0xff]),
      new Uint8Array([3, 0, 0, 0]),
      enc.encode("act"),
      hexToBytes("0000"),
    );
    expect(() => decodeActionExecution(bad)).toThrow(/UTF-8/);
  });

  it("rejects a truncated payload", () => {
    expect(() => decodeActionExecution(hexToBytes("0000"))).toThrow();
  });
});
