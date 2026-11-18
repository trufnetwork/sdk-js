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
 * The wallet that signs a prepared transaction. `signMessage` is given the exact
 * UTF-8 bytes of the `prepare` `signature_message` and returns a 65-byte
 * `r || s || v` signature as hex (an optional `0x`) or raw bytes. What it signs
 * depends on `signatureType`, because the node checks each type differently:
 *
 * - `"secp256k1_ep"` (the default): Ethereum personal-sign (EIP-191) over the
 *   message, which is what `wallet.signMessage(message)` does in ethers.
 *   `address` is the 20-byte Ethereum address.
 * - `"secp256k1"`: a plain secp256k1 signature over the sha256 of the message,
 *   with no EIP-191 prefix. `address` is the 33-byte compressed public key. The
 *   node does not read `v`.
 */
export interface TnSigner {
  /**
   * The envelope `sender`, hex with an optional `0x`: the 20-byte Ethereum
   * address for `"secp256k1_ep"`, or the 33-byte compressed public key for
   * `"secp256k1"`.
   */
  address: string;
  signMessage(message: Uint8Array): Promise<string | Uint8Array>;
  /**
   * The signature type written to the envelope. Defaults to `"secp256k1_ep"`.
   * A 33-byte compressed key needs `"secp256k1"`, and `signMessage` must then
   * sign the sha256 of the message without the EIP-191 prefix.
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

/** A message for any thrown value, even one `String` cannot convert. */
function describeError(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return String(value);
  } catch {
    return "an error that has no message";
  }
}

/**
 * Thrown by {@link TxApi.submit} when the broadcast succeeded but waiting for
 * the receipt failed. The transaction may still execute, so it carries what
 * `submit` did: poll `hash` again, or resend `signed` (the same envelope has the
 * same hash, so a resend is safe). Preparing again would place a second
 * transaction. `cause` is the error the wait ended with.
 */
export class TxSubmitWaitError extends Error {
  declare readonly cause: unknown;
  readonly hash: string;
  readonly prepared: TxPreparedData;
  readonly signed: TxEnvelope;
  readonly broadcast: TxBroadcastData;

  constructor(result: Omit<SubmitResult, "receipt">, cause: unknown) {
    const reason = describeError(cause);
    super(
      `transaction ${result.broadcast.tx_hash} was broadcast, but waiting for its receipt failed: ${reason}`,
      { cause },
    );
    this.name = "TxSubmitWaitError";
    this.hash = result.broadcast.tx_hash;
    this.prepared = result.prepared;
    this.signed = result.signed;
    this.broadcast = result.broadcast;
  }
}

/**
 * Thrown by {@link TxApi.waitForReceipt} when the receipt does not appear in
 * time. When the last read failed (a `503`, a `429`, or no response), that
 * error is `cause` and the message says so; otherwise every read found the
 * transaction pending or not yet admitted.
 */
export class TxWaitTimeoutError extends Error {
  declare readonly cause: unknown;
  readonly hash: string;
  readonly timeoutMs: number;

  constructor(hash: string, timeoutMs: number, lastError?: V1ApiError) {
    const failed = lastError !== undefined && lastError.code !== "not_found";
    super(
      failed
        ? `transaction ${hash} has no receipt after ${timeoutMs}ms; the last read failed: ${lastError.message}`
        : `transaction ${hash} was not mined within ${timeoutMs}ms`,
      failed ? { cause: lastError } : undefined,
    );
    this.name = "TxWaitTimeoutError";
    this.hash = hash;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Receipt poll errors that say "not yet" rather than "no": the node has not
 * admitted the transaction (`not_found`), the gateway is unavailable (503), or
 * the read is rate limited (429).
 */
const RETRYABLE_RECEIPT_CODES: ReadonlySet<string> = new Set([
  "not_found",
  "unavailable",
  "resource_exhausted",
]);

/** HTTP statuses that mean "try again later" even without a v1 body. */
const RETRYABLE_RECEIPT_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503, 504,
]);

function isRetryableReceiptError(error: unknown): error is V1ApiError {
  if (!(error instanceof V1ApiError)) return false;
  // A transport error is a response that is not a v1 body, or no response at
  // all. Retry it when there was no response (status 0: a network failure or a
  // timeout) or when its status says to try again (a proxy's 502, or a 503 or
  // 429 whose body was lost). A wrong base URL's 404 or a 401 will not change.
  if (error.code === V1ApiError.TRANSPORT_CODE) {
    return error.status === 0 || RETRYABLE_RECEIPT_STATUSES.has(error.status);
  }
  return RETRYABLE_RECEIPT_CODES.has(error.code);
}

