import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./decode";
import { signatureMessageFromBody } from "./signature";
import { TxApi, TxWaitTimeoutError, type TnSigner } from "./tx";
import type { TxBody, TxEnvelope, TxIntent, TxPreparedData } from "./types";
import { Transport } from "./transport";
import { PayloadVerificationError } from "./verify";

/**
 * Tests for the write path: sign → broadcast → receipt, and the opt-in verify
 * step. `broadcast` is exercised as a pure passthrough (a hand-built envelope is
 * relayed without a prior `prepare`), which is the SDK-side evidence for AC3.
 */

const SENDER = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const BARE_SENDER = "abcdef0123456789abcdef0123456789abcdef01";
const HASH = "c".repeat(64);
const SIGNATURE = new Uint8Array(65).fill(9);

// ── A minimal text-only `execute` encoder for the prepared fixture ───────────

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

function textEncodedValue(value: string): Uint8Array {
  const name = encoder.encode("text");
  const dataType = concat(
    u16be(0),
    u32be(name.length),
    name,
    u8(0),
    u16be(0),
    u16be(0),
  );
  return concat(
    u16le(0),
    lenPrefixed(dataType),
    u16le(1),
    lenPrefixed(concat(u8(1), encoder.encode(value))),
  );
}

function textPayload(namespace: string, action: string, value: string): string {
  const bytes = concat(
    u16le(0),
    str(namespace),
    str(action),
    u16le(1),
    u16le(1),
    lenPrefixed(textEncodedValue(value)),
  );
  return bytesToBase64(bytes);
}

const intent: TxIntent = {
  namespace: "main",
  action: "place_trade",
  sender: SENDER,
  args: [{ type: "text", value: "hello" }],
};

function makePrepared(
  payload: string,
  fee = "1000",
  nonce = 1,
): TxPreparedData {
  const body: TxBody = {
    payload,
    type: "execute",
    fee,
    nonce,
    chain_id: "tn-test",
  };
  return {
    transaction: { body, serialization: "concat" },
    // The real message for this body: `verify` refuses a `prepare` that
    // returns anything else.
    signature_message: signatureMessageFromBody(body),
    fee,
    nonce,
    chain_id: "tn-test",
  };
}

const prepared = makePrepared(textPayload("main", "place_trade", "hello"));

function toHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function makeSigner(overrides: Partial<TnSigner> = {}): {
  signer: TnSigner;
  seen: Uint8Array[];
} {
  const seen: Uint8Array[] = [];
  const signer: TnSigner = {
    address: SENDER,
    signMessage: async (message) => {
      seen.push(message);
      return toHex(SIGNATURE);
    },
    ...overrides,
  };
  return { signer, seen };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const envelope = (data: unknown): unknown => ({
  ok: true,
  data,
  meta_data: { cursor: null, data_version: "1" },
});

interface TxHarness {
  tx: TxApi;
  calls: Array<{ url: string; body: unknown }>;
}

function makeTx(
  handler: (url: string, body: unknown) => Response | Promise<Response>,
  signer?: TnSigner,
): TxHarness {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const body =
      init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url: String(input), body });
    return handler(String(input), body);
  };
  const transport = new Transport({
    baseUrl: "https://api.example.com",
    network: "mainnet",
    fetch: fetchImpl,
  });
  return { tx: new TxApi(transport, signer), calls };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("TxApi.sign", () => {
  it("adds a base64 signature and a bare lowercase sender without mutating the prepare response", async () => {
    const { signer, seen } = makeSigner();
    const { tx } = makeTx(() => jsonResponse(envelope({})), signer);

    const signed = await tx.sign(prepared);

    expect(signed.signature).toEqual({
      sig: bytesToBase64(SIGNATURE),
      type: "secp256k1_ep",
    });
    expect(signed.sender).toBe(BARE_SENDER);
    expect(signed.body).toEqual(prepared.transaction.body);
    expect(prepared.transaction.signature).toBeUndefined();
    expect(prepared.transaction.sender).toBeUndefined();
    // `sign` encodes `signature_message` byte for byte; it does not rebuild it.
    expect(prepared.signature_message).toContain("PayloadDigest: ");
    expect(Array.from(seen[0] ?? [])).toEqual(
      Array.from(encoder.encode(prepared.signature_message)),
    );
  });

  it("accepts raw signature bytes and a custom signature type", async () => {
    const { signer } = makeSigner({
      signMessage: async () => SIGNATURE,
      signatureType: "ed25519",
    });
    const { tx } = makeTx(() => jsonResponse(envelope({})), signer);

    const signed = await tx.sign(prepared);

    expect(signed.signature).toEqual({
      sig: bytesToBase64(SIGNATURE),
      type: "ed25519",
    });
  });

  it("rejects a signature that is not 65 bytes", async () => {
    const { signer } = makeSigner({
      signMessage: async () => toHex(new Uint8Array(64)),
    });
    const { tx } = makeTx(() => jsonResponse(envelope({})), signer);

    await expect(tx.sign(prepared)).rejects.toThrow(/65 bytes/);
  });

  it("requires a signer", async () => {
    const { tx } = makeTx(() => jsonResponse(envelope({})));
    await expect(tx.sign(prepared)).rejects.toThrow(/TnSigner/);
  });
});

