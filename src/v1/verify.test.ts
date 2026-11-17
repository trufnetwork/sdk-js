import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./decode";
import { payloadDigest } from "./signature";
import type { TxBody, TxIntent, TxPreparedData } from "./types";
import {
  assertPrepared,
  canonicalDecimal,
  PayloadVerificationError,
  verifyPrepared,
} from "./verify";

/**
 * Tests for opt-in payload verification.
 *
 * The prepared payloads are built by a small, self-contained encoder in this
 * file. That is deliberate: verification must work without kwil-js, so the test
 * that exercises it must not borrow kwil-js to produce its input.
 */

const encoder = new TextEncoder();
const SENDER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const UUID = "123e4567-e89b-42d3-a456-426614174000";

// ─────────────────────────────────────────────────────────────────────────────
// A minimal `execute` encoder (the inverse of decode.ts, test-only)
// ─────────────────────────────────────────────────────────────────────────────

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

const u8 = (n: number): Uint8Array => new Uint8Array([n & 0xff]);
const u16le = (n: number): Uint8Array =>
  new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
const u16be = (n: number): Uint8Array =>
  new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
const u32le = (n: number): Uint8Array =>
  new Uint8Array([
    n & 0xff,
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
const u32be = (n: number): Uint8Array =>
  new Uint8Array([
    (n >>> 24) & 0xff,
    (n >> 16) & 0xff,
    (n >> 8) & 0xff,
    n & 0xff,
  ]);
const lenPrefixed = (bytes: Uint8Array): Uint8Array =>
  concat(u32le(bytes.length), bytes);
const str = (value: string): Uint8Array => lenPrefixed(encoder.encode(value));

interface WireArg {
  type: string;
  isArray?: boolean;
  meta?: [number, number];
  /** Each element is the raw value payload, or `null` for a SQL NULL. */
  elements?: (Uint8Array | null)[];
}

function int64be(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, false);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeEncodedValue(arg: WireArg): Uint8Array {
  const meta = arg.meta ?? ([0, 0] as [number, number]);
  const name = encoder.encode(arg.type);
  const dataType = concat(
    u16be(0),
    u32be(name.length),
    name,
    u8(arg.isArray === true ? 1 : 0),
    u16be(meta[0]),
    u16be(meta[1]),
  );
  const elements = arg.elements ?? [];
  const parts: Uint8Array[] = [
    u16le(0),
    lenPrefixed(dataType),
    u16le(elements.length),
  ];
  for (const element of elements) {
    parts.push(
      lenPrefixed(
        element === null ? new Uint8Array([0]) : concat(u8(1), element),
      ),
    );
  }
  return concat(...parts);
}

function encodeAction(
  namespace: string,
  action: string,
  calls: WireArg[][],
): Uint8Array {
  const parts: Uint8Array[] = [
    u16le(0),
    str(namespace),
    str(action),
    u16le(calls.length),
  ];
  for (const args of calls) {
    parts.push(u16le(args.length));
    for (const arg of args) parts.push(lenPrefixed(encodeEncodedValue(arg)));
  }
  return concat(...parts);
}

// Argument builders.
const text = (value: string): WireArg => ({
  type: "text",
  elements: [encoder.encode(value)],
});
const int8 = (value: bigint): WireArg => ({
  type: "int8",
  elements: [int64be(value)],
});
const bool = (value: boolean): WireArg => ({
  type: "bool",
  elements: [new Uint8Array([value ? 1 : 0])],
});
const bytea = (value: Uint8Array): WireArg => ({
  type: "bytea",
  elements: [value],
});
const uuid = (value: string): WireArg => ({
  type: "uuid",
  elements: [hexToBytes(value.replace(/-/g, ""))],
});
const numeric = (value: string, precision = 6, scale = 3): WireArg => ({
  type: "numeric",
  meta: [precision, scale],
  elements: [encoder.encode(value)],
});
const nullArg = (): WireArg => ({ type: "null", elements: [] });
const arrayArg = (
  type: string,
  elements: (Uint8Array | null)[],
  meta?: [number, number],
): WireArg => ({
  type,
  isArray: true,
  meta,
  elements,
});

// ─────────────────────────────────────────────────────────────────────────────
// Prepared-envelope builders
// ─────────────────────────────────────────────────────────────────────────────

interface PreparedOverrides {
  body?: Partial<TxBody>;
  prepared?: Partial<Omit<TxPreparedData, "transaction">>;
  /** Override what the *payload* was encoded with, to simulate a lying server. */
  wire?: { namespace?: string; action?: string };
}

/**
 * The signature message for `body`, spelled out here rather than imported from
 * `./signature`.
 *
 * A fixture that calls the implementation it is checking cannot catch a change
 * to that implementation: the two move together. Writing the template a second
 * time means a wrong template breaks these tests instead of quietly redefining
 * "correct". Only the hash is shared, and `signature.test.ts` pins that against
 * the FIPS 180-4 vectors and precomputed reference digests.
 */
function signedMessage(body: TxBody): string {
  return (
    `${body.desc ?? ""}\n\n` +
    `PayloadType: ${body.type}\n` +
    `PayloadDigest: ${payloadDigest(base64ToBytes(body.payload))}\n` +
    `Fee: ${String(body.fee)}\n` +
    `Nonce: ${String(body.nonce)}\n\n` +
    `Kwil Chain ID: ${body.chain_id}\n`
  );
}

function makePrepared(
  calls: WireArg[][],
  intent: TxIntent,
  overrides: PreparedOverrides = {},
): TxPreparedData {
  const payload = bytesToBase64(
    encodeAction(
      overrides.wire?.namespace ?? intent.namespace,
      overrides.wire?.action ?? intent.action,
      calls,
    ),
  );
  const body: TxBody = {
    payload,
    type: "execute",
    fee: "1000",
    nonce: 1,
    chain_id: "tn-test",
    ...overrides.body,
  };
  return {
    transaction: { body, serialization: "concat" },
    signature_message: signedMessage(body),
    fee: "1000",
    nonce: 1,
    chain_id: "tn-test",
    ...overrides.prepared,
  };
}

function intentWith(args: TxIntent["args"], action = "place_trade"): TxIntent {
  return { namespace: "main", action, sender: SENDER, args };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("verifyPrepared", () => {
  it("accepts a matching intent for every supported argument type", () => {
    const intent = intentWith([
      { type: "text", value: "hello" },
      { type: "int8", value: 42 },
      { type: "bool", value: true },
      { type: "bytea", value: "0x010203ff" },
      { type: "uuid", value: UUID.toUpperCase() },
      { type: "numeric(6,3)", value: "1.50" },
      { type: "text", value: null },
      { type: "text[]", value: ["a", null, "b"] },
      { type: "text[]", value: null },
    ]);
    const prepared = makePrepared(
      [
        [
          text("hello"),
          int8(42n),
          bool(true),
          bytea(new Uint8Array([1, 2, 3, 255])),
          uuid(UUID),
          numeric("1.500"),
          nullArg(),
          arrayArg("text", [encoder.encode("a"), null, encoder.encode("b")]),
          arrayArg("text", []),
        ],
      ],
      intent,
    );

    const result = verifyPrepared(prepared, intent);

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.decoded?.namespace).toBe("main");
    expect(result.decoded?.action).toBe("place_trade");
  });

  it("detects a different argument value", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const result = verifyPrepared(
      makePrepared([[text("goodbye")]], intent),
      intent,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      code: "argument_value",
      path: "args[0]",
      expected: "hello",
      actual: "goodbye",
    });
  });

  it("detects a different namespace", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const result = verifyPrepared(
      makePrepared([[text("hello")]], intent, { wire: { namespace: "other" } }),
      intent,
    );

    expect(result.issues.map((i) => i.code)).toContain("namespace");
  });

  it("detects a different action", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const result = verifyPrepared(
      makePrepared([[text("hello")]], intent, { wire: { action: "transfer" } }),
      intent,
    );

    expect(result.issues.map((i) => i.code)).toContain("action");
  });

  it("detects a different argument count", () => {
    const intent = intentWith([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ]);
    const result = verifyPrepared(makePrepared([[text("a")]], intent), intent);

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "argument_count",
      expected: 2,
      actual: 1,
    });
  });

  it("detects a payload split into more than one call", () => {
    const intent = intentWith([{ type: "text", value: "a" }]);
    const prepared = makePrepared([[text("a")], [text("a")]], intent);

    const result = verifyPrepared(prepared, intent);

    expect(result.issues.map((i) => i.code)).toContain("call_count");
  });

  it("detects a different array length", () => {
    const intent = intentWith([{ type: "text[]", value: ["a", "b"] }]);
    const prepared = makePrepared(
      [[arrayArg("text", [encoder.encode("a")])]],
      intent,
    );

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "array_length",
      expected: 2,
      actual: 1,
    });
  });

  it("detects a declared type that does not match the decoded type", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const result = verifyPrepared(makePrepared([[int8(42n)]], intent), intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("argument_type");
  });

  it("detects a mismatched numeric precision or scale", () => {
    const intent = intentWith([{ type: "numeric(6,3)", value: "1.5" }]);
    const prepared = makePrepared([[numeric("1.5", 6, 2)]], intent);

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("argument_type");
  });

  it("treats equivalent decimal spellings as equal", () => {
    const intent = intentWith([
      { type: "numeric(6,3)", value: "1.50" },
      { type: "numeric(10,7)", value: "1E-7" },
    ]);
    const prepared = makePrepared(
      [[numeric("1.5"), numeric("0.0000001", 10, 7)]],
      intent,
    );

    const result = verifyPrepared(prepared, intent);

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts a bigint numeric intent value (never throws)", () => {
    // `TxArg.value` is `unknown`, so `bigint` is a legal intent value. It must
    // canonicalise against the decoded decimal rather than throw a TypeError.
    const intent = intentWith([{ type: "numeric(10,2)", value: 15n }]);
    const result = verifyPrepared(
      makePrepared([[numeric("15", 10, 2)]], intent),
      intent,
    );

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("reports a numeric value that is not a decimal instead of throwing", () => {
    // Objects, booleans, and `undefined` are not decimals: each must produce an
    // `argument_value` issue, never a raw `TypeError`.
    for (const value of [{}, true, undefined] as unknown[]) {
      const intent = intentWith([{ type: "numeric(6,3)", value }]);

      const result = verifyPrepared(
        makePrepared([[numeric("1.5")]], intent),
        intent,
      );

      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("argument_value");
    }
  });

  it("does not throw on a JSON null numeric value", () => {
    // A scalar `null` is compared as a type mismatch against a numeric payload;
    // the important property is that verification returns an issue, not a throw.
    const intent = intentWith([{ type: "numeric(6,3)", value: null }]);
    const result = verifyPrepared(
      makePrepared([[numeric("1.5")]], intent),
      intent,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("compares uuid case-insensitively", () => {
    const intent = intentWith([{ type: "uuid", value: UUID.toUpperCase() }]);
    const result = verifyPrepared(makePrepared([[uuid(UUID)]], intent), intent);
    expect(result.ok).toBe(true);
  });

  it("accepts a dashless or braced uuid the server normalises", () => {
    // `uuid.Parse` accepts dashless and braced forms and re-emits canonical
    // text, so an intent written that way must not read as a mismatch.
    const dashless = UUID.replace(/-/g, "");
    const braced = `{${UUID}}`;
    for (const value of [dashless, braced]) {
      const intent = intentWith([{ type: "uuid", value }]);
      const result = verifyPrepared(
        makePrepared([[uuid(UUID)]], intent),
        intent,
      );
      expect(result.ok).toBe(true);
    }
  });

  it("detects a different uuid", () => {
    const intent = intentWith([
      { type: "uuid", value: "123e4567-e89b-42d3-a456-426614174000" },
    ]);
    const prepared = makePrepared(
      [[uuid("123e4567-e89b-42d3-a456-426614174999")]],
      intent,
    );

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("argument_value");
  });

  it("accepts bytea hex with or without the 0x prefix", () => {
    const intent = intentWith([{ type: "bytea", value: "0102" }]);
    const result = verifyPrepared(
      makePrepared([[bytea(new Uint8Array([1, 2]))]], intent),
      intent,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects bytea intent values that are not hex", () => {
    const intent = intentWith([{ type: "bytea", value: "zz" }]);
    const result = verifyPrepared(
      makePrepared([[bytea(new Uint8Array([1, 2]))]], intent),
      intent,
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("argument_value");
    expect(result.issues[0]?.message).toMatch(/hex/);
  });

  it("rejects an int8 value that is not a safe JSON number", () => {
    const intent = intentWith([{ type: "int8", value: 2 ** 53 }]);
    const result = verifyPrepared(makePrepared([[int8(0n)]], intent), intent);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("argument_value");
    expect(result.issues[0]?.message).toMatch(/safe integer/);
  });

  it("ignores the declared type for a scalar JSON null", () => {
    const intent = intentWith([{ type: "text", value: null }]);
    const result = verifyPrepared(makePrepared([[nullArg()]], intent), intent);
    expect(result.ok).toBe(true);
  });

  it("names an unsupported declared type", () => {
    const intent = intentWith([{ type: "unsupported", value: "hello" }]);
    const result = verifyPrepared(
      makePrepared([[text("hello")]], intent),
      intent,
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("argument_type");
    expect(result.issues[0]?.message).toMatch(/unsupported type/);
  });

  it("checks fee, nonce and chain id against the prepare response in full mode", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { fee: "999", nonce: 2, chain_id: "other-chain" },
    });

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["fee", "nonce", "chain_id"]),
    );
  });

  it("treats fee spellings as equal when they are the same integer", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { fee: "1000.00" },
      prepared: { fee: "1e3" },
    });

    expect(verifyPrepared(prepared, intent).ok).toBe(true);
  });

  it("checks the payload type in full mode", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { type: "transfer" },
    });

    const result = verifyPrepared(prepared, intent);

    expect(result.issues.map((i) => i.code)).toEqual(["payload_type"]);
  });

  it("honours an explicit expected payload type", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { type: "transfer" },
    });

    const result = verifyPrepared(prepared, intent, {
      expectedPayloadType: "transfer",
    });

    expect(result.ok).toBe(true);
  });

  it("skips the envelope checks in payload mode", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { type: "transfer", fee: "999", nonce: 2, chain_id: "other-chain" },
    });

    const result = verifyPrepared(prepared, intent, { mode: "payload" });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("still detects a payload mismatch in payload mode (the literal AC2)", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("goodbye")]], intent);

    const result = verifyPrepared(prepared, intent, { mode: "payload" });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("argument_value");
  });

  it("never relies on desc", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent, {
      body: { desc: "tampered" },
    });

    expect(verifyPrepared(prepared, intent).ok).toBe(true);
  });

  it("reports a payload that is not base64 instead of throwing", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.transaction.body.payload = "%%%not-base64%%%";

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "payload_decode",
    );
    expect(result.decoded).toBeNull();
  });

  it("reports a truncated payload instead of throwing", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.transaction.body.payload = bytesToBase64(new Uint8Array([0, 0]));

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("payload_decode");
    expect(result.issues[0]?.message).toMatch(/could not be decoded/i);
    expect(result.decoded).toBeNull();
  });

  it("reports an unsupported payload version instead of throwing", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.transaction.body.payload = bytesToBase64(
      new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    );

    const result = verifyPrepared(prepared, intent, { mode: "payload" });

    expect(result.issues[0]?.code).toBe("payload_decode");
    expect(result.issues[0]?.message).toMatch(/version/i);
    expect(result.decoded).toBeNull();
  });
});

