/**
 * The transaction write path: `prepare` → optional verification → sign →
 * `broadcast` → receipt.
 *
 * The `prepare` response is treated as an envelope to echo, not a payload to
 * rebuild. The client adds only `signature` and `sender`; it never re-encodes
 * the action, so it never has to match the node's binary framing. That is what
 * lets a browser place a trade without a kwil encoder, and it is why
 * `broadcast` is a pure passthrough that accepts an envelope built elsewhere.
 */

import { bytesToBase64 } from "./decode";
import { V1ApiError } from "./errors";
import type { Transport } from "./transport";
import { assertPrepared, verifyPrepared } from "./verify";
import type { VerifyPreparedOptions, VerificationResult } from "./verify";
import type {
  TxBroadcastData,
  TxEnvelope,
  TxIntent,
  TxParamsData,
  TxPreparedData,
  TxReceiptData,
  TxSignature,
} from "./types";

/**
 * A `personal_sign`-capable wallet. `signMessage` is given the exact UTF-8 bytes
 * of the `prepare` `signature_message` and must apply Ethereum personal-sign
 * (EIP-191) itself, returning a 65-byte `r || s || v` signature as hex (an
 * optional `0x`) or raw bytes.
 */
export interface TnSigner {
  /**
   * The signing account identifier used for the envelope `sender`: a 20-byte
   * Ethereum address (for the default personal-sign type) or a 33-byte
   * compressed secp256k1 key (when `signatureType` is `"secp256k1"`), optional
   * `0x`.
   */
  address: string;
  signMessage(message: Uint8Array): Promise<string | Uint8Array>;
  /**
   * The signature type written to the envelope. Defaults to `"secp256k1_ep"`
   * (Ethereum personal-sign), which requires a 20-byte `address`. A caller
   * signing with a 33-byte compressed key must pass `"secp256k1"` explicitly.
   */
  signatureType?: string;
}

/** Options for {@link TxApi.waitForReceipt}. */
export interface WaitForReceiptOptions {
  /** Total time to wait. Defaults to 60000. */
  timeoutMs?: number;
  /** Delay between polls. Defaults to 2000. */
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Options for {@link TxApi.submit}. */
export interface SubmitOptions {
  /**
   * Verify the prepared envelope before signing. Opt-in: `false`/omitted signs
   * and broadcasts directly. `true` runs the default `full` check; an object
   * narrows it (for example `{ mode: "payload" }`).
   */
  verify?: boolean | VerifyPreparedOptions;
  /** Override the client's signer. */
  signer?: TnSigner;
  /** Wait for the receipt after broadcasting (`true` uses the defaults). */
  wait?: boolean | WaitForReceiptOptions;
  signal?: AbortSignal;
}

/** The result of {@link TxApi.submit}. */
export interface SubmitResult {
  prepared: TxPreparedData;
  signed: TxEnvelope;
  broadcast: TxBroadcastData;
  receipt?: TxReceiptData;
}

/** Thrown by {@link TxApi.waitForReceipt} when the receipt does not appear in time. */
export class TxWaitTimeoutError extends Error {
  readonly hash: string;
  readonly timeoutMs: number;

  constructor(hash: string, timeoutMs: number) {
    super(`transaction ${hash} was not mined within ${timeoutMs}ms`);
    this.name = "TxWaitTimeoutError";
    this.hash = hash;
    this.timeoutMs = timeoutMs;
  }
}

const SENDER_RE = /^(0x)?([0-9a-fA-F]{40}|[0-9a-fA-F]{66})$/;
const HASH_RE = /^(0x)?[0-9a-fA-F]{64}$/;

function bareHex(value: string): string {
  return (
    value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value
  ).toLowerCase();
}

function validateIdentifier(field: string, value: string): void {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const bytes = new TextEncoder().encode(value).length;
  if (bytes < 1 || bytes > 64) throw new Error(`${field} must be 1-64 bytes`);
  // No control characters or spaces, per the prepare contract.
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      throw new Error(`${field} must not contain control characters or spaces`);
    }
  }
}