describe("TxApi.broadcast", () => {
  it("relays a hand-built signed envelope without a prior prepare (AC3 passthrough)", async () => {
    const manual: TxEnvelope = {
      body: {
        payload: textPayload("main", "place_trade", "hello"),
        type: "execute",
        fee: "1000",
        nonce: 1,
        chain_id: "tn-test",
      },
      serialization: "concat",
      signature: { sig: bytesToBase64(SIGNATURE), type: "secp256k1_ep" },
      sender: BARE_SENDER,
    };
    const { tx, calls } = makeTx(() =>
      jsonResponse(envelope({ tx_hash: HASH })),
    );

    const result = await tx.broadcast(manual);

    expect(result).toEqual({ tx_hash: HASH });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/tx/broadcast",
    );
    expect(calls[0]?.body).toEqual(manual);
  });

  it("rejects an unsigned envelope before any request", async () => {
    const { tx, calls } = makeTx(() =>
      jsonResponse(envelope({ tx_hash: HASH })),
    );

    await expect(tx.broadcast(prepared.transaction)).rejects.toThrow(
      /not signed/,
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects an envelope whose signature has no sig", async () => {
    const { tx } = makeTx(() => jsonResponse(envelope({ tx_hash: HASH })));
    const unsigned = {
      ...prepared.transaction,
      signature: { sig: "", type: "secp256k1_ep" },
    };

    await expect(tx.broadcast(unsigned)).rejects.toThrow(/sig/);
  });
});

