/**
 * Shared types for the consolidated v1 API client.
 *
 * These mirror the wire contract documented in `indexer/docs/api.md`
 * (v1 success/error envelopes, `meta_data`, capabilities, `tx`, credentials,
 * pagination and includes). They are deliberately structural: the client never
 * imports kwil-db types, so the envelope is described here in plain JSON terms.
 *
 * Nothing in this module may import `@trufnetwork/kwil-js`, `ethers`, `pg` or a
 * `node:` builtin. The `check:v1` build guard enforces that for the whole
 * `src/v1` entry graph.
 */

/**
 * The stable error codes the v1 contract defines. `error.code` is the value a
 * client branches on; `error.message` is for humans and may change.
 */
export type V1ErrorCode =
  | "invalid_argument"
  | "unauthenticated"
  | "permission_denied"
  | "resource_exhausted"
  | "not_found"
  | "namespace_unavailable"
  | "failed_precondition"
  | "unavailable"
  | "internal";

/**
 * The payload the v1 error table names. An error carries one shape, not a mix:
 * `field` for `invalid_argument`/`failed_precondition`, `network`+`namespace`
 * for `namespace_unavailable`, and `lever` for `permission_denied`/
 * `resource_exhausted`.
 */
export interface V1ErrorDetails {
  field?: string;
  network?: string;
  namespace?: string;
  lever?: string;
}

/** The `error` object of a v1 error response. */
export interface V1ErrorBody {
  /** A {@link V1ErrorCode}. Typed as `string` so an unrecognised future code still parses. */
  code: string;
  message: string;
  details?: V1ErrorDetails;
}

/** The body of a v1 error response (`ok: false`). */
export interface V1ErrorResponse {
  ok: false;
  error: V1ErrorBody;
}

/** A freshness part: where a value came from and how fresh it is. */
export interface V1Part {
  source: string;
  at: number;
  unit: string;
}

/**
 * An include part. When satisfied it carries `source`/`at`/`unit`; when not it
 * carries `status: "unavailable"` and a `reason` of `uncollected` or
 * `namespace_unavailable`.
 */
export interface V1StreamPart {
  source?: string;
  at?: number;
  unit?: string;
  status?: string;
  reason?: string;
}

/** `meta_data.parts`. `self` is the core resource; the rest are requested includes. */
export interface V1ListParts {
  self: V1Part;
  metadata?: V1StreamPart;
  prices?: V1StreamPart;
  depth?: V1StreamPart;
  chain?: V1StreamPart;
  /** Any other include token a future route accepts, keyed by that token. */
  [token: string]: V1Part | V1StreamPart | undefined;
}

/**
 * `meta_data`. `cursor` is always present (`null` on an entity, a window, or the
 * last page). `includes` is keyed only by a requested include token.
 */
export interface V1MetaData {
  cursor: string | null;
  data_version: string;
  parts?: V1ListParts;
  includes?: Record<string, string>;
}

/** A v1 success response. */
export interface V1Success<T> {
  ok: true;
  data: T;
  meta_data: V1MetaData;
}

