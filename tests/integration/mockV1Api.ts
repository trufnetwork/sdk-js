/**
 * An in-memory mock of the consolidated v1 API.
 *
 * It exists so the kwil-free client can be exercised against a real HTTP server
 * without a deployment: the "database" is a seeded, immutable dataset held in
 * memory and served through the same envelopes the contract returns.
 *
 * It is not a full stand-in for the real API, but it does enforce the
 * behaviours the client must react to: every data namespace requires a bearer
 * credential (`401 unauthenticated` without one), a namespace the network does
 * not offer is `409 namespace_unavailable`, and `POST /tx/broadcast` rebuilds
 * the `concat` signature message from the envelope body and recovers the signer
 * with `ethers`, so a signature the node would reject fails here too.
 * `GET /capabilities` is readable anonymously and `POST /credentials` mints, as
 * in the contract.
 *
 * Only the routes the v1 integration suite reads are implemented
 * (`capabilities`, `credentials`, `markets`, `markets/{id}`,
 * `markets/{id}/activity` (whose `data` is an object, as on the server), and the `tx` read
 * and write path: `tx/params`, `tx/prepare`, `tx/broadcast`, `tx/{hash}`);
 * anything else answers a typed `not_found`. The point is to prove transport,
 * envelope parsing, credential acquisition, cursor handling, typed errors and a
 * full prepare → sign → broadcast → receipt trade end to end — not to
 * reimplement the service.
 *
 * Nothing here ships: `tests/` is outside the bundler's `src/**` glob, and this
 * file is not a `*.test.ts`, so vitest does not run it as a suite.
 */

import { Buffer } from "node:buffer";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

import { verifyMessage } from "ethers";

import type { TxArg, TxIntent } from "../../src/v1/types";
import { encodeActionExecution, MockEncodeError } from "./mockV1Payload";

/** One row of the mock `markets` table. */
export interface MockMarket {
  /** The route key, `GET /markets/{id}`. */
  id: string;
  /** The market id as the server's rows carry it: the same number as `id`. */
  query_id: number;
  question: string;
  status: "open" | "closed";
  created_at: string;
}

/** The seeded dataset the mock serves. */
export interface MockV1Database {
  /** The network segment in the path; requests for another network are `404`. */
  network: string;
  /** The `chain_id` sealed into a prepared envelope, and checked on receipt. */
  chainId: string;
  /** The namespaces listed by `GET /capabilities`. */
  namespaces: string[];
  /** The rows behind `GET /markets` and `GET /markets/{id}`. */
  markets: MockMarket[];
  /** Echoed as `meta_data.data_version`. */
  dataVersion: string;
}

