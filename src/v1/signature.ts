/**
 * The signature message a `prepare` envelope commits to, rebuilt from the
 * envelope's own `body`.
 *
 * `sign` signs whatever `signature_message` the API returned. `verifyPrepared`
 * decides whether the envelope is acceptable. Nothing else ties those two
 * together, so an API could return an honest body next to a message built from
 * a different one: the payload check passes, the wallet signs the other
 * transaction, and the node accepts it. Rebuilding the message from the body
 * and comparing it with the server's copy closes that gap — the signed bytes
 * then provably commit to the body that was verified.
 *
 * The format is kwil's `txMsgToSignTmplV0` (`kwil-db/core/types/transaction.go`),
 * which `SerializeMsg` renders for the `concat` serialization the node assigns
 * to every created transaction (`DefaultSignedMsgSerType`):
 *
 * ```
 * <description>
 *
 * PayloadType: <type>
 * PayloadDigest: <hex of the first 20 bytes of sha256(payload)>
 * Fee: <fee>
 * Nonce: <nonce>
 *
 * Kwil Chain ID: <chain_id>
 * ```
 *
 * The trailing newline is part of the message, and every byte of it is signed.
 * This is the same template kwil-js builds in `PayloadTx.signTx`.
 *
 * `sha256` is implemented here rather than taken from WebCrypto or a package:
 * WebCrypto would force {@link verifyPrepared} to become async and is absent in
 * non-secure browser contexts, and a package would put a third-party module in
 * the browser entry. A small hash is cheaper than either on a payload that is
 * tens of bytes.
 */

import { base64ToBytes } from "./decode";
import type { TxBody } from "./types";

/**
 * The only serialization whose message is a UTF-8 string the client can check.
 * `direct` is a raw hash, so it cannot be compared against a text message.
 */
export const SIGNED_MESSAGE_SERIALIZATION = "concat";

/** The 20-byte `PayloadDigest` line: `sha256(payload)`, truncated, lowercase hex. */
export function payloadDigest(payload: Uint8Array): string {
  return toHex(sha256(payload).subarray(0, 20));
}

/**
 * Rebuild the exact UTF-8 message the node will verify the signature against,
 * from the fields the node will sign over.
 *
 * The body comes from the API, so this is not a trusted input: it is the thing
 * being checked. Callers compare the result with `prepared.signature_message`.
 */
export function signatureMessageFromBody(body: TxBody): string {
  const digest = payloadDigest(base64ToBytes(body.payload));
  // `\n\n` before `PayloadType` and before `Kwil Chain ID`, and a trailing `\n`
  // after the chain id, are all part of the template.
  return (
    `${body.desc ?? ""}\n` +
    `\n` +
    `PayloadType: ${body.type}\n` +
    `PayloadDigest: ${digest}\n` +
    `Fee: ${String(body.fee)}\n` +
    `Nonce: ${String(body.nonce)}\n` +
    `\n` +
    `Kwil Chain ID: ${body.chain_id}\n`
  );
}

/** Lowercase hex, matching Go's `%x` on a byte slice. */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256 (FIPS 180-4)
// ─────────────────────────────────────────────────────────────────────────────

// Round constants: the first 32 bits of the fractional parts of the cube roots
// of the first 64 primes.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Initial hash state: the first 32 bits of the fractional parts of the square
// roots of the first 8 primes.
const INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

/**
 * SHA-256 of `data`, big-endian. Pure TypeScript so verification stays
 * synchronous and works where `crypto.subtle` is unavailable.
 */
export function sha256(data: Uint8Array): Uint8Array {
  if (!(data instanceof Uint8Array)) {
    throw new Error("sha256 expects a Uint8Array");
  }

  // Pad to a multiple of 64 bytes: 0x80, zeros, then the 64-bit bit length.
  const paddedLength = (((data.length + 9 + 63) >> 6) << 6) >>> 0;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Split the bit length so the high word survives counts above 2^32 bits.
  const bitLength = data.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = INITIAL.slice();
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) {
    outView.setUint32(i * 4, hash[i]!, false);
  }
  return out;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}
