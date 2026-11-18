/**
 * Opt-in verification of a `prepare` response against the intent that was sent.
 *
 * The security job is deliberately narrow: decode the payload the API returned
 * and compare it *semantically* with the intent, never re-encoding anything. The
 * server already coerced the intent's JSON values to the declared types, so the
 * comparison follows the server's coercion rules (`api/v1_tx.go`
 * `coerceTxScalar`/`coerceTxDecimal`) rather than the intent's pre-coercion
 * spelling.
 *
 * In `full` mode (the default) the envelope's fee, nonce, chain id, and payload
 * type are also checked against the values `prepare` returned. Those values are
 * sealed into the signed message, so a mismatch in any of them is as dangerous
 * as a payload mismatch. `payload` mode restricts the check to the payload, and
 * still satisfies the issue's literal criterion.
 *
 * Both modes also check that the message `sign` will sign is the message the
 * envelope's own body produces. Decoding the payload proves what the body
 * contains; it does not prove the signature will authorize it, because `sign`
 * signs `signature_message` verbatim. An API can pair an honest body with a
 * message built from a different one, pass the payload check, and obtain a
 * signature for a transaction nobody verified. Comparing a rebuilt message with
 * the one `prepare` returned binds the two, and is a payload check rather than
 * an envelope-echo check: the digest line is what commits the payload.
 *
 * Verification never relies on `body.desc`; it is API-authored and explicitly
 * not a security control. It is only required to be the description the signed
 * message carries, exactly like every other field in the template.
 */

import { decodeActionExecution, type DecodedAction } from "./decode";
import {
  SIGNED_MESSAGE_SERIALIZATION,
  signatureMessageFromBody,
} from "./signature";
import type { TxIntent, TxPreparedData } from "./types";

/** Which checks run. `full` (default) adds the envelope self-consistency checks. */
export type VerificationMode = "full" | "payload";

/** Options for {@link verifyPrepared} and {@link assertPrepared}. */
export interface VerifyPreparedOptions {
  /** `full` (default) or `payload`. */
  mode?: VerificationMode;
  /** The payload type `prepare` must have produced. Defaults to `"execute"`. */
  expectedPayloadType?: string;
}

/** A single difference between the prepared envelope and the intent. */
export type VerificationIssueCode =
  | "payload_decode"
  | "payload_type"
  | "namespace"
  | "action"
  | "call_count"
  | "argument_count"
  | "argument_type"
  | "argument_value"
  | "array_length"
  | "fee"
  | "nonce"
  | "chain_id"
  | "serialization"
  | "signature_message";

/** One difference, naming the path so a call site can point at the bad argument. */
export interface VerificationIssue {
  code: VerificationIssueCode;
  /** A dotted/bracketed path, e.g. `args[1]` or `body.fee`. */
  path: string;
  expected: unknown;
  actual: unknown;
  message: string;
}

/**
 * The outcome of {@link verifyPrepared}. It never throws: a mismatch, and a
 * payload that is not decodable at all, are both reported as issues.
 */
export interface VerificationResult {
  ok: boolean;
  issues: VerificationIssue[];
  /**
   * The decoded payload, so a caller can inspect what it was asked to sign.
   * `null` when the payload could not be decoded; `issues` then carries a
   * `payload_decode` entry rather than throwing.
   */
  decoded: DecodedAction | null;
}

/**
 * Thrown by {@link assertPrepared} when the prepared envelope does not match the
 * intent. `issues` names every difference found.
 */
export class PayloadVerificationError extends Error {
  readonly issues: VerificationIssue[];

