/**
 * A test-only `EXECUTE_ACTION` encoder for the v1 mock API.
 *
 * `POST /tx/prepare` has to return a payload the client can decode and verify,
 * so the mock needs the inverse of `src/v1/decode.ts`. It is written from the
 * same wire contract (kwil-db `core/types`, little-endian framing, big-endian
 * `DataType`) and is deliberately kept here rather than in `src/`: it is test
 * scaffolding and must never reach the published bundle.
 *
 * Only the argument types the v1 contract accepts are encoded. A type this
 * mock cannot encode is a `MockEncodeError`, which the route turns into the
 * server's `400 invalid_argument on args`.
 */

import type { TxArg, TxIntent } from "../../src/v1/types";

/** Raised when the mock cannot encode an intent the way the server would. */
export class MockEncodeError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "MockEncodeError";
    this.field = field;
  }
}

const encoder = new TextEncoder();

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

/** A canonical kwil type, as the server coerces a declared intent type. */
interface CanonicalType {
  name: string;
  isArray: boolean;
  precision: number;
  scale: number;
}

const TYPE_ALIASES: Record<string, string> = {
  text: "text",
  string: "text",
  int8: "int8",
  int: "int8",
  integer: "int8",
  bool: "bool",
  boolean: "bool",
  bytea: "bytea",
  blob: "bytea",
  uuid: "uuid",
  numeric: "numeric",
  decimal: "numeric",
};

/**
 * Canonicalise a declared intent type the way `api/v1_tx.go` does, rejecting a
 * bare `numeric` (the server requires `numeric(p,s)` before it will estimate a
 * fee) and any type this mock does not model.
 */
function canonicalType(arg: TxArg, index: number): CanonicalType {
  if (typeof arg.type !== "string" || arg.type.trim() === "") {
    throw new MockEncodeError(
      `args[${index}].type`,
      "argument type is invalid",
    );
  }
  let raw = arg.type.trim().toLowerCase();
  let isArray = arg.is_array === true;
  if (raw.endsWith("[]")) {
    isArray = true;
    raw = raw.slice(0, -2).trim();
  }

  const paren = raw.indexOf("(");
  if (paren !== -1) {
    if (!raw.endsWith(")")) {
      throw new MockEncodeError(
        `args[${index}].type`,
        `argument type ${arg.type} is invalid`,
      );
    }
    const base = raw.slice(0, paren).trim();
    if (TYPE_ALIASES[base] !== "numeric") {
      throw new MockEncodeError(
        `args[${index}].type`,
        `argument type ${arg.type} is invalid`,
      );
    }
    const parts = raw.slice(paren + 1, -1).split(",");
    if (parts.length !== 2) {
      throw new MockEncodeError(
        `args[${index}].type`,
        `argument type ${arg.type} is invalid`,
      );
    }
    const precision = Number(parts[0]?.trim());
    const scale = Number(parts[1]?.trim());
    if (
      !Number.isInteger(precision) ||
      !Number.isInteger(scale) ||
      precision < 0 ||
      precision > 65535 ||
      scale < 0 ||
      scale > 65535
    ) {
      throw new MockEncodeError(
        `args[${index}].type`,
        `argument type ${arg.type} is invalid`,
      );
    }
    return { name: "numeric", isArray, precision, scale };
  }

  const name = TYPE_ALIASES[raw];
  if (name === undefined) {
    throw new MockEncodeError(
      `args[${index}].type`,
      `argument type ${arg.type} is not supported`,
    );
  }
  if (name === "numeric") {
    throw new MockEncodeError(
      `args[${index}].type`,
      "numeric argument has no precision and scale",
    );
  }
  return { name, isArray, precision: 0, scale: 0 };
}

function int64be(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt.asIntN(64, value), false);
  return out;
}

function hexToBytes(hex: string, field: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body === "" || body.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new MockEncodeError(field, "bytea value is not hex");
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function uuidToBytes(value: string, field: string): Uint8Array {
  const hex = value.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new MockEncodeError(field, "uuid value is not a UUID");
  }
  return hexToBytes(hex, field);
}

