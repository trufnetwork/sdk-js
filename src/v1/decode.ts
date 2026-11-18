/**
 * A native, dependency-free decoder for kwil `EXECUTE_ACTION` payloads.
 *
 * This is the kwil-free replacement for `src/util/TransactionPayload.ts`, which
 * delegates to `@trufnetwork/kwil-js`. The layout is a consensus contract, so it
 * is reproduced here byte-for-byte and pinned by golden vectors in
 * `decode.test.ts` (cross-checked against kwil-js as a test-only oracle).
 *
 * Wire layout (from kwil-db `core/types`):
 *
 * ActionExecution (little-endian):
 *   - uint16 version (0)
 *   - WriteString(namespace): uint32-LE length + UTF-8 bytes
 *   - WriteString(action):    uint32-LE length + UTF-8 bytes
 *   - uint16 numCalls
 *   - per call: uint16 numArgs, then per value: WriteBytes(EncodedValue bytes)
 *
 * EncodedValue (little-endian):
 *   - uint16 version (0)
 *   - WriteBytes(DataType bytes)
 *   - uint16 numData
 *   - per data: WriteBytes(bytes)
 *
 * DataType (big-endian internally):
 *   - uint16 version (0)
 *   - uint32 nameLen
 *   - name UTF-8 bytes
 *   - uint8 isArray
 *   - uint16 metadata[0] (precision), uint16 metadata[1] (scale)
 *
 * Each value's data bytes are null-flagged: `[0]` means null; `[1, ...actual]`
 * means non-null with `actual` as the payload.
 */

/** A decoded `DataType` tag, surfaced for verification. */
export interface DecodedArgType {
  /** The canonical kwil type name, e.g. `text`, `int8`, `numeric`, `null`. */
  name: string;
  /** Whether the argument is an array. */
  isArray: boolean;
  /** `[precision, scale]`; both zero for non-numeric types. */
  metadata: [number, number];
}

/** The decoded shape of an `execute` payload. */
export interface DecodedAction {
  /** The action namespace (kwil-db's `Namespace`). */
  namespace: string;
  /** The action name. */
  action: string;
  /** The batched calls, each an array of native JavaScript values. */
  arguments: unknown[][];
  /**
   * The declared type of each argument, aligned with `arguments`. Verification
   * needs this to reject a type swap whose values happen to decode alike (for
   * example `text` versus `uuid`, which both decode to a string).
   */
  types: DecodedArgType[][];
}

/** A decoded `DataType` tag (internal, mutable-free view). */
type DecodedDataType = DecodedArgType;

/** A decoded `EncodedValue`: its type and the raw null-flagged data elements. */
interface DecodedEncodedValue {
  type: DecodedDataType;
  data: Uint8Array[];
}

class ByteReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private ensure(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new RangeError(
        `unexpected end of payload: need ${n} byte(s) at offset ${this.offset}, ` +
          `only ${this.bytes.length - this.offset} remaining`,
      );
    }
  }

  readUint8(): number {
    this.ensure(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readUint16LE(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint16BE(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  readUint32LE(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUint32BE(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  readRaw(n: number): Uint8Array {
    this.ensure(n);
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /**
   * Reads a 4-byte little-endian length prefix and that many bytes (kwil-db
   * `ReadBytes`). A nil slice is written as `0xFFFFFFFF`; it surfaces as empty.
   */
  readLenPrefixed(): Uint8Array {
    const len = this.readUint32LE();
    if (len === 0xffffffff) return new Uint8Array(0);
    return this.readRaw(len);
  }

  readString(): string {
    return decodeText(this.readLenPrefixed());
  }
}

// The node keeps a string's raw bytes, so decoding must not change them: keep a
// leading U+FEFF (`ignoreBOM`) and refuse invalid UTF-8 (`fatal`) instead of
// turning it into U+FFFD. Otherwise two different payloads decode to the same
// string and verification cannot tell them apart.
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeText(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch {
    throw new Error("string is not valid UTF-8");
  }
}

/**
 * Decode a base64 string (or pass through raw bytes) to a `Uint8Array`.
 * Uses the platform `atob`, available in browsers and Node 18+.
 */
export function base64ToBytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** Encode raw bytes to base64 (the inverse of {@link base64ToBytes}). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeDataType(bytes: Uint8Array): DecodedDataType {
  const r = new ByteReader(bytes);
  const version = r.readUint16BE();
  if (version !== 0) {
    throw new Error(`unsupported DataType version ${version}`);
  }
  const nameLen = r.readUint32BE();
  const name = decodeText(r.readRaw(nameLen));
  const isArrayByte = r.readUint8();
  if (isArrayByte !== 0 && isArrayByte !== 1) {
    throw new Error(`invalid is_array byte ${isArrayByte}`);
  }
  const metadata: [number, number] = [r.readUint16BE(), r.readUint16BE()];
  return { name, isArray: isArrayByte === 1, metadata };
}

function decodeEncodedValue(bytes: Uint8Array): DecodedEncodedValue {
  const r = new ByteReader(bytes);
  const version = r.readUint16LE();
  if (version !== 0) {
    throw new Error(`unsupported EncodedValue version ${version}`);
  }
  const type = decodeDataType(r.readLenPrefixed());
  const dataLen = r.readUint16LE();
  const data: Uint8Array[] = [];
  for (let i = 0; i < dataLen; i += 1) {
    data.push(r.readLenPrefixed());
  }
  return { type, data };
}

/** Decode a scalar element's null flag and payload, then the value. */
function decodeScalar(element: Uint8Array, typeName: string): unknown {
  if (element.length === 0) return null;
  const nullFlag = element[0];
  if (nullFlag === 0) return null;
  if (nullFlag !== 1) {
    throw new Error(`expected 0 or 1 for null-flag byte, got ${nullFlag}`);
  }
  const data = element.subarray(1);
  switch (typeName) {
    case "text":
      return decodeText(data);
    case "int8":
      if (data.length !== 8) {
        throw new Error(`int8 must be 8 bytes, got ${data.length}`);
      }
      return new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ).getBigInt64(0, false);
    case "bool":
      if (data.length !== 1) {
        throw new Error(`bool must be 1 byte, got ${data.length}`);
      }
      return data[0] === 1;
    case "bytea":
      return data.slice();
    case "uuid":
      if (data.length !== 16) {
        throw new Error(`uuid must be 16 bytes, got ${data.length}`);
      }
      return bytesToUuid(data);
    case "numeric":
      return decodeText(data);
    case "null":
      return null;
    default:
      throw new Error(`cannot decode type ${typeName}`);
  }
}

/** Decode one `EncodedValue` (scalar or array) to a native value. */
function decodeValue(ev: DecodedEncodedValue): unknown {
  if (ev.type.isArray) {
    return ev.data.map((element) => decodeScalar(element, ev.type.name));
  }
  if (ev.type.name === "null") {
    return null;
  }
  if (ev.data.length !== 1) {
    throw new Error(
      `expected 1 element for scalar ${ev.type.name}, got ${ev.data.length}`,
    );
  }
  return decodeScalar(ev.data[0], ev.type.name);
}

/** Format 16 raw UUID bytes as a dashed lowercase UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Decode a kwil `EXECUTE_ACTION` payload into its namespace, action and batched
 * native arguments. Accepts raw bytes or a base64 string.
 *
 * @throws If the payload is truncated, uses an unsupported version or an
 * unknown type, or holds a string that is not valid UTF-8.
 */
export function decodeActionExecution(
  payload: string | Uint8Array,
): DecodedAction {
  const bytes = base64ToBytes(payload);
  const r = new ByteReader(bytes);
  const version = r.readUint16LE();
  if (version !== 0) {
    throw new Error(`unsupported ActionExecution version ${version}`);
  }
  const namespace = r.readString();
  const action = r.readString();
  const numCalls = r.readUint16LE();
  const calls: unknown[][] = [];
  const types: DecodedArgType[][] = [];
  for (let i = 0; i < numCalls; i += 1) {
    const numArgs = r.readUint16LE();
    const call: unknown[] = [];
    const callTypes: DecodedArgType[] = [];
    for (let j = 0; j < numArgs; j += 1) {
      const ev = decodeEncodedValue(r.readLenPrefixed());
      call.push(decodeValue(ev));
      callTypes.push({
        name: ev.type.name,
        isArray: ev.type.isArray,
        metadata: ev.type.metadata,
      });
    }
    calls.push(call);
    types.push(callTypes);
  }
  return { namespace, action, arguments: calls, types };
}