/** Either a success or an error envelope, as parsed from the wire. */
export type V1Response<T> = V1Success<T> | V1ErrorResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /{network}/v1/capabilities`. `namespaces` is the network's offered set.
 * The `permitted_*` lists are present only when a credential was presented
 * (and are present even when empty). A client degrades from this document
 * rather than hard-coding availability.
 */
export interface CapabilitiesData {
  network: string;
  namespaces: string[];
  permitted_namespaces?: string[];
  permitted_networks?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Transactions (`tx`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One typed action argument in a `prepare` intent. `type` is a kwil type name
 * (`text`, `int8`, `bool`, `bytea`, `uuid`, `numeric(p,s)`), optionally
 * suffixed `[]`. `value` is the JSON value coerced to that type.
 */
export interface TxArg {
  type: string;
  value: unknown;
  /** Set true for an array argument; equivalent to a `[]` suffix on `type`. */
  is_array?: boolean;
}

/** The intent `prepare` takes: an action call and its typed arguments. */
export interface TxIntent {
  /** Action namespace (usually `"main"`). */
  namespace: string;
  /** Action name. */
  action: string;
  /** Public account identifier used only for the nonce lookup (not the envelope sender). */
  sender: string;
  args?: TxArg[];
}

/** The signature object of a signed envelope. Note the raw-bytes key is `sig`, not `data`. */
export interface TxSignature {
  /** base64 of the 65 raw signature bytes (`r || s || v`). */
  sig: string;
  /** Signature type, `"secp256k1_ep"` for an Ethereum personal-sign signature. */
  type: string;
}

/** The opaque signed message body. Field names match kwil-db's JSON tags. */
export interface TxBody {
  desc?: string;
  /** base64 of the `EXECUTE_ACTION` (or `transfer`/`maa_exec`) payload bytes. */
  payload: string;
  /** `execute`, `transfer`, or `maa_exec`. */
  type: string;
  /** Decimal string; the node parses it as a big integer. */
  fee: string | number;
  /** JSON number. */
  nonce: number;
  chain_id: string;
}

/**
 * A transaction envelope. `prepare` returns an unsigned one; the client adds
 * `signature` and `sender` and echoes it to `broadcast`. Treated as an opaque
 * object otherwise, so an unrecognised field survives the round trip.
 */
export interface TxEnvelope {
  signature?: TxSignature | null;
  sender?: string;
  body: TxBody;
  serialization: string;
  [key: string]: unknown;
}

/** `data` of `POST /{network}/v1/tx/prepare`. */
export interface TxPreparedData {
  /** The unsigned envelope. */
  transaction: TxEnvelope;
  /** The exact UTF-8 message the client signs (personal_sign). */
  signature_message: string;
  /** Decimal string. Sealed into the body and the signature message. */
  fee: string;
  nonce: number;
  chain_id: string;
}

/** `data` of `POST /{network}/v1/tx/broadcast`. */
export interface TxBroadcastData {
  /** Bare lowercase hex, no `0x`. */
  tx_hash: string;
}

/** `data` of `GET /{network}/v1/tx/{hash}`. */
export interface TxReceiptData {
  tx_hash?: string;
  /** `-1` while in the mempool; the block height once mined. */
  height: number;
  tx: TxEnvelope | null;
  tx_result: unknown | null;
}

/** `data` of `GET /{network}/v1/tx/params`. */
export interface TxParamsData {
  /** Canonical bare lowercase hex. */
  sender: string;
  nonce: number;
  chain_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────────

/** `data` of `POST /{network}/v1/credentials` (public mint). */
export interface MintedCredential {
  /** The compact JWT. */
  credential: string;
  /** Unix seconds. */
  expires_at: number;
}

/** `data` of `POST /{network}/v1/credentials/redemptions`. */
export interface RedeemData {
  credential: string;
  /** Unix seconds. */
  expires_at: number;
}

/** One JSON Web Key from `GET /{network}/v1/credentials/jwks`. */
export interface Jwk {
  kty: string;
  crv: string;
  kid: string;
  /** Raw Ed25519 public key, base64url, no padding. */
  x: string;
}

/** `data` of `GET /{network}/v1/credentials/jwks`. */
export interface JwksData {
  keys: Jwk[];
}

/** One priced asset in a credential quote. */
export interface CredentialQuoteAmount {
  symbol: string;
  /** Decimal string of base units. */
  amount: string;
  /** The chain action that pays this asset. */
  action: string;
}

/** `data` of `GET /{network}/v1/credentials/quote`. */
export interface CredentialQuoteData {
  preset: string;
  days: number;
  /** Exact decimal string. */
  usd_per_day: string;
  amounts: CredentialQuoteAmount[];
  /** Unix seconds. */
  expires_at: number;
  /** The signed quote. */
  quote: string;
  /** The current treasury address. */
  treasury: string;
  priced_presets: string[];
  /** Present when the network has a rate asset. */
  rate?: string;
  observed_at?: number;
}

/** The body of `POST /{network}/v1/credentials/redemptions`. */
export interface RedeemInput {
  /** 32 bytes of hex, optional `0x`. */
  tx_hash: string;
  preset: string;
  /** 65 bytes of hex, optional `0x`. */
  signature: string;
  quote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Includes (the issue's "join sets")
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An include token the v1 lists accept. The contract currently defines
 * `metadata`, `prices`, `depth`, and `chain`; the `string` arm keeps the type
 * forward-compatible with any token a future route accepts.
 */
export type IncludeToken =
  | "metadata"
  | "prices"
  | "depth"
  | "chain"
  | (string & {});

/**
 * The resolved outcome of a requested include token:
 * - `satisfied`: the part was joined.
 * - `unavailable`: the include named a namespace this network does not offer.
 * - `uncollected`: the part is not collected yet.
 */
export type IncludeOutcome = "satisfied" | "unavailable" | "uncollected";

/** The state of one requested include token. */
export interface IncludeState {
  token: IncludeToken;
  outcome: IncludeOutcome;
  /** The raw `parts.<token>` object when present. */
  part?: V1StreamPart;
  /** The `reason` carried by an unavailable part, when present. */
  reason?: string;
}