describe("signed message binding", () => {
  // `sign` signs `signature_message` verbatim, so verification is only sound if
  // that string is the one this body produces. These cases are the ones a
  // body-only check misses.

  it("rejects an honest body paired with a message for another payload", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    // The payload verifies. The message the wallet is asked to sign does not
    // commit to it: it carries another payload's digest.
    prepared.signature_message = makePrepared(
      [[text("goodbye")]],
      intent,
    ).signature_message;

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "signature_message",
    ]);
    expect(result.issues[0]?.message).toMatch(/authorize a different/i);
  });

  it("rejects the swapped message in payload mode too", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.signature_message = makePrepared(
      [[text("goodbye")]],
      intent,
    ).signature_message;

    const result = verifyPrepared(prepared, intent, { mode: "payload" });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "signature_message",
    ]);
  });

  it("binds every field of the message, not just the digest", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    const body = prepared.transaction.body;
    // The body is untouched, so only the message can be the difference.
    const messages = [
      signedMessage({ ...body, fee: "9999" }),
      signedMessage({ ...body, nonce: 2 }),
      signedMessage({ ...body, chain_id: "other-chain" }),
      signedMessage({ ...body, type: "transfer" }),
    ];

    for (const message of messages) {
      prepared.signature_message = message;
      const result = verifyPrepared(prepared, intent);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        "signature_message",
      ]);
    }
  });

  it("rejects an envelope whose serialization is not the signed text", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.transaction.serialization = "direct";

    const result = verifyPrepared(prepared, intent);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["serialization"]);
    expect(result.issues[0]?.expected).toBe("concat");
  });

  it("accepts the message the body produces", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);

    expect(prepared.transaction.serialization).toBe("concat");
    expect(verifyPrepared(prepared, intent).ok).toBe(true);
  });
});