function validateSender(sender: string): void {
  if (typeof sender !== "string" || !SENDER_RE.test(sender)) {
    throw new Error(
      "sender must be a 20-byte address or a 33-byte compressed public key, hex with an optional 0x",
    );
  }
}

function validateIntent(intent: TxIntent): void {
  validateIdentifier("namespace", intent.namespace);
  validateIdentifier("action", intent.action);
  validateSender(intent.sender);
  const args = intent.args ?? [];
  if (!Array.isArray(args)) throw new Error("args must be an array");
  if (args.length > 64) throw new Error("args must contain at most 64 entries");
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === null || typeof arg !== "object") {
      throw new Error(`args[${i}] must be an object`);
    }
    if (typeof arg.type !== "string" || arg.type.trim() === "") {
      throw new Error(`args[${i}].type must be a non-empty string`);
    }
    if (arg.is_array !== undefined && typeof arg.is_array !== "boolean") {
      throw new Error(`args[${i}].is_array must be a boolean`);
    }
  }
}

function validateHash(hash: string): void {
  if (typeof hash !== "string" || !HASH_RE.test(hash)) {
    throw new Error(
      "transaction hash must be 32 bytes of hex, with an optional 0x",
    );
  }
}

function validateEnvelope(envelope: TxEnvelope): void {
  if (envelope === null || typeof envelope !== "object") {
    throw new Error("transaction envelope must be an object");
  }
  if (envelope.body === null || typeof envelope.body !== "object") {
    throw new Error("transaction envelope has no body");
  }
  if (envelope.signature === undefined || envelope.signature === null) {
    throw new Error("transaction envelope is not signed");
  }
  if (
    typeof envelope.signature.sig !== "string" ||
    envelope.signature.sig === ""
  ) {
    throw new Error("transaction envelope signature is missing sig");
  }
}