  constructor(issues: VerificationIssue[]) {
    super(
      issues.length === 0
        ? "prepared transaction does not match the intent"
        : `prepared transaction does not match the intent: ${issues.map((i) => i.message).join("; ")}`,
    );
    this.name = "PayloadVerificationError";
    this.issues = issues;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Type canonicalisation (mirrors api/v1_tx.go txCanonicalType)
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_ALIASES: Record<string, string> = {
  text: "text",
  string: "text",
  int8: "int8",
  int: "int8",
  integer: "int8",
  bigint: "int8",
  int4: "int8",
  smallint: "int8",
  bool: "bool",
  boolean: "bool",
  bytea: "bytea",
  blob: "bytea",
  uuid: "uuid",
  numeric: "numeric",
  decimal: "numeric",
  null: "null",
};

interface CanonicalType {
  name: string;
  isArray: boolean;
  meta: [number, number];
}

/**
 * Turn a declared intent type into its canonical kwil name, mirroring the
 * server. Returns `null` for a type the server would reject (an unknown alias,
 * a bare `numeric`/`decimal`, or malformed precision/scale).
 */
function canonicalType(raw: string): CanonicalType | null {
  let s = raw.trim().toLowerCase();
  if (s === "") return null;
  let isArray = false;
  if (s.endsWith("[]")) {
    isArray = true;
    s = s.slice(0, -2).trim();
  }
  const paren = s.indexOf("(");
  if (paren !== -1) {
    if (!s.endsWith(")")) return null;
    const base = s.slice(0, paren).trim();
    if (TYPE_ALIASES[base] !== "numeric") return null;
    const parts = s.slice(paren + 1, -1).split(",");
    if (parts.length !== 2) return null;
    const precision = Number(parts[0].trim());
    const scale = Number(parts[1].trim());
    if (
      !Number.isInteger(precision) ||
      !Number.isInteger(scale) ||
      precision < 0 ||
      scale < 0 ||
      precision > 65535 ||
      scale > 65535
    ) {
      return null;
    }
    return { name: "numeric", isArray, meta: [precision, scale] };
  }
  const name = TYPE_ALIASES[s];
  if (name === undefined) return null;
  // A bare numeric/decimal is rejected: the server requires numeric(p,s).
  if (name === "numeric") return null;
  return { name, isArray, meta: [0, 0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decimal canonicalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reduce a decimal to a canonical form so two spellings of the same value
 * compare equal: `1.50`, `1.5`, `15e-1`, and `0.15e1` all normalise the same,
 * and exponent notation (`apd`'s `String()` emits `1E-7`) is expanded.
 *
 * Returns `null` when the input is not a decimal.
 */
export function canonicalDecimal(input: string | number): string | null {
  const raw = typeof input === "number" ? String(input) : input.trim();
  if (typeof input === "number" && !Number.isFinite(input)) return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (match === null) return null;
  const intPart = match[2] ?? "";
  const fracPart = match[3] ?? "";
  if (intPart === "" && fracPart === "") return null;
  let digits = intPart + fracPart;
  let exponent =
    (match[4] === undefined ? 0 : Number.parseInt(match[4], 10)) -
    fracPart.length;
  digits = digits.replace(/^0+/, "");
  if (digits === "") return "0";
  const trimmed = digits.replace(/0+$/, "");
  exponent += digits.length - trimmed.length;
  const sign = match[1] === "-" ? "-" : "";
  return `${sign}${trimmed}e${exponent}`;
}

/**
 * Canonicalise an intent or decoded value of unknown type.
 *
 * Unlike {@link canonicalDecimal}, this never throws: a `bigint`, a `number`,
 * and a decimal `string` are canonicalised, and any other value yields `null`
 * so the caller reports a mismatch instead of leaking a `TypeError`.
 */
function toCanonicalDecimal(value: unknown): string | null {
  if (typeof value === "bigint") return canonicalDecimal(value.toString());
  if (typeof value === "number") return canonicalDecimal(value);
  if (typeof value === "string") return canonicalDecimal(value);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte / bigint helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Hex (optional `0x`) to bytes. Throws on an odd length or a non-hex character. */
function hexToBytes(hex: string): Uint8Array {
  const body =
    hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || (body !== "" && !/^[0-9a-fA-F]*$/.test(body))) {
    throw new Error(`invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Convert an intent value to a bigint, rejecting unsafe JS numbers and non-integers. */
function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison
// ─────────────────────────────────────────────────────────────────────────────

interface Collector {
  issues: VerificationIssue[];
  push(issue: VerificationIssue): void;
}

function normalizeUuid(value: string): string {
  // The server parses a uuid with `uuid.Parse`, which accepts dashless, braced,
  // and canonical forms, then emits the canonical dashed form. Normalise both
  // sides so an intent written in any accepted shape still matches.
  return value.trim().toLowerCase().replace(/[{}-]/g, "");
}

function compareScalar(
  expected: unknown,
  name: string,
  actual: unknown,
  path: string,
  out: Collector,
): void {
  // A JSON null is a null argument regardless of the declared scalar type.
  if (expected === null) {
    if (actual !== null) {
      out.push({
        code: "argument_value",
        path,
        expected: null,
        actual,
        message: `${path} should be null`,
      });
    }
    return;
  }

  switch (name) {
    case "text": {
      if (typeof expected !== "string") {
        out.push({
          code: "argument_type",
          path,
          expected: "string",
          actual: expected,
          message: `${path} intent value is not a string`,
        });
        return;
      }
      if (actual !== expected) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} text does not match`,
        });
      }
      return;
    }
    case "uuid": {
      if (typeof expected !== "string") {
        out.push({
          code: "argument_type",
          path,
          expected: "uuid string",
          actual: expected,
          message: `${path} intent value is not a uuid string`,
        });
        return;
      }
      if (
        typeof actual !== "string" ||
        normalizeUuid(actual) !== normalizeUuid(expected)
      ) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} uuid does not match`,
        });
      }
      return;
    }
    case "int8": {
      const wanted = toBigInt(expected);
      if (wanted === null) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} intent is not a safe integer`,
        });
        return;
      }
      if (typeof actual !== "bigint" || actual !== wanted) {
        out.push({
          code: "argument_value",
          path,
          expected: wanted.toString(),
          actual: typeof actual === "bigint" ? actual.toString() : actual,
          message: `${path} int8 does not match`,
        });
      }
      return;
    }
    case "bool": {
      if (typeof expected !== "boolean") {
        out.push({
          code: "argument_type",
          path,
          expected: "boolean",
          actual: expected,
          message: `${path} intent value is not a boolean`,
        });
        return;
      }
      if (actual !== expected) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} bool does not match`,
        });
      }
      return;
    }
    case "bytea": {
      if (typeof expected !== "string") {
        out.push({
          code: "argument_type",
          path,
          expected: "hex string",
          actual: expected,
          message: `${path} intent value is not a hex string`,
        });
        return;
      }
      let wanted: Uint8Array;
      try {
        wanted = hexToBytes(expected);
      } catch {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} intent is not valid hex`,
        });
        return;
      }
      if (!(actual instanceof Uint8Array) || !bytesEqual(actual, wanted)) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} bytea does not match`,
        });
      }
      return;
    }
    case "numeric": {
      const wanted = toCanonicalDecimal(expected);
      const got = toCanonicalDecimal(actual);
      if (wanted === null) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} intent is not a decimal`,
        });
        return;
      }
      if (got === null || got !== wanted) {
        out.push({
          code: "argument_value",
          path,
          expected: wanted,
          actual,
          message: `${path} numeric does not match`,
        });
      }
      return;
    }
    case "null": {
      if (actual !== null) {
        out.push({
          code: "argument_value",
          path,
          expected: null,
          actual,
          message: `${path} should be null`,
        });
      }
      return;
    }
    default: {
      if (actual !== expected) {
        out.push({
          code: "argument_value",
          path,
          expected,
          actual,
          message: `${path} does not match`,
        });
      }
    }
  }
}