describe("assertPrepared", () => {
  it("returns the result when the envelope matches", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);

    const result = assertPrepared(prepared, intent);

    expect(result.ok).toBe(true);
  });

  it("throws PayloadVerificationError listing every difference", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("goodbye")]], intent);

    expect(() => assertPrepared(prepared, intent)).toThrow(
      PayloadVerificationError,
    );
    try {
      assertPrepared(prepared, intent);
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadVerificationError);
      expect((error as PayloadVerificationError).issues).toHaveLength(1);
    }
  });

  it("throws PayloadVerificationError for an undecodable payload", () => {
    const intent = intentWith([{ type: "text", value: "hello" }]);
    const prepared = makePrepared([[text("hello")]], intent);
    prepared.transaction.body.payload = "%%%not-base64%%%";

    expect(() => assertPrepared(prepared, intent)).toThrow(
      PayloadVerificationError,
    );
  });
});

describe("canonicalDecimal", () => {
  it("normalises equivalent spellings", () => {
    expect(canonicalDecimal("1.50")).toBe(canonicalDecimal("1.5"));
    expect(canonicalDecimal("15e-1")).toBe(canonicalDecimal("1.5"));
    expect(canonicalDecimal("0.15e1")).toBe(canonicalDecimal("1.5"));
    expect(canonicalDecimal("1E-7")).toBe(canonicalDecimal("0.0000001"));
  });

  it("normalises zeros", () => {
    expect(canonicalDecimal("0")).toBe("0");
    expect(canonicalDecimal("0.000")).toBe("0");
    expect(canonicalDecimal("-0.0")).toBe("0");
  });

  it("keeps the sign and scale of non-zero values", () => {
    expect(canonicalDecimal("-1.5")).toBe(`-${canonicalDecimal("1.5")}`);
    expect(canonicalDecimal("1000")).toBe("1e3");
  });

  it("rejects non-decimal input", () => {
    expect(canonicalDecimal("abc")).toBeNull();
    expect(canonicalDecimal("")).toBeNull();
    expect(canonicalDecimal(Number.NaN)).toBeNull();
    expect(canonicalDecimal(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
