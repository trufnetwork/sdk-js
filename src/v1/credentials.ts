/**
 * The credential lifecycle: mint, quote, redeem, JWKS, and a single-flight
 * “get a usable credential” helper.
 *
 * There is no refresh endpoint in the contract. A credential is re-minted
 * (public preset) or re-redeemed (paid preset); the manager therefore refreshes
 * lazily from `expires_at`, in a single flight, so a burst of requests cannot
 * trigger a thundering herd of mints and an expired token is not discovered only
 * after a `401`.
 */

import type { Transport } from "./transport";
import type {
  CredentialQuoteData,
  JwksData,
  MintedCredential,
  RedeemData,
  RedeemInput,
} from "./types";

/** A 32-byte hex string with an optional `0x`. */
const TX_HASH_RE = /^(0x)?[0-9a-fA-F]{64}$/;
/** A 65-byte hex string with an optional `0x`. */
const SIGNATURE_RE = /^(0x)?[0-9a-fA-F]{130}$/;

/** Validation for {@link CredentialsApi.redeem}. */
function assertRedeemInput(input: RedeemInput): void {
  if (!TX_HASH_RE.test(input.tx_hash)) {
    throw new Error("tx_hash must be 32 bytes of hex (with an optional 0x)");
  }
  if (!SIGNATURE_RE.test(input.signature)) {
    throw new Error("signature must be 65 bytes of hex (with an optional 0x)");
  }
  if (typeof input.preset !== "string" || input.preset.trim() === "") {
    throw new Error("preset must be a non-empty string");
  }
  if (input.quote !== undefined && typeof input.quote !== "string") {
    throw new Error("quote must be a string when present");
  }
}

/**
 * Typed access to the four credential routes.
 *
 * Every one of them is ungated in the v1 contract (`accessUngated`), so none
 * sends a bearer credential. That is not only cosmetic: `mint` is how a
 * {@link CredentialManager} obtains a token, and the manager is the transport's
 * `getToken` source. Letting the mint request ask for a token would call the
 * manager, which calls `mint`, and recurse until the stack overflows.
 */
export class CredentialsApi {
  constructor(private readonly transport: Transport) {}

  /**
   * Mint the public preset. A body-less mint is valid; `preset` is optional and,
   * when present, must be the public preset name.
   */
  async mint(
    preset?: string,
    options?: { signal?: AbortSignal },
  ): Promise<MintedCredential> {
    if (
      preset !== undefined &&
      (typeof preset !== "string" || preset.trim() === "")
    ) {
      throw new Error("preset must be a non-empty string when present");
    }
    const body = preset === undefined ? {} : { preset };
    const envelope = await this.transport.post<MintedCredential>(
      "credentials",
      {
        body,
        signal: options?.signal,
        includeAuth: false,
      },
    );
    return envelope.data;
  }

  /** The public verification set. */
  async jwks(options?: { signal?: AbortSignal }): Promise<JwksData> {
    const envelope = await this.transport.get<JwksData>("credentials/jwks", {
      signal: options?.signal,
      includeAuth: false,
    });
    return envelope.data;
  }

  /** Price `days` of `preset` and return the signed quote. */
  async quote(
    preset: string,
    days: number,
    options?: { signal?: AbortSignal },
  ): Promise<CredentialQuoteData> {
    if (typeof preset !== "string" || preset.trim() === "") {
      throw new Error("preset must be a non-empty string");
    }
    if (!Number.isInteger(days) || days <= 0) {
      throw new Error("days must be a positive integer");
    }
    const envelope = await this.transport.get<CredentialQuoteData>(
      "credentials/quote",
      {
        query: { preset, days },
        signal: options?.signal,
        includeAuth: false,
      },
    );
    return envelope.data;
  }

  /** Redeem one payment for a credential. Idempotent on the payment hash. */
  async redeem(
    input: RedeemInput,
    options?: { signal?: AbortSignal },
  ): Promise<RedeemData> {
    assertRedeemInput(input);
    const envelope = await this.transport.post<RedeemData>(
      "credentials/redemptions",
      {
        body: input,
        signal: options?.signal,
        includeAuth: false,
      },
    );
    return envelope.data;
  }
}

/**
 * How the manager obtains a credential:
 * - `public`: mint the public preset (`preset` optional).
 * - `redeem`: redeem a payment produced on demand. `payment` must return the
 *   fresh (or idempotent) payment for this mint.
 */
export type CredentialStrategy =
  | { kind: "public"; preset?: string }
  | { kind: "redeem"; payment: () => Promise<RedeemInput> };

/** Options for {@link CredentialManager}. */
export interface CredentialManagerOptions {
  /** Refresh this many seconds before `expires_at`. Defaults to 30. */
  skewSeconds?: number;
  /** Clock in milliseconds, for tests. Defaults to `Date.now`. */
  now?: () => number;
}

interface CurrentCredential {
  credential: string;
  expiresAt: number;
}

/**
 * A single-flight credential provider. `getToken` returns a valid credential,
 * re-minting or re-redeeming only when the current one is within `skewSeconds`
 * of expiry. Concurrent callers share one in-flight acquisition.
 */
export class CredentialManager {
  private current: CurrentCredential | null = null;
  private inflight: Promise<string> | null = null;
  private readonly skewSeconds: number;
  private readonly now: () => number;

  constructor(
    private readonly source: CredentialsApi,
    private readonly strategy: CredentialStrategy,
    options: CredentialManagerOptions = {},
  ) {
    this.skewSeconds = options.skewSeconds ?? 30;
    if (!Number.isFinite(this.skewSeconds) || this.skewSeconds < 0) {
      throw new Error("skewSeconds must be a non-negative number");
    }
    this.now = options.now ?? Date.now;
  }

  /** The current credential without acquiring one. */
  peek(): { credential: string; expiresAt: number } | null {
    return this.current === null
      ? null
      : {
          credential: this.current.credential,
          expiresAt: this.current.expiresAt,
        };
  }

  /** Drop the current credential; the next `getToken` acquires a new one. */
  clear(): void {
    this.current = null;
  }

  /** Return a valid credential, acquiring one if needed. */
  async getToken(): Promise<string> {
    const nowSeconds = Math.floor(this.now() / 1000);
    if (
      this.current !== null &&
      this.current.expiresAt > nowSeconds + this.skewSeconds
    ) {
      return this.current.credential;
    }
    return this.refresh();
  }

  /** Force a new acquisition, sharing one in-flight request among concurrent callers. */
  refresh(): Promise<string> {
    if (this.inflight !== null) return this.inflight;
    const pending = this.acquire();
    this.inflight = pending;
    void pending
      .finally(() => {
        if (this.inflight === pending) this.inflight = null;
      })
      .catch(() => {
        // The rejection is delivered to the caller(s) awaiting `pending`; this
        // handler only prevents an unhandled-rejection warning from the cleanup.
      });
    return pending;
  }

  private async acquire(): Promise<string> {
    let credential: string;
    let expiresAt: number;
    if (this.strategy.kind === "public") {
      const minted = await this.source.mint(this.strategy.preset);
      credential = minted.credential;
      expiresAt = minted.expires_at;
    } else {
      const payment = await this.strategy.payment();
      const redeemed = await this.source.redeem(payment);
      credential = redeemed.credential;
      expiresAt = redeemed.expires_at;
    }
    if (typeof credential !== "string" || credential === "") {
      throw new Error("credential response is missing a credential");
    }
    if (!Number.isFinite(expiresAt)) {
      throw new Error("credential response is missing a valid expires_at");
    }
    this.current = { credential, expiresAt };
    return credential;
  }
}
