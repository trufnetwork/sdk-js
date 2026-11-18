/**
 * The consolidated v1 client: one object that composes the transport, the
 * transaction write path, capability discovery, the credential lifecycle, and
 * the typed namespace readers.
 *
 * This module is kwil-free. Importing `@trufnetwork/sdk-js/v1` therefore works in
 * a browser without `@trufnetwork/kwil-js`, which is what lets a front-end place
 * a trade with no local payload encoder.
 */

import {
  CapabilitiesApi,
  capabilitiesAllow,
  capabilitiesSupports,
} from "./capabilities";
import { CredentialManager, CredentialsApi } from "./credentials";
import type {
  CredentialManagerOptions,
  CredentialStrategy,
} from "./credentials";
import { NamespaceUnavailableError } from "./errors";
import {
  ChainReader,
  MarketsReader,
  NamespaceReader,
  StreamsReader,
} from "./namespaces";
import { Transport, type TransportOptions } from "./transport";
import { TxApi, type TnSigner } from "./tx";
import type { CapabilitiesData } from "./types";

/** Options for {@link V1Client}. */
export interface V1ClientOptions extends TransportOptions {
  /** A default signer for {@link TxApi.sign} and {@link TxApi.submit}. */
  signer?: TnSigner;
  /** A static bearer credential. Ignored when `getToken` or `credentialStrategy` is set. */
  token?: string | null;
  /** A ready-made credential manager (takes precedence over `credentialStrategy`). */
  credentialManager?: CredentialManager;
  /**
   * Acquire credentials automatically: mint the public preset, or redeem a
   * payment. When set, every gated request carries a fresh bearer credential and
   * a burst of requests shares one acquisition.
   */
  credentialStrategy?: CredentialStrategy;
  /** Tuning for the internally constructed credential manager. */
  credentialOptions?: CredentialManagerOptions;
}

/**
 * The v1 client. Construct with an explicit `baseUrl` and `network`; the SDK
 * never hard-codes a host.
 */
export class V1Client {
  readonly network: string;
  readonly transport: Transport;
  readonly tx: TxApi;
  readonly capabilitiesApi: CapabilitiesApi;
  readonly credentialsApi: CredentialsApi;
  /** Present when `credentialStrategy` or `credentialManager` was supplied. */
  readonly credentialManager?: CredentialManager;
  readonly streams: StreamsReader;
  readonly chain: ChainReader;
  readonly markets: MarketsReader;

  private readonly externalGetToken?: TransportOptions["getToken"];
  private readonly staticToken: string | null;
  private capabilitiesCache: CapabilitiesData | null = null;

  constructor(options: V1ClientOptions) {
    this.network = options.network;
    this.externalGetToken = options.getToken;
    this.staticToken = options.token ?? null;
    this.credentialManager = options.credentialManager;

    this.transport = new Transport({
      ...options,
      // Read the token source at call time so a manager created just below is used.
      getToken: () => this.provideToken(),
    });

    this.credentialsApi = new CredentialsApi(this.transport);
    if (
      this.credentialManager === undefined &&
      options.credentialStrategy !== undefined
    ) {
      this.credentialManager = new CredentialManager(
        this.credentialsApi,
        options.credentialStrategy,
        options.credentialOptions,
      );
    }

    this.tx = new TxApi(this.transport, options.signer);
    this.capabilitiesApi = new CapabilitiesApi(this.transport);
    this.streams = new StreamsReader(this.transport);
    this.chain = new ChainReader(this.transport);
    this.markets = new MarketsReader(this.transport);
  }

  private async provideToken(): Promise<string | null> {
    if (this.externalGetToken !== undefined) {
      return await this.externalGetToken();
    }
    if (this.credentialManager !== undefined) {
      return await this.credentialManager.getToken();
    }
    return this.staticToken;
  }

  /** Set or replace the default signer used by the transaction helpers. */
  setSigner(signer: TnSigner | undefined): void {
    this.tx.setSigner(signer);
  }

  /**
   * Fetch the capabilities document and cache it for namespace gating. Repeated
   * calls reuse the cache unless `force` is set.
   */
  async loadCapabilities(force = false): Promise<CapabilitiesData> {
    if (this.capabilitiesCache !== null && !force)
      return this.capabilitiesCache;
    this.capabilitiesCache = await this.capabilitiesApi.get();
    return this.capabilitiesCache;
  }

  /** The cached capabilities document, if {@link loadCapabilities} has run. */
  get capabilities(): CapabilitiesData | null {
    return this.capabilitiesCache;
  }

  /**
   * True when the namespace is usable. Without a cached capabilities document
   * this returns `true` (unknown); the server is then the authority and answers
   * `409 namespace_unavailable` if it is not offered.
   */
  supportsNamespace(namespace: string): boolean {
    if (this.capabilitiesCache === null) return true;
    return capabilitiesAllow(this.capabilitiesCache, namespace);
  }

  /** True when the network offers the namespace, regardless of permission. */
  offersNamespace(namespace: string): boolean {
    if (this.capabilitiesCache === null) return true;
    return capabilitiesSupports(this.capabilitiesCache, namespace);
  }

  /**
   * A generic reader for any namespace. When capabilities have been loaded, a
   * namespace the document does not offer (or permit) throws
   * {@link NamespaceUnavailableError} before a request is made; otherwise the
   * reader is returned and the server's own `409`/`403` is surfaced.
   */
  namespace(name: string): NamespaceReader {
    if (
      this.capabilitiesCache !== null &&
      !capabilitiesAllow(this.capabilitiesCache, name)
    ) {
      throw new NamespaceUnavailableError(this.network, name);
    }
    return new NamespaceReader(this.transport, name);
  }
}