/** The default dataset: a small, deterministic market list. */
export const DEFAULT_MOCK_DB: MockV1Database = {
  network: "mainnet",
  chainId: "mock-chain",
  namespaces: ["chain", "health", "markets", "streams", "tx"],
  dataVersion: "mock-v1",
  markets: [
    {
      id: "1",
      query_id: 1,
      question: "Will BTC close above 100k this year?",
      status: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "2",
      query_id: 2,
      question: "Will ETH close above 5k this year?",
      status: "open",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "3",
      query_id: 3,
      question: "Will TRUF hold at or above 1 USD?",
      status: "closed",
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
};

/** A running mock, with the URL to point `TEST_V1_BASE_URL` at. */
export interface RunningMockV1Api {
  /** For example `http://127.0.0.1:41337` — no trailing slash. */
  baseUrl: string;
  /** The network segment the mock answers for. */
  network: string;
  /** Stop the listener; resolves once the server is closed. */
  close(): Promise<void>;
}

/** Options for {@link startMockV1Api}. */
export interface MockV1ApiOptions {
  /** Bind host. Defaults to `127.0.0.1`, so nothing is exposed off-host. */
  host?: string;
  /** TCP port. Defaults to `0` (an ephemeral port chosen by the OS). */
  port?: number;
}

const DEFAULT_PAGE_LIMIT = 10;
const MAX_PAGE_LIMIT = 100;
const DEFAULT_HOST = "127.0.0.1";
/** The v1 data namespaces, for the `409 namespace_unavailable` gate. */
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

/** Per-server state: the credentials this mock has minted, and its write path. */
interface MockState {
  issued: Set<string>;
  counter: number;
  /** The next nonce `prepare` hands out; 1-based, as the node's first nonce is 1. */
  nextNonce: number;
  /** Broadcast envelopes, keyed by their tx hash. */
  txs: Map<string, { height: number; envelope: unknown }>;
}

function validateDatabase(db: MockV1Database): void {
  if (typeof db.network !== "string" || !/^[A-Za-z0-9._-]+$/.test(db.network)) {
    throw new Error(`invalid mock network: ${String(db.network)}`);
  }
  if (typeof db.chainId !== "string" || db.chainId === "") {
    throw new Error("mock chainId must be a non-empty string");
  }
  if (typeof db.dataVersion !== "string" || db.dataVersion === "") {
    throw new Error("mock dataVersion must be a non-empty string");
  }
  if (!Array.isArray(db.namespaces) || db.namespaces.length === 0) {
    throw new Error("mock namespaces must be a non-empty array");
  }
  for (const namespace of db.namespaces) {
    if (typeof namespace !== "string" || !/^[a-z0-9_-]+$/i.test(namespace)) {
      throw new Error(`invalid mock namespace: ${String(namespace)}`);
    }
  }
  if (!Array.isArray(db.markets)) {
    throw new Error("mock markets must be an array");
  }
  const seen = new Set<string>();
  for (const market of db.markets) {
    if (typeof market.id !== "string" || market.id === "") {
      throw new Error("every mock market needs a non-empty id");
    }
    if (
      !Number.isSafeInteger(market.query_id) ||
      market.id !== String(market.query_id)
    ) {
      throw new Error(
        `mock market ${market.id} needs an integer query_id written the same way`,
      );
    }
    if (seen.has(market.id)) {
      throw new Error(`duplicate mock market id: ${market.id}`);
    }
    seen.add(market.id);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(payload)),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function sendSuccess(
  res: ServerResponse,
  data: unknown,
  cursor: string | null,
  dataVersion: string,
): void {
  sendJson(res, 200, {
    ok: true,
    data,
    meta_data: { cursor, data_version: dataVersion },
  });
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): void {
  sendJson(res, status, {
    ok: false,
    error:
      details === undefined ? { code, message } : { code, message, details },
  });
}

/** An opaque cursor: the client must copy it verbatim, never parse it. */
function encodeCursor(offset: number): string {
  return btoa(`mock-cursor:${offset}`);
}

/** Returns the offset, or `null` when the cursor is not one this mock issued. */
function decodeCursor(cursor: string): number | null {
  let decoded: string;
  try {
    decoded = atob(cursor);
  } catch {
    return null;
  }
  const prefix = "mock-cursor:";
  if (!decoded.startsWith(prefix)) return null;
  const raw = decoded.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  const offset = Number(raw);
  return Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_PAGE_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_PAGE_LIMIT) {
    return null;
  }
  return limit;
}

/**
 * Send one cursor page of `rows`. `wrap` shapes the page into `data`: the rows
 * themselves on most lists, or the v0 object that holds them on the lists that
 * kept that shape (for example `markets/{id}/activity`).
 */
function sendPage<T>(
  res: ServerResponse,
  url: URL,
  rows: readonly T[],
  wrap: (page: T[]) => unknown,
  dataVersion: string,
): void {
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === null) {
    sendError(
      res,
      400,
      "bad_request",
      `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
      { field: "limit" },
    );
    return;
  }

  const rawCursor = url.searchParams.get("cursor");
  let offset = 0;
  if (rawCursor !== null) {
    const decoded = decodeCursor(rawCursor);
    if (decoded === null) {
      sendError(res, 400, "bad_request", "cursor is not valid", {
        field: "cursor",
      });
      return;
    }
    offset = decoded;
  }
  if (offset > rows.length) offset = rows.length;

  const page = rows.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const cursor = nextOffset < rows.length ? encodeCursor(nextOffset) : null;
  sendJson(res, 200, {
    ok: true,
    data: wrap(page),
    meta_data: { cursor, data_version: dataVersion },
  });
}

function handleMarketsList(
  res: ServerResponse,
  url: URL,
  db: MockV1Database,
): void {
  sendPage(res, url, db.markets, (page) => page, db.dataVersion);
}

/**
 * `GET /markets/{id}/activity`: like the real route, `data` is an object and
 * the rows are its `events`. Each market has three seeded events.
 */
function handleMarketActivity(
  res: ServerResponse,
  url: URL,
  db: MockV1Database,
  market: MockMarket,
): void {
  const events = [1, 2, 3].map((n) => ({
    id: `${market.id}-${n}`,
    event_type: "place",
  }));
  sendPage(
    res,
    url,
    events,
    (page) => ({ query_id: Number(market.id), events: page }),
    db.dataVersion,
  );
}

/** The largest request body the mock will read; the real API bounds broadcast too. */
const MAX_BODY_BYTES = 256 * 1024;

type ParsedBody = { ok: true; value: unknown } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonBody(bytes: Uint8Array): ParsedBody {
  if (bytes.length === 0) return { ok: false };
  const text = new TextDecoder().decode(bytes);
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // Copy each chunk: `Buffer` is a `Uint8Array` but its `ArrayBufferLike`
    // backing store makes it incompatible with a plain `Uint8Array[]` under
    // the current lib types, and `Buffer.concat` would trip the same mismatch.
    const chunks: Uint8Array[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(new Uint8Array(chunk));
    });
    req.on("end", () => {
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(out);
    });
    req.on("error", reject);
  });
}

type IntentParse =
  | { ok: true; intent: TxIntent }
  | { ok: false; field: string };

/** Validate a `prepare` body the way `readTxIntent` does, field by field. */
function parseIntent(value: unknown): IntentParse {
  if (!isRecord(value)) return { ok: false, field: "body" };
  if (typeof value.namespace !== "string" || value.namespace.trim() === "") {
    return { ok: false, field: "namespace" };
  }
  if (typeof value.action !== "string" || value.action.trim() === "") {
    return { ok: false, field: "action" };
  }
  if (typeof value.sender !== "string" || value.sender.trim() === "") {
    return { ok: false, field: "sender" };
  }
  if (value.args !== undefined && !Array.isArray(value.args)) {
    return { ok: false, field: "args" };
  }

  const args: TxArg[] = [];
  if (Array.isArray(value.args)) {
    for (const raw of value.args) {
      if (!isRecord(raw) || typeof raw.type !== "string") {
        return { ok: false, field: "args" };
      }
      args.push({
        type: raw.type,
        value: raw.value,
        ...(typeof raw.is_array === "boolean"
          ? { is_array: raw.is_array }
          : {}),
      });
    }
  }

  return {
    ok: true,
    intent: {
      namespace: value.namespace,
      action: value.action,
      sender: value.sender,
      args,
    },
  };
}

/**
 * kwil's `SerializeMsg` for the `concat` serialization: the UTF-8 text the node
 * hashes and recovers the signer from.
 *
 * Written out from the Go template (`kwil-db/core/types/transaction.go`,
 * `txMsgToSignTmplV0`) rather than imported from `src/v1/signature.ts`, so the
 * client's copy is checked against an independent one. The digest is the first
 * 20 bytes of `sha256(payload)`, lowercase hex.
 */
function serializedSignatureMessage(body: {
  desc: string;
  type: string;
  payload: Uint8Array;
  fee: string;
  nonce: number;
  chain_id: string;
}): string {
  const digest = createHash("sha256")
    .update(body.payload)
    .digest()
    .subarray(0, 20)
    .toString("hex");
  return (
    `${body.desc}\n\n` +
    `PayloadType: ${body.type}\n` +
    `PayloadDigest: ${digest}\n` +
    `Fee: ${body.fee}\n` +
    `Nonce: ${body.nonce}\n\n` +
    `Kwil Chain ID: ${body.chain_id}\n`
  );
}

type EnvelopeMessage =
  | { ok: true; message: string }
  | { ok: false; field: string };

/**
 * Rebuild the signed text from an envelope body, which is untrusted input.
 * Returns the offending field instead of throwing when the body is malformed.
 */
function messageFromEnvelopeBody(
  body: Record<string, unknown>,
): EnvelopeMessage {
  if (typeof body.payload !== "string" || body.payload === "") {
    return { ok: false, field: "payload" };
  }
  if (typeof body.type !== "string" || body.type === "") {
    return { ok: false, field: "type" };
  }
  // The wire type for `*big.Int` is a JSON string, so a non-integer here is not
  // a fee the node would accept.
  if (typeof body.fee !== "string" || !/^\d+$/.test(body.fee)) {
    return { ok: false, field: "fee" };
  }
  if (
    typeof body.nonce !== "number" ||
    !Number.isSafeInteger(body.nonce) ||
    body.nonce < 0
  ) {
    return { ok: false, field: "nonce" };
  }
  if (typeof body.chain_id !== "string" || body.chain_id === "") {
    return { ok: false, field: "chain_id" };
  }
  if (body.desc !== undefined && typeof body.desc !== "string") {
    return { ok: false, field: "desc" };
  }

  return {
    ok: true,
    message: serializedSignatureMessage({
      desc: typeof body.desc === "string" ? body.desc : "",
      type: body.type,
      payload: new Uint8Array(Buffer.from(body.payload, "base64")),
      fee: body.fee,
      nonce: body.nonce,
      chain_id: body.chain_id,
    }),
  };
}

/**
 * `POST /tx/prepare`: encode the intent server-side, exactly as the real API
 * does, and return the unsigned envelope plus the message to sign.
 */
async function handleTxPrepare(
  req: IncomingMessage,
  res: ServerResponse,
  db: MockV1Database,
  state: MockState,
): Promise<void> {
  const parsed = parseJsonBody(await readBody(req));
  if (!parsed.ok) {
    sendError(res, 400, "invalid_argument", "invalid body", { field: "body" });
    return;
  }
  const parsedIntent = parseIntent(parsed.value);
  if (!parsedIntent.ok) {
    sendError(res, 400, "invalid_argument", `invalid ${parsedIntent.field}`, {
      field: parsedIntent.field,
    });
    return;
  }
  const intent = parsedIntent.intent;

  let payload: Uint8Array;
  try {
    payload = encodeActionExecution(intent);
  } catch (error) {
    if (error instanceof MockEncodeError) {
      sendError(res, 400, "invalid_argument", error.message, {
        field: error.field,
      });
      return;
    }
    throw error;
  }

  state.nextNonce += 1;
  const nonce = state.nextNonce;
  const fee = "0";
  const desc = `${intent.namespace}.${intent.action}`;
  const signatureMessage = serializedSignatureMessage({
    desc,
    type: "execute",
    payload,
    fee,
    nonce,
    chain_id: db.chainId,
  });

  sendSuccess(
    res,
    {
      transaction: {
        body: {
          desc,
          payload: Buffer.from(payload).toString("base64"),
          type: "execute",
          fee,
          nonce,
          chain_id: db.chainId,
        },
        // `CreateTransaction` always assigns the concat serialization, so the
        // message above is the one the node will hash.
        serialization: "concat",
      },
      signature_message: signatureMessage,
      fee,
      nonce,
      chain_id: db.chainId,
    },
    null,
    db.dataVersion,
  );
}

/**
 * `POST /tx/broadcast`: accept an already-signed envelope from any SDK, with no
 * prior `prepare`, and return its hash. That passthrough is AC3.
 */
async function handleTxBroadcast(
  req: IncomingMessage,
  res: ServerResponse,
  db: MockV1Database,
  state: MockState,
): Promise<void> {
  const parsed = parseJsonBody(await readBody(req));
  if (!parsed.ok || !isRecord(parsed.value)) {
    sendError(res, 400, "invalid_argument", "invalid body", { field: "body" });
    return;
  }
  const envelope = parsed.value;
  if (!isRecord(envelope.body)) {
    sendError(res, 400, "invalid_argument", "envelope has no body", {
      field: "body",
    });
    return;
  }
  const signature = envelope.signature;
  if (
    !isRecord(signature) ||
    typeof signature.sig !== "string" ||
    signature.sig === ""
  ) {
    sendError(res, 400, "invalid_argument", "envelope is not signed", {
      field: "body",
    });
    return;
  }
  // Mirror the node's admission check: only the personal-sign and plain
  // secp256k1 authenticators are registered, and each accepts a sender of the
  // matching shape. A test that signs with the wrong type must fail here, not
  // pass because only `sig` was inspected.
  const type = signature.type;
  if (type !== "secp256k1_ep" && type !== "secp256k1") {
    sendError(res, 400, "invalid_argument", "unknown signature type", {
      field: "body",
    });
    return;
  }
  const senderHex =
    typeof envelope.sender === "string"
      ? envelope.sender.replace(/^0x/i, "").toLowerCase()
      : "";
  const senderBytes = /^[0-9a-f]*$/.test(senderHex) ? senderHex.length / 2 : -1;
  const wantSenderBytes = type === "secp256k1_ep" ? 20 : 33;
  if (senderBytes !== wantSenderBytes) {
    sendError(
      res,
      400,
      "invalid_argument",
      "sender is invalid for the signature type",
      { field: "body" },
    );
    return;
  }

  // Recover the signer, as the node does. Only `concat` has a text message a
  // mock can rebuild; `direct` signs a hash and is out of scope here.
  if (envelope.serialization !== "concat") {
    sendError(res, 400, "invalid_argument", "unsupported serialization", {
      field: "body",
    });
    return;
  }
  const rebuilt = messageFromEnvelopeBody(envelope.body);
  if (!rebuilt.ok) {
    sendError(
      res,
      400,
      "invalid_argument",
      `envelope body has an invalid ${rebuilt.field}`,
      { field: "body" },
    );
    return;
  }
  if (type === "secp256k1_ep") {
    let recovered: string;
    try {
      recovered = verifyMessage(
        rebuilt.message,
        `0x${Buffer.from(signature.sig, "base64").toString("hex")}`,
      )
        .replace(/^0x/i, "")
        .toLowerCase();
    } catch {
      sendError(
        res,
        400,
        "invalid_argument",
        "signature does not recover to a signer",
        { field: "body" },
      );
      return;
    }
    if (recovered !== senderHex) {
      sendError(
        res,
        400,
        "invalid_argument",
        "signature does not recover to the envelope sender",
        { field: "body" },
      );
      return;
    }
  }

  const hash = createHash("sha256")
    .update(JSON.stringify(envelope.body))
    .digest("hex");
  state.txs.set(hash, { height: 1, envelope });
  sendSuccess(res, { tx_hash: hash }, null, db.dataVersion);
}

/** `GET /tx/params`: the nonce and chain id a caller needs to build its own payload. */
function handleTxParams(
  res: ServerResponse,
  url: URL,
  db: MockV1Database,
  state: MockState,
): void {
  const raw = url.searchParams.get("sender") ?? "";
  const sender = (raw.startsWith("0x") ? raw.slice(2) : raw).toLowerCase();
  if (!/^([0-9a-f]{40}|[0-9a-f]{66})$/.test(sender)) {
    sendError(res, 400, "invalid_argument", "sender is invalid", {
      field: "sender",
    });
    return;
  }
  // The nonce the next `prepare` will hand out; the node's first nonce is 1.
  sendSuccess(
    res,
    { sender, nonce: state.nextNonce + 1, chain_id: db.chainId },
    null,
    db.dataVersion,
  );
}

/** `GET /tx/{hash}`: the receipt of a broadcast transaction, or `404`. */
function handleTxReceipt(
  res: ServerResponse,
  db: MockV1Database,
  state: MockState,
  raw: string,
): void {
  const hash = (raw.startsWith("0x") ? raw.slice(2) : raw).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    sendError(res, 400, "invalid_argument", "hash is invalid", {
      field: "hash",
    });
    return;
  }
  const entry = state.txs.get(hash);
  if (entry === undefined) {
    sendError(res, 404, "not_found", `transaction ${hash} does not exist`, {
      field: "hash",
    });
    return;
  }
  sendSuccess(
    res,
    {
      tx_hash: hash,
      height: entry.height,
      tx: entry.envelope,
      tx_result: {},
    },
    null,
    db.dataVersion,
  );
}

/** Await a write handler, answering 500 instead of leaving the socket hanging. */
function runTx(res: ServerResponse, pending: Promise<void>): Promise<void> {
  return pending.catch((error: unknown) => {
    if (!res.headersSent) {
      sendError(res, 500, "internal", "mock handler failed");
    } else {
      res.end();
    }
    console.error("mock v1 API handler failed:", error);
  });
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  db: MockV1Database,
  state: MockState,
): void {
  const url = new URL(req.url ?? "/", "http://mock.local");
  const segments = url.pathname.split("/").filter((s) => s !== "");
  // /{network}/v1/{rest...}
  if (segments.length < 3 || segments[1] !== "v1") {
    sendError(res, 404, "not_found", `no route for ${url.pathname}`);
    return;
  }
  if (segments[0] !== db.network) {
    sendError(
      res,
      404,
      "not_found",
      `network ${segments[0] ?? ""} is not served`,
    );
    return;
  }

  const [head, ...tail] = segments.slice(2);

  // Ungated: minting is how a caller gets a credential in the first place.
  if (req.method === "POST" && head === "credentials" && tail.length === 0) {
    state.counter += 1;
    const credential = `mock-token-${state.counter}`;
    state.issued.add(credential);
    sendSuccess(
      res,
      {
        credential,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
      null,
      db.dataVersion,
    );
    return;
  }

  // Capabilities is accessOptional: anonymous callers are served.
  if (req.method === "GET" && head === "capabilities" && tail.length === 0) {
    sendSuccess(
      res,
      { network: db.network, namespaces: db.namespaces },
      null,
      db.dataVersion,
    );
    return;
  }

  // A data namespace the network does not offer is 409, decided before any
  // credential is parsed, as the real router does.
  const name = head ?? "";
  if (DATA_NAMESPACES.includes(name) && !db.namespaces.includes(name)) {
    sendError(
      res,
      409,
      "namespace_unavailable",
      `namespace ${name} is not available on network ${db.network}`,
    );
    return;
  }

  // Everything else is accessRequired.
  const authorization = req.headers.authorization ?? "";
  const bearer = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (bearer === "" || !state.issued.has(bearer)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    sendError(res, 401, "unauthenticated", "credential is missing or rejected");
    return;
  }

  // `tx` is `accessRequired` like every other data namespace, and it is the only
  // one with a write path: `prepare` and `broadcast` are POST, the receipt is GET.
  if (head === "tx") {
    if (req.method === "POST" && tail.length === 1 && tail[0] === "prepare") {
      void runTx(res, handleTxPrepare(req, res, db, state));
      return;
    }
    if (req.method === "POST" && tail.length === 1 && tail[0] === "broadcast") {
      void runTx(res, handleTxBroadcast(req, res, db, state));
      return;
    }
    if (req.method === "GET" && tail.length === 1 && tail[0] === "params") {
      handleTxParams(res, url, db, state);
      return;
    }
    if (req.method === "GET" && tail.length === 1) {
      handleTxReceipt(res, db, state, tail[0] ?? "");
      return;
    }
  }

  if (req.method !== "GET") {
    sendError(
      res,
      405,
      "method_not_allowed",
      `method ${req.method} is not allowed`,
    );
    return;
  }

  if (head === "markets") {
    if (tail.length === 0) {
      handleMarketsList(res, url, db);
      return;
    }
    if (tail.length === 1 || (tail.length === 2 && tail[1] === "activity")) {
      let id: string;
      try {
        id = decodeURIComponent(tail[0] ?? "");
      } catch {
        sendError(res, 400, "invalid_argument", "query_id is invalid", {
          field: "id",
        });
        return;
      }
      if (!/^\d+$/.test(id)) {
        sendError(res, 400, "invalid_argument", "query_id is invalid", {
          field: "id",
        });
        return;
      }
      const market = db.markets.find((row) => row.id === id);
      if (market === undefined) {
        sendError(res, 404, "not_found", `market ${id} does not exist`, {
          field: "id",
        });
        return;
      }
      if (tail.length === 2) {
        handleMarketActivity(res, url, db, market);
        return;
      }
      sendSuccess(res, market, null, db.dataVersion);
      return;
    }
  }

  sendError(res, 404, "not_found", `no route for ${url.pathname}`);
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

/**
 * Start the mock on an ephemeral port (by default) and return its base URL.
 *
 * The caller owns the lifetime: pass `baseUrl` to `TEST_V1_BASE_URL` and call
 * `close()` when done.
 */
export async function startMockV1Api(
  db: MockV1Database = DEFAULT_MOCK_DB,
  options: MockV1ApiOptions = {},
): Promise<RunningMockV1Api> {
  validateDatabase(db);

  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? 0;
  const state: MockState = {
    issued: new Set<string>(),
    counter: 0,
    nextNonce: 0,
    txs: new Map<string, { height: number; envelope: unknown }>(),
  };
  const server = createServer((req, res) => {
    handle(req, res, db, state);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("mock v1 API did not bind to a TCP port");
  }
  const bound = address as AddressInfo;

  return {
    baseUrl: `http://${host}:${bound.port}`,
    network: db.network,
    close: () => closeServer(server),
  };
}