describe("TxApi.submit", () => {
  it("prepares, signs and broadcasts (verification opt-in, off by default)", async () => {
    const { signer } = makeSigner();
    const { tx, calls } = makeTx((url) => {
      if (url.endsWith("/tx/prepare")) return jsonResponse(envelope(prepared));
      if (url.endsWith("/tx/broadcast"))
        return jsonResponse(envelope({ tx_hash: HASH }));
      return jsonResponse(
        { ok: false, error: { code: "not_found", message: "no" } },
        404,
      );
    }, signer);

    const result = await tx.submit(intent);

    expect(result.broadcast).toEqual({ tx_hash: HASH });
    expect(result.signed.sender).toBe(BARE_SENDER);
    expect(result.signed.signature?.sig).toBe(bytesToBase64(SIGNATURE));
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.com/mainnet/v1/tx/prepare",
      "https://api.example.com/mainnet/v1/tx/broadcast",
    ]);
  });

  it("verifies and broadcasts a matching payload when asked", async () => {
    const { signer } = makeSigner();
    const { tx } = makeTx((url) => {
      if (url.endsWith("/tx/prepare")) return jsonResponse(envelope(prepared));
      return jsonResponse(envelope({ tx_hash: HASH }));
    }, signer);

    const result = await tx.submit(intent, { verify: true });
    expect(result.broadcast.tx_hash).toBe(HASH);
  });

  it("refuses to broadcast a payload that does not match the intent", async () => {
    const tampered = makePrepared(textPayload("main", "place_trade", "evil"));
    const { signer } = makeSigner();
    const { tx, calls } = makeTx((url) => {
      if (url.endsWith("/tx/prepare")) return jsonResponse(envelope(tampered));
      return jsonResponse(envelope({ tx_hash: HASH }));
    }, signer);

    await expect(tx.submit(intent, { verify: true })).rejects.toThrow(
      PayloadVerificationError,
    );
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.example.com/mainnet/v1/tx/prepare",
    ]);
  });

  it("waits for the receipt when asked", async () => {
    const { signer } = makeSigner();
    const { tx } = makeTx((url) => {
      if (url.endsWith("/tx/prepare")) return jsonResponse(envelope(prepared));
      if (url.endsWith("/tx/broadcast"))
        return jsonResponse(envelope({ tx_hash: HASH }));
      return jsonResponse(
        envelope({ tx_hash: HASH, height: 3, tx: null, tx_result: null }),
      );
    }, signer);

    const result = await tx.submit(intent, {
      wait: { intervalMs: 1, timeoutMs: 100 },
    });

    expect(result.receipt?.height).toBe(3);
  });
});

describe("TxApi reads", () => {
  it("validates the sender and sends it as a query parameter", async () => {
    const { tx, calls } = makeTx(() =>
      jsonResponse(
        envelope({ sender: BARE_SENDER, nonce: 4, chain_id: "tn-test" }),
      ),
    );

    const params = await tx.params(SENDER);

    expect(params.nonce).toBe(4);
    expect(calls[0]?.url).toBe(
      "https://api.example.com/mainnet/v1/tx/params?sender=0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
    );
    await expect(tx.params("nope")).rejects.toThrow(/sender/);
  });

  it("validates the transaction hash and lowercases it in the path", async () => {
    const { tx, calls } = makeTx(() =>
      jsonResponse(
        envelope({ tx_hash: HASH, height: 7, tx: null, tx_result: null }),
      ),
    );

    const receipt = await tx.get(`0x${"C".repeat(64)}`);

    expect(receipt.height).toBe(7);
    expect(calls[0]?.url).toBe(`https://api.example.com/mainnet/v1/tx/${HASH}`);
    await expect(tx.get("xyz")).rejects.toThrow(/32 bytes/);
  });

  it("returns the events array", async () => {
    const events = [{ type: "Transfer" }];
    const { tx, calls } = makeTx(() => jsonResponse(envelope(events)));

    expect(await tx.events(HASH)).toEqual(events);
    expect(calls[0]?.url).toBe(
      `https://api.example.com/mainnet/v1/tx/${HASH}/events`,
    );
  });

  it("retries a pending 404 and returns the mined receipt", async () => {
    let receipts = 0;
    const { tx, calls } = makeTx(() => {
      receipts += 1;
      if (receipts === 1) {
        return jsonResponse(
          { ok: false, error: { code: "not_found", message: "pending" } },
          404,
        );
      }
      return jsonResponse(
        envelope({ tx_hash: HASH, height: 5, tx: null, tx_result: null }),
      );
    });

    const receipt = await tx.waitForReceipt(HASH, {
      intervalMs: 1,
      timeoutMs: 100,
    });

    expect(receipt.height).toBe(5);
    expect(calls).toHaveLength(2);
  });

  it("times out when the receipt never appears", async () => {
    const { tx } = makeTx(() =>
      jsonResponse(
        { ok: false, error: { code: "not_found", message: "pending" } },
        404,
      ),
    );

    await expect(
      tx.waitForReceipt(HASH, { intervalMs: 1, timeoutMs: 10 }),
    ).rejects.toThrow(TxWaitTimeoutError);
  });
});
