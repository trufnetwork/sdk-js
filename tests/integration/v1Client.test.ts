import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Wallet } from "ethers";
import {
  assertPrepared,
  bytesToBase64,
  collectCursor,
  PayloadVerificationError,
  V1ApiError,
  V1Client,
} from "../../src/v1";
import type { TnSigner, TxBody, TxEnvelope, TxIntent } from "../../src/v1";
import { encodeActionExecution } from "./mockV1Payload";

/**
 * Integration tests for the kwil-free v1 client against a live API.
 *
 * These are opt-in and skip unless a deployment is provided, so `npm run
 * test:integration` stays usable without one:
 *
 *   TEST_V1_BASE_URL=https://api.trufscan.io TEST_V1_NETWORK=mainnet \
 *     npx vitest run tests/integration/v1Client.test.ts
 *
 * ## Credentials
 *
 * Only `GET /capabilities` is readable anonymously (`accessOptional`). Every
 * data namespace is `accessRequired`, so the market reads below need a bearer
 * credential. Provide one of:
 *
 *   TEST_V1_CREDENTIAL=<bearer token>   use a token obtained elsewhere
 *   TEST_V1_ORIGIN=http://localhost:8090
 *                                       mint the public preset lazily; the
 *                                       same value is sent as `Origin`, which
 *                                       the mint requires
 *
 * A token minted for an origin is bound to it, so pass `TEST_V1_ORIGIN` with a
 * credential too when the deployment mints origin-bound tokens. The market
 * tests skip when neither variable is set.
 *
 * ## Writes
 *
 * The trade tests actually broadcast a transaction, so they are gated a second
 * time on `TEST_V1_WRITE=1`. That flag is set by `npm run test:v1:mock` (which
 * runs this file against the in-memory mock) and never by a live deployment
 * run, so an accidental `test:integration` cannot place an order. Set it
 * deliberately against a throwaway deployment to exercise the write path.
 *
 * The signer is a real wallet, because the mock recovers the signer from the
 * signature. `TEST_V1_PRIVATE_KEY` selects it; the fallback is a public test
 * key, so a live write run should set the variable instead of trading from an
 * account anyone can sign for.
 */

const baseUrl = process.env.TEST_V1_BASE_URL;
const network = process.env.TEST_V1_NETWORK ?? "mainnet";
const token = process.env.TEST_V1_CREDENTIAL;
const origin = process.env.TEST_V1_ORIGIN;
/** Writes are a second opt-in, so a live read-only run never trades. */
const canWrite = process.env.TEST_V1_WRITE === "1";

/** Reads under a data namespace need a credential; `capabilities` does not. */
const canAuthenticate = token !== undefined || origin !== undefined;

/**
 * A market id that is syntactically valid but cannot exist: the route parses
 * `id` as the integer `query_id`, and a serial column never reaches int32 max.
 * A non-numeric id is `400 invalid_argument` on `id`, not `not_found`.
 */
const ABSENT_MARKET_ID = "2147483647";

/** The v1 data namespaces, so a test can pick one the deployment does not offer. */
const DATA_NAMESPACES = [
  "agents",
  "bridge",
  "chain",
  "health",
  "markets",
  "metadata",
  "streams",
  "tx",
];

function makeAnonClient(): V1Client {
  if (baseUrl === undefined) throw new Error("TEST_V1_BASE_URL is not set");
  return new V1Client({ baseUrl, network });
}