function compareArgument(
  expected: unknown,
  type: CanonicalType,
  isArray: boolean,
  actual: unknown,
  path: string,
  out: Collector,
): void {
  if (isArray) {
    // The server encodes a JSON null array as an empty array.
    const expectedArray = expected === null ? [] : expected;
    if (!Array.isArray(expectedArray)) {
      out.push({
        code: "argument_type",
        path,
        expected: "array",
        actual: expected,
        message: `${path} intent value is not an array`,
      });
      return;
    }
    if (!Array.isArray(actual)) {
      out.push({
        code: "argument_type",
        path,
        expected: "array",
        actual,
        message: `${path} decoded value is not an array`,
      });
      return;
    }
    if (actual.length !== expectedArray.length) {
      out.push({
        code: "array_length",
        path,
        expected: expectedArray.length,
        actual: actual.length,
        message: `${path} array length does not match`,
      });
    }
    const n = Math.min(actual.length, expectedArray.length);
    for (let i = 0; i < n; i += 1) {
      compareScalar(
        expectedArray[i],
        type.name,
        actual[i],
        `${path}[${i}]`,
        out,
      );
    }
    return;
  }
  compareScalar(expected, type.name, actual, path, out);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode the payload in `prepared` and compare it with `intent`. Returns a
 * result with every difference found; it does not throw for a mismatch.
 *
 * The payload is decoded with the native, dependency-free decoder, so this can
 * run in a browser without `@trufnetwork/kwil-js`.
 */
export function verifyPrepared(
  prepared: TxPreparedData,
  intent: TxIntent,
  options: VerifyPreparedOptions = {},
): VerificationResult {
  const issues: VerificationIssue[] = [];
  const out: Collector = { issues, push: (issue) => issues.push(issue) };

  // A payload that cannot be decoded is a verification failure, not an
  // exception: the envelope is unusable either way, and a caller that asked
  // "does this match?" deserves a typed answer, not a `RangeError`.
  let decoded: DecodedAction;
  try {
    decoded = decodeActionExecution(prepared.transaction.body.payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    out.push({
      code: "payload_decode",
      path: "transaction.body.payload",
      expected: "a decodable ActionExecution payload",
      actual: detail,
      message: `payload could not be decoded: ${detail}`,
    });
    return { ok: false, issues, decoded: null };
  }

  if (decoded.namespace !== intent.namespace) {
    out.push({
      code: "namespace",
      path: "namespace",
      expected: intent.namespace,
      actual: decoded.namespace,
      message: `namespace is ${decoded.namespace}, expected ${intent.namespace}`,
    });
  }
  if (decoded.action !== intent.action) {
    out.push({
      code: "action",
      path: "action",
      expected: intent.action,
      actual: decoded.action,
      message: `action is ${decoded.action}, expected ${intent.action}`,
    });
  }

  // `prepare` always builds exactly one call carrying every argument.
  if (decoded.arguments.length !== 1) {
    out.push({
      code: "call_count",
      path: "arguments",
      expected: 1,
      actual: decoded.arguments.length,
      message: `payload has ${decoded.arguments.length} call(s), expected 1`,
    });
  } else {
    const args = intent.args ?? [];
    const decodedArgs = decoded.arguments[0] ?? [];
    const decodedTypes = decoded.types[0] ?? [];
    if (decodedArgs.length !== args.length) {
      out.push({
        code: "argument_count",
        path: "args",
        expected: args.length,
        actual: decodedArgs.length,
        message: `payload has ${decodedArgs.length} argument(s), expected ${args.length}`,
      });
    }
    const n = Math.min(decodedArgs.length, args.length);
    for (let i = 0; i < n; i += 1) {
      const arg = args[i];
      const declared = canonicalType(arg.type);
      if (declared === null) {
        out.push({
          code: "argument_type",
          path: `args[${i}]`,
          expected: arg.type,
          actual: decodedTypes[i]?.name,
          message: `args[${i}] declares an unsupported type ${JSON.stringify(arg.type)}`,
        });
        continue;
      }
      const isArray = arg.is_array === true || declared.isArray;
      // A scalar JSON null is encoded as the `null` type, ignoring the declared type.
      const expectedName =
        arg.value === null && !isArray ? "null" : declared.name;
      const decodedType = decodedTypes[i];
      if (decodedType === undefined) {
        out.push({
          code: "argument_type",
          path: `args[${i}]`,
          expected: expectedName,
          actual: undefined,
          message: `args[${i}] has no decoded type`,
        });
      } else if (
        decodedType.name !== expectedName ||
        decodedType.isArray !== isArray ||
        (expectedName === "numeric" &&
          (decodedType.metadata[0] !== declared.meta[0] ||
            decodedType.metadata[1] !== declared.meta[1]))
      ) {
        out.push({
          code: "argument_type",
          path: `args[${i}]`,
          expected: `${expectedName}${isArray ? "[]" : ""}`,
          actual: `${decodedType.name}${decodedType.isArray ? "[]" : ""}`,
          message: `args[${i}] type is ${decodedType.name}${decodedType.isArray ? "[]" : ""}, expected ${expectedName}${isArray ? "[]" : ""}`,
        });
      }
      compareArgument(
        arg.value,
        declared,
        isArray,
        decodedArgs[i],
        `args[${i}]`,
        out,
      );
    }
  }

  // The signed message must be the one this body produces. Without this the
  // payload check proves what the body holds, not what the signature will
  // authorize: `sign` signs `signature_message` verbatim.
  if (prepared.transaction.serialization !== SIGNED_MESSAGE_SERIALIZATION) {
    out.push({
      code: "serialization",
      path: "transaction.serialization",
      expected: SIGNED_MESSAGE_SERIALIZATION,
      actual: prepared.transaction.serialization,
      message:
        `envelope serialization is ${String(prepared.transaction.serialization)}, ` +
        `expected ${JSON.stringify(SIGNED_MESSAGE_SERIALIZATION)}: the signed message ` +
        `can only be checked for the human-readable serialization`,
    });
  } else {
    const expectedMessage = signatureMessageFromBody(prepared.transaction.body);
    if (prepared.signature_message !== expectedMessage) {
      out.push({
        code: "signature_message",
        path: "signature_message",
        expected: expectedMessage,
        actual: prepared.signature_message,
        message:
          "the signature message does not match the prepared transaction body, " +
          "so signing it would authorize a different transaction",
      });
    }
  }

  if ((options.mode ?? "full") === "full") {
    const body = prepared.transaction.body;
    const expectedType = options.expectedPayloadType ?? "execute";
    if (body.type !== expectedType) {
      out.push({
        code: "payload_type",
        path: "body.type",
        expected: expectedType,
        actual: body.type,
        message: `payload type is ${body.type}, expected ${expectedType}`,
      });
    }
    const bodyFee = canonicalDecimal(body.fee);
    const preparedFee = canonicalDecimal(prepared.fee);
    if (bodyFee === null || preparedFee === null || bodyFee !== preparedFee) {
      out.push({
        code: "fee",
        path: "body.fee",
        expected: prepared.fee,
        actual: body.fee,
        message: `envelope fee is ${String(body.fee)}, prepare reported ${prepared.fee}`,
      });
    }
    if (body.nonce !== prepared.nonce) {
      out.push({
        code: "nonce",
        path: "body.nonce",
        expected: prepared.nonce,
        actual: body.nonce,
        message: `envelope nonce is ${String(body.nonce)}, prepare reported ${prepared.nonce}`,
      });
    }
    if (body.chain_id !== prepared.chain_id) {
      out.push({
        code: "chain_id",
        path: "body.chain_id",
        expected: prepared.chain_id,
        actual: body.chain_id,
        message: `envelope chain id is ${body.chain_id}, prepare reported ${prepared.chain_id}`,
      });
    }
  }

  return { ok: issues.length === 0, issues, decoded };
}

/**
 * Verify and throw {@link PayloadVerificationError} on the first difference.
 * A caller that wants the issues instead uses {@link verifyPrepared}.
 */
export function assertPrepared(
  prepared: TxPreparedData,
  intent: TxIntent,
  options?: VerifyPreparedOptions,
): VerificationResult {
  const result = verifyPrepared(prepared, intent, options);
  if (!result.ok) throw new PayloadVerificationError(result.issues);
  return result;
}