/** The longest delay `setTimeout` honours; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** The validated timing of a receipt wait, checked before anything is sent. */
function waitTiming(options: WaitForReceiptOptions): {
  timeoutMs: number;
  intervalMs: number;
} {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("intervalMs must be a positive number");
  }
  return { timeoutMs, intervalMs };
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

/**
 * The node's two secp256k1 types each accept one sender length, so a mismatch
 * would be rejected after the wallet has signed. Other types pass through.
 */
function validateSenderForType(type: string, address: string): void {
  const bytes = bareHex(address).length / 2;
  if (type === "secp256k1_ep" && bytes !== 20) {
    throw new Error(
      'signature type "secp256k1_ep" needs a 20-byte address; a 33-byte compressed key signs with signatureType "secp256k1"',
    );
  }
  if (type === "secp256k1" && bytes !== 33) {
    throw new Error(
      'signature type "secp256k1" needs a 33-byte compressed public key as the address',
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
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.min(ms, MAX_TIMER_MS),
    );
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
    // Read the identity once: a wallet that switches accounts while its prompt
    // is open must not change the sender after it was checked.
    const address = active.address;
    const type = active.signatureType ?? "secp256k1_ep";
    validateSender(address);
    validateSenderForType(type, address);
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
    const signature: TxSignature = { sig: bytesToBase64(sigBytes), type };
    envelope.signature = signature;
    envelope.sender = bareHex(address);
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
   * `404` while the node has not admitted the transaction yet, a `503`, a `429`,
   * a `502` or `504` from a proxy, and a request that got no response are
   * retried until the timeout; any other error, and an abort, end the wait at
   * once.
   * No read starts after `timeoutMs`, and a read still in flight then, or the
   * credential fetch it waits on, is cancelled.
   */
  async waitForReceipt(
    hash: string,
    options: WaitForReceiptOptions = {},
  ): Promise<TxReceiptData> {
    validateHash(hash);
    const { timeoutMs, intervalMs } = waitTiming(options);
    const deadline = Date.now() + timeoutMs;
    let lastError: V1ApiError | undefined;
    for (;;) {
      // No read starts after the deadline, and a read in flight at the
      // deadline is cancelled.
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new TxWaitTimeoutError(hash, timeoutMs, lastError);
      const read = new AbortController();
      // A wait longer than the timer allows re-arms on the next iteration.
      const timer = setTimeout(
        () => read.abort(),
        Math.min(remaining, MAX_TIMER_MS),
      );
      const onAbort = (): void => read.abort();
      if (options.signal?.aborted === true) read.abort();
      else options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const receipt = await this.get(hash, { signal: read.signal });
        if (receipt.height >= 0) return receipt;
        lastError = undefined;
      } catch (error) {
        // A caller abort is the caller's error, not a timeout.
        if (options.signal?.aborted === true) throw error;
        if (read.signal.aborted) {
          if (deadline - Date.now() > 0) continue;
          throw new TxWaitTimeoutError(
            hash,
            timeoutMs,
            V1ApiError.transport(
              0,
              "no answer before the deadline",
              undefined,
              error,
            ),
          );
        }
        if (!isRetryableReceiptError(error)) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
      const left = deadline - Date.now();
      if (left > 0) await sleep(Math.min(intervalMs, left), options.signal);
    }
  }

  /**
   * The convenience flow: prepare, optionally verify, sign, broadcast, and
   * optionally wait for the receipt. Verification is opt-in. When the wait
   * fails after a successful broadcast, this throws {@link TxSubmitWaitError},
   * which carries the hash and the signed envelope.
   */
  async submit(
    intent: TxIntent,
    options: SubmitOptions = {},
  ): Promise<SubmitResult> {
    // A bad wait option must fail before anything is broadcast. Copy it once,
    // so a caller that changes it later cannot change the wait.
    const wait =
      options.wait !== null && typeof options.wait === "object"
        ? { ...options.wait }
        : (options.wait ?? false);
    if (typeof wait === "object") waitTiming(wait);
    const prepared = await this.prepare(intent, { signal: options.signal });
    if (options.verify === true) {
      assertPrepared(prepared, intent);
    } else if (options.verify !== undefined && options.verify !== false) {
      assertPrepared(prepared, intent, options.verify);
    }
    const signed = await this.sign(prepared, options.signer);
    const broadcast = await this.broadcast(signed, { signal: options.signal });
    if (wait === false) return { prepared, signed, broadcast };
    const waitOptions: WaitForReceiptOptions =
      wait === true
        ? { signal: options.signal }
        : { ...wait, signal: options.signal ?? wait.signal };
    let receipt: TxReceiptData;
    try {
      receipt = await this.waitForReceipt(broadcast.tx_hash, waitOptions);
    } catch (error) {
      throw new TxSubmitWaitError({ prepared, signed, broadcast }, error);
    }
    return { prepared, signed, broadcast, receipt };
  }
}