function makeClient(signer?: TnSigner): V1Client {
  if (baseUrl === undefined) throw new Error("TEST_V1_BASE_URL is not set");
  return new V1Client({
    baseUrl,
    network,
    ...(token !== undefined ? { token } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(signer !== undefined ? { signer } : {}),
    ...(token === undefined && origin !== undefined
      ? { credentialStrategy: { kind: "public" as const } }
      : {}),
  });
}

/**
 * A real `personal_sign` signer. The mock recovers the signer from the
 * signature, so a fixed buffer would be rejected the way the node rejects it.
 *
 * The fallback key is a public, well-known test key, which is fine against the
 * mock and a throwaway deployment. Point `TEST_V1_PRIVATE_KEY` at a real key
 * before a live write run, so the trades are not submitted from an account
 * anyone can sign for.
 */
const TEST_WALLET = new Wallet(
  process.env.TEST_V1_PRIVATE_KEY ||
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SIGNER_ADDRESS = TEST_WALLET.address;
const TEST_SIGNER: TnSigner = {
  address: SIGNER_ADDRESS,
  signMessage: (message) => TEST_WALLET.signMessage(message),
};

/**
 * The `concat` signature message for `body`, rebuilt here as a stand-in for
 * "another SDK's encoder" (`kwil-db/core/types/transaction.go`,
 * `txMsgToSignTmplV0`).
 */
function kwilSignatureMessage(body: TxBody): string {
  const digest = createHash("sha256")
    .update(body.payload, "base64")
    .digest()
    .subarray(0, 20)
    .toString("hex");
  return (
    `${body.desc ?? ""}\n\n` +
    `PayloadType: ${body.type}\n` +
    `PayloadDigest: ${digest}\n` +
    `Fee: ${String(body.fee)}\n` +
    `Nonce: ${String(body.nonce)}\n\n` +
    `Kwil Chain ID: ${body.chain_id}\n`
  );
}

/**
 * A trade intent whose arguments cover the scalar types the server can encode
 * (`int8`, `numeric(p,s)`, `text`, `bool`), so a prepare → verify round trip
 * exercises the decoder rather than only the transport.
 */
const TRADE_INTENT: TxIntent = {
  namespace: "main",
  action: "place_order",
  sender: SIGNER_ADDRESS,
  args: [
    { type: "int8", value: 1 },
    { type: "numeric(18,6)", value: "10.5" },
    { type: "text", value: "buy" },
    { type: "bool", value: true },
  ],
};

describe.skipIf(baseUrl === undefined)("v1 client against a live API", () => {
  it("serves a capabilities document with at least one namespace", async () => {
    const client = makeClient();

    const caps = await client.capabilitiesApi.get();

    expect(typeof caps.network).toBe("string");
    expect(Array.isArray(caps.namespaces)).toBe(true);
    expect(caps.namespaces.length).toBeGreaterThan(0);
  });

  it("gates a namespace from the cached capabilities document", async () => {
    const client = makeClient();

    const caps = await client.loadCapabilities();
    const offered = caps.namespaces[0] ?? "";
    expect(offered).not.toBe("");

    expect(client.supportsNamespace(offered)).toBe(true);
    expect(client.namespace(offered).name).toBe(offered);
  });

  it.skipIf(!canAuthenticate)(
    "returns a market page with an opaque cursor",
    async () => {
      const client = makeClient();

      const page = await client.markets.list("", { query: { limit: 5 } });

      expect(page.ok).toBe(true);
      expect(Array.isArray(page.data)).toBe(true);
      expect(
        page.meta_data.cursor === null ||
          typeof page.meta_data.cursor === "string",
      ).toBe(true);
    },
  );

  it.skipIf(!canAuthenticate)(
    "walks at most one page through the shared cursor walker",
    async () => {
      const client = makeClient();

      const items = await collectCursor(
        (cursor, signal) =>
          client.markets.list("", { cursor, signal, query: { limit: 2 } }),
        { maxPages: 1 },
      );

      expect(items.length).toBeLessThanOrEqual(2);
    },
  );

  it.skipIf(!canAuthenticate)(
    "collects a list whose data is an object through rows",
    async () => {
      const client = makeClient();
      const first = await client.markets.list<{ query_id: number }>("", {
        query: { limit: 1 },
      });
      const id = first.data[0]?.query_id;
      expect(typeof id).toBe("number");

      // markets/{id}/activity keeps the v0 object as data; the rows are events.
      const events = await client.markets.collect(`${String(id)}/activity`, {
        limit: 2,
        maxPages: 2,
        rows: (data: { events: unknown[] }) => data.events,
      });

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeLessThanOrEqual(4);
    },
  );

  it.skipIf(!canAuthenticate)(
    "surfaces an absent market as a typed not_found error",
    async () => {
      const client = makeClient();

      const error = await client.markets
        .market(ABSENT_MARKET_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(V1ApiError);
      const apiError = error as V1ApiError;
      expect(apiError.status).toBe(404);
      expect(apiError.code).toBe("not_found");
    },
  );

  it("rejects a gated read that carries no credential", async () => {
    const client = makeAnonClient();

    const error = await client.markets
      .list("", { query: { limit: 1 } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(V1ApiError);
    const apiError = error as V1ApiError;
    expect(apiError.status).toBe(401);
    expect(apiError.code).toBe("unauthenticated");
  });

  it("surfaces an unoffered namespace as the server's 409", async () => {
    const caps = await makeClient().loadCapabilities();
    const unoffered = DATA_NAMESPACES.find(
      (name) => !caps.namespaces.includes(name),
    );
    if (unoffered === undefined) return;

    // This client has not loaded capabilities, so it does not gate locally and
    // the server is the authority.
    const client = makeClient();
    const error = await client
      .namespace(unoffered)
      .entity("")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(V1ApiError);
    const apiError = error as V1ApiError;
    expect(apiError.status).toBe(409);
    expect(apiError.code).toBe("namespace_unavailable");
  });
});

describe.skipIf(baseUrl === undefined)(
  "v1 client trade flow against a live API",
  () => {
    it.skipIf(!canWrite)(
      "places a trade end to end and reads back its receipt",
      async () => {
        const client = makeClient(TEST_SIGNER);

        const result = await client.tx.submit(TRADE_INTENT);

        expect(result.broadcast.tx_hash).toMatch(/^[0-9a-f]{64}$/);
        // The mock recovers the signer, so a signature that does not belong to
        // the declared sender would have failed the broadcast above.
        expect(result.signed.signature?.type).toBe("secp256k1_ep");
        expect(result.signed.sender).toBe(
          SIGNER_ADDRESS.slice(2).toLowerCase(),
        );
        expect(
          Buffer.from(result.signed.signature?.sig ?? "", "base64"),
        ).toHaveLength(65);

        const receipt = await client.tx.get(result.broadcast.tx_hash);
        expect(receipt.tx_hash).toBe(result.broadcast.tx_hash);
        expect(receipt.height).toBeGreaterThanOrEqual(0);
      },
    );

    it.skipIf(!canWrite)(
      "verifies the server's payload against the submitted intent",
      async () => {
        const client = makeClient(TEST_SIGNER);

        const prepared = await client.tx.prepare(TRADE_INTENT);
        const verdict = client.tx.verify(prepared, TRADE_INTENT);

        expect(verdict.issues).toEqual([]);
        expect(verdict.ok).toBe(true);
        expect(verdict.decoded?.namespace).toBe(TRADE_INTENT.namespace);
        expect(verdict.decoded?.action).toBe(TRADE_INTENT.action);

        const result = await client.tx.submit(TRADE_INTENT, { verify: true });
        expect(result.broadcast.tx_hash).toMatch(/^[0-9a-f]{64}$/);
      },
    );

    it.skipIf(!canWrite)(
      "detects a payload that does not match the submitted intent",
      async () => {
        const client = makeClient(TEST_SIGNER);

        const prepared = await client.tx.prepare(TRADE_INTENT);
        const tampered: TxIntent = { ...TRADE_INTENT, action: "cancel_order" };

        expect(() => assertPrepared(prepared, tampered)).toThrow(
          PayloadVerificationError,
        );

        const verdict = client.tx.verify(prepared, tampered);
        expect(verdict.ok).toBe(false);
        expect(verdict.issues.some((issue) => issue.code === "action")).toBe(
          true,
        );
      },
    );

    it.skipIf(!canWrite)(
      "relays an envelope assembled outside the client's sign helper",
      async () => {
        const client = makeClient();

        // The nonce and chain id come from the read endpoint, not from a
        // `prepare` response, and the payload is encoded by non-client code.
        // That is the AC3 claim: any SDK's signed envelope relays as-is.
        const params = await client.tx.params(SIGNER_ADDRESS);
        const body: TxBody = {
          desc: `${TRADE_INTENT.namespace}.${TRADE_INTENT.action}`,
          payload: bytesToBase64(encodeActionExecution(TRADE_INTENT)),
          type: "execute",
          fee: "0",
          nonce: params.nonce,
          chain_id: params.chain_id,
        };
        const signature = await TEST_WALLET.signMessage(
          kwilSignatureMessage(body),
        );
        const envelope: TxEnvelope = {
          body,
          serialization: "concat",
          signature: {
            sig: bytesToBase64(
              new Uint8Array(Buffer.from(signature.slice(2), "hex")),
            ),
            type: "secp256k1_ep",
          },
          sender: params.sender,
        };

        const broadcast = await client.tx.broadcast(envelope);
        expect(broadcast.tx_hash).toMatch(/^[0-9a-f]{64}$/);
      },
    );
  },
);