/** Encode one scalar payload, without the null flag. */
function scalarBytes(
  value: unknown,
  type: CanonicalType,
  field: string,
): Uint8Array {
  switch (type.name) {
    case "text":
      if (typeof value === "string") return encoder.encode(value);
      if (typeof value === "number" || typeof value === "boolean") {
        return encoder.encode(String(value));
      }
      throw new MockEncodeError(field, "text value is not a scalar");
    case "int8": {
      let big: bigint;
      if (typeof value === "bigint") big = value;
      else if (typeof value === "number" && Number.isSafeInteger(value)) {
        big = BigInt(value);
      } else if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        big = BigInt(value.trim());
      } else {
        throw new MockEncodeError(field, "int8 value is not an integer");
      }
      return int64be(big);
    }
    case "bool":
      if (typeof value !== "boolean") {
        throw new MockEncodeError(field, "bool value is not a boolean");
      }
      return u8(value ? 1 : 0);
    case "numeric":
      if (
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "string"
      ) {
        return encoder.encode(String(value));
      }
      throw new MockEncodeError(field, "numeric value is not a decimal");
    case "uuid":
      if (typeof value !== "string") {
        throw new MockEncodeError(field, "uuid value is not a string");
      }
      return uuidToBytes(value, field);
    case "bytea":
      if (typeof value !== "string") {
        throw new MockEncodeError(field, "bytea value is not a hex string");
      }
      return hexToBytes(value, field);
    default:
      throw new MockEncodeError(field, `type ${type.name} is not supported`);
  }
}

function encodeEncodedValue(
  value: unknown,
  type: CanonicalType,
  field: string,
): Uint8Array {
  // A scalar JSON null is encoded as the `null` type, ignoring the declared
  // type, exactly as the server does.
  const isNullScalar = !type.isArray && (value === null || value === undefined);
  const name = isNullScalar ? "null" : type.name;
  const nameBytes = encoder.encode(name);
  const dataType = concat(
    u16be(0),
    u32be(nameBytes.length),
    nameBytes,
    u8(type.isArray ? 1 : 0),
    u16be(isNullScalar ? 0 : type.precision),
    u16be(isNullScalar ? 0 : type.scale),
  );

  const elements: Uint8Array[] = [];
  if (isNullScalar) {
    // One null-flagged element; `decodeValue` ignores it for the `null` type.
    elements.push(new Uint8Array([0]));
  } else if (type.isArray) {
    // The server encodes a JSON null array as an empty array.
    const items = value === null || value === undefined ? [] : value;
    if (!Array.isArray(items)) {
      throw new MockEncodeError(field, "array value is not an array");
    }
    for (const item of items) {
      elements.push(
        item === null || item === undefined
          ? new Uint8Array([0])
          : concat(u8(1), scalarBytes(item, type, field)),
      );
    }
  } else {
    elements.push(concat(u8(1), scalarBytes(value, type, field)));
  }

  const parts: Uint8Array[] = [
    u16le(0),
    lenPrefixed(dataType),
    u16le(elements.length),
  ];
  for (const element of elements) parts.push(lenPrefixed(element));
  return concat(...parts);
}

/**
 * Encode a whole `EXECUTE_ACTION` payload for one intent: a single call
 * carrying every argument, which is what `prepare` always builds.
 */
export function encodeActionExecution(intent: TxIntent): Uint8Array {
  const args = intent.args ?? [];
  if (!Array.isArray(args)) {
    throw new MockEncodeError("args", "args must be an array");
  }
  if (args.length > 64) {
    throw new MockEncodeError("args", "args must contain at most 64 entries");
  }

  const parts: Uint8Array[] = [
    u16le(0),
    str(intent.namespace),
    str(intent.action),
    u16le(1),
    u16le(args.length),
  ];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === null || typeof arg !== "object") {
      throw new MockEncodeError(`args[${i}]`, "argument is not an object");
    }
    const type = canonicalType(arg, i);
    parts.push(
      lenPrefixed(encodeEncodedValue(arg.value, type, `args[${i}].value`)),
    );
  }
  return concat(...parts);
}