function hexToBytes(hex: string): Uint8Array {
  const body =
    hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || (body !== "" && !/^[0-9a-fA-F]*$/.test(body))) {
    throw new Error(`signature is not a hex string: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Deep-clone an envelope so signing never mutates the `prepare` response. */
function cloneEnvelope(envelope: TxEnvelope): TxEnvelope {
  return JSON.parse(JSON.stringify(envelope)) as TxEnvelope;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Typed access to `/{network}/v1/tx`. */
export class TxApi {
  constructor(
    private readonly transport: Transport,
    private signer?: TnSigner,
  ) {}

  /** Set or replace the default signer. */
  setSigner(signer: TnSigner | undefined): void {
    this.signer = signer;
  }

  /** `GET /tx/params`: the nonce and chain id for a caller building its own payload. */
  async params(
    sender: string,
    options?: { signal?: AbortSignal },
  ): Promise<TxParamsData> {
    validateSender(sender);
    const envelope = await this.transport.get<TxParamsData>("tx/params", {
      query: { sender },
      signal: options?.signal,
    });
    return envelope.data;
  }

  /** `POST /tx/prepare`: build the unsigned envelope for one action intent. */
  async prepare(
    intent: TxIntent,
    options?: { signal?: AbortSignal },
  ): Promise<TxPreparedData> {
    validateIntent(intent);
    const envelope = await this.transport.post<TxPreparedData>("tx/prepare", {
      body: intent,
      signal: options?.signal,
    });
    return envelope.data;
  }

  /**
   * Verify a prepared envelope against the intent without throwing. Delegates to
   * {@link verifyPrepared}; this is the opt-in hardening step.
   */
  verify(
    prepared: TxPreparedData,
    intent: TxIntent,
    options?: VerifyPreparedOptions,
  ): VerificationResult {
    return verifyPrepared(prepared, intent, options);
  }

  /**
   * Sign the prepared envelope's `signature_message` and return the envelope to
   * echo to `broadcast`. Only `signature` and `sender` are added.
   */
  async sign(prepared: TxPreparedData, signer?: TnSigner): Promise<TxEnvelope> {
    const active = signer ?? this.signer;
    if (active === undefined) {
      throw new Error("a TnSigner is required to sign a transaction");
    }
    validateSender(active.address);
    const envelope = cloneEnvelope(prepared.transaction);
    if (envelope.body === undefined || envelope.body === null) {
      throw new Error("prepared transaction has no body");
    }
    const message = new TextEncoder().encode(prepared.signature_message);
    const raw = await active.signMessage(message);
    const sigBytes = typeof raw === "string" ? hexToBytes(raw) : raw;
    if (!(sigBytes instanceof Uint8Array) || sigBytes.length !== 65) {
      throw new Error(`signature must be 65 bytes, got ${sigBytes.length}`);
    }
    const signature: TxSignature = {
      sig: bytesToBase64(sigBytes),
      type: active.signatureType ?? "secp256k1_ep",
    };
    envelope.signature = signature;
    envelope.sender = bareHex(active.address);
    return envelope;
  }

  /**
   * `POST /tx/broadcast`: relay a signed envelope and return its hash. This is a
   * pure passthrough and does not require a prior `prepare`, so an envelope built
   * by any SDK can be relayed here.
   */
  async broadcast(
    envelope: TxEnvelope,
    options?: { signal?: AbortSignal },
  ): Promise<TxBroadcastData> {
    validateEnvelope(envelope);
    const result = await this.transport.post<TxBroadcastData>("tx/broadcast", {
      body: envelope,
      signal: options?.signal,
    });
    return result.data;
  }

  /** `GET /tx/{hash}`: the node's receipt. `height` is `-1` while in the mempool. */
  async get(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<TxReceiptData> {
    validateHash(hash);
    const envelope = await this.transport.get<TxReceiptData>(
      `tx/${bareHex(hash)}`,
      {
        signal: options?.signal,
      },
    );
    return envelope.data;
  }

  /** `GET /tx/{hash}/events`: the events of a mined transaction. */
  async events(
    hash: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown[]> {
    validateHash(hash);
    const envelope = await this.transport.get<unknown[]>(
      `tx/${bareHex(hash)}/events`,
      {
        signal: options?.signal,
      },
    );
    return envelope.data;
  }

  /**
   * Poll the receipt until the transaction is in a block (`height >= 0`). A
   * `404` while the node has not admitted the transaction yet is retried; any
   * other error is surfaced.
   */
  async waitForReceipt(
    hash: string,
    options: WaitForReceiptOptions = {},
  ): Promise<TxReceiptData> {
    validateHash(hash);
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 2_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive number");
    }
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error("intervalMs must be a positive number");
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const receipt = await this.get(hash, { signal: options.signal });
        if (receipt.height >= 0) return receipt;
      } catch (error) {
        if (!(error instanceof V1ApiError) || error.code !== "not_found")
          throw error;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TxWaitTimeoutError(hash, timeoutMs);
      await sleep(Math.min(intervalMs, remaining), options.signal);
    }
  }

  /**
   * The convenience flow: prepare, optionally verify, sign, broadcast, and
   * optionally wait for the receipt. Verification is opt-in.
   */
  async submit(
    intent: TxIntent,
    options: SubmitOptions = {},
  ): Promise<SubmitResult> {
    const prepared = await this.prepare(intent, { signal: options.signal });
    if (options.verify === true) {
      assertPrepared(prepared, intent);
    } else if (options.verify !== undefined && options.verify !== false) {
      assertPrepared(prepared, intent, options.verify);
    }
    const signed = await this.sign(prepared, options.signer);
    const broadcast = await this.broadcast(signed, { signal: options.signal });
    let receipt: TxReceiptData | undefined;
    if (options.wait === true) {
      receipt = await this.waitForReceipt(broadcast.tx_hash, {
        signal: options.signal,
      });
    } else if (options.wait !== undefined && options.wait !== false) {
      receipt = await this.waitForReceipt(broadcast.tx_hash, {
        ...options.wait,
        signal: options.signal ?? options.wait.signal,
      });
    }
    return { prepared, signed, broadcast, receipt };
  }
}
