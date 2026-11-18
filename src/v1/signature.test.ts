/**
 * Tests for the signature-message builder and its SHA-256.
 *
 * The message is what closes the gap between "verified" and "signed": `sign`
 * signs the API's `signature_message` verbatim, so the client must be able to
 * rebuild that message from the body it actually verified. The format is pinned
 * three ways here:
 *
 *  1. A hand-assembled golden string taken from kwil's `txMsgToSignTmplV0`
 *     (`kwil-db/core/types/transaction.go`), whitespace included.
 *  2. SHA-256 checked against the FIPS 180-4 vectors.
 *  3. SHA-256 checked against precomputed `node:crypto` digests across the
 *     padding and block boundaries, so the local implementation cannot drift
 *     from a reference one.
 *
 * `node:crypto` is not imported: `scripts/esbuild.ts` bundles every file under
 * `src/**` for the browser too, where a `node:` specifier does not resolve, so
 * the reference digests are inlined rather than recomputed here.
 */

import { describe, expect, it } from "vitest";

import {
  payloadDigest,
  sha256,
  signatureMessageFromBody,
  SIGNED_MESSAGE_SERIALIZATION,
} from "./signature";
import type { TxBody } from "./types";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const BODY: TxBody = {
  desc: "main.place_order",
  payload: "AAECAwQ=",
  type: "execute",
  fee: "1000",
  nonce: 7,
  chain_id: "tn-test",
};

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
    expect(toHex(sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb924" + "27ae41e4649b934ca495991b7852b855",
    );
    expect(toHex(sha256(encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223" + "b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      toHex(
        sha256(
          encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        ),
      ),
    ).toBe(
      "248d6a61d20638b8e5c026930c3e6039" + "a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with a reference implementation across the block boundaries", () => {
    // Input bytes follow the same rule the reference digests were made with:
    // byte i is (i * 31 + 7) & 0xff. 55/56/57 straddle the point where the
    // length field no longer fits in the final block; 63/64/65 straddle a
    // block; 119/120/121 repeat both one block later.
    const reference: Record<number, string> = {
      55: "8aa994584139d128848eeebc4e815639ba5ab6e6e39574195a63ac4f14f7c43b",
      56: "ad574708f75c044c9b85de64cb568ee7711ff4f36448c6242f053ba8f6cc2b63",
      57: "5b46e502092be01b1100193e089fdda95638c12e19a1d24f308eb2c3d3ae849d",
      63: "280ed3e8ff1df845b2e7dfe6ac6cee817bef20e783cc65abc41b818b4d2fe076",
      64: "c6ab9724ade5b6a7a1edfffb12f3aa9181351355af8fd08c919952ad211339dd",
      65: "788367c73c7ddf4c53f65e68cc0d943e6227ab55b0e78ba63ace822b1c6301c0",
      119: "3d610547d68216dedf7435a4fb6260353911f6b3fd3f18805ddb8be285d726fe",
      120: "1f80156a804cb7862ad113e8200e9d74499723e7c7854d5f48776d3148e09656",
      121: "614571410beab3df68d50132a341d338575653da8374c630441bbe380b9b3136",
      200: "44cae5223d431caed4a9e32271d6abf17c3f2f4abac45fcdb48a99fcc6072a09",
    };

    for (const [rawLength, digest] of Object.entries(reference)) {
      const length = Number(rawLength);
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) data[i] = (i * 31 + 7) & 0xff;
      expect(toHex(sha256(data))).toBe(digest);
    }
  });

  it("rejects a non-Uint8Array input instead of hashing something else", () => {
    expect(() => sha256("abc" as unknown as Uint8Array)).toThrow(/Uint8Array/);
  });
});

describe("payloadDigest", () => {
  it("is the first 20 bytes of sha256(payload), lowercase hex", () => {
    // sha256(0x00 0x01 0x02 0x03 0x04) = 08bb5e5d...
    expect(payloadDigest(new Uint8Array([0, 1, 2, 3, 4]))).toBe(
      "08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5",
    );
  });
});

describe("signatureMessageFromBody", () => {
  it("renders kwil's txMsgToSignTmplV0 byte for byte", () => {
    expect(signatureMessageFromBody(BODY)).toBe(
      "main.place_order\n" +
        "\n" +
        "PayloadType: execute\n" +
        "PayloadDigest: 08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5\n" +
        "Fee: 1000\n" +
        "Nonce: 7\n" +
        "\n" +
        "Kwil Chain ID: tn-test\n",
    );
  });

  it("keeps the trailing newline the node includes", () => {
    expect(signatureMessageFromBody(BODY).endsWith("tn-test\n")).toBe(true);
  });

  it("treats a missing description as the empty string", () => {
    const noDesc: TxBody = { ...BODY, desc: undefined };
    expect(signatureMessageFromBody(noDesc).startsWith("\n\nPayloadType")).toBe(
      true,
    );
  });

  it("binds the description, payload, type, fee, nonce and chain id", () => {
    const base = signatureMessageFromBody(BODY);
    for (const mutated of [
      { ...BODY, desc: "main.cancel_order" },
      { ...BODY, payload: "AAECAwU=" },
      { ...BODY, type: "transfer" },
      { ...BODY, fee: "1001" },
      { ...BODY, nonce: 8 },
      { ...BODY, chain_id: "tn-other" },
    ]) {
      expect(signatureMessageFromBody(mutated)).not.toBe(base);
    }
  });

  it("renders a fee given as a JSON number the same as a decimal string", () => {
    expect(signatureMessageFromBody({ ...BODY, fee: 1000 })).toBe(
      signatureMessageFromBody({ ...BODY, fee: "1000" }),
    );
  });
});

describe("SIGNED_MESSAGE_SERIALIZATION", () => {
  it("is the concat serialization the node assigns to a created transaction", () => {
    expect(SIGNED_MESSAGE_SERIALIZATION).toBe("concat");
  });
});
