/**
 * `@trufnetwork/sdk-js/v1` — the kwil-free client for the consolidated v1 API.
 *
 * Importing this entry never loads `@trufnetwork/kwil-js`, `ethers`, `pg`, or a
 * Node builtin. The `check:v1` build guard fails closed if any of them reach this
 * module graph, so a browser front-end can rely on it.
 *
 * Minimal integrator: `prepare` → `sign` → `broadcast`. Verification is opt-in
 * hardening (`verifyPrepared` / `submit(..., { verify: true })`).
 */

// ── Envelopes and shared types ───────────────────────────────────────────────
export type {
  CapabilitiesData,
  CredentialQuoteAmount,
  CredentialQuoteData,
  IncludeOutcome,
  IncludeState,
  IncludeToken,
  Jwk,
  JwksData,
  MintedCredential,
  RedeemData,
  RedeemInput,
  TxArg,
  TxBody,
  TxBroadcastData,
  TxEnvelope,
  TxIntent,
  TxParamsData,
  TxPreparedData,
  TxReceiptData,
  TxSignature,
  V1ErrorBody,
  V1ErrorCode,
  V1ErrorDetails,
  V1ErrorResponse,
  V1ListParts,
  V1MetaData,
  V1Part,
  V1Response,
  V1StreamPart,
  V1Success,
} from "./types";

// ── Errors ───────────────────────────────────────────────────────────────────
export { NamespaceUnavailableError, parseV1Error, V1ApiError } from "./errors";

// ── Payload decoding (kwil-free) ─────────────────────────────────────────────
export {
  base64ToBytes,
  bytesToBase64,
  decodeActionExecution,
  type DecodedAction,
  type DecodedArgType,
} from "./decode";

// ── Verification (AC2) ───────────────────────────────────────────────────────
export {
  assertPrepared,
  canonicalDecimal,
  PayloadVerificationError,
  verifyPrepared,
  type VerificationIssue,
  type VerificationIssueCode,
  type VerificationMode,
  type VerificationResult,
  type VerifyPreparedOptions,
} from "./verify";

// ── Transport ────────────────────────────────────────────────────────────────
export {
  Transport,
  type QueryValue,
  type RequestOptions,
  type TransportOptions,
} from "./transport";

// ── Capabilities ─────────────────────────────────────────────────────────────
export {
  CapabilitiesApi,
  capabilitiesAllow,
  capabilitiesPermits,
  capabilitiesSupports,
  type CapabilitiesOptions,
} from "./capabilities";

// ── Pagination ───────────────────────────────────────────────────────────────
export {
  collectCursor,
  walkCursor,
  type PageFetcher,
  type PageRows,
  type PageRowsOption,
  type WalkCursorOptions,
} from "./pagination";

// ── Includes (the issue's "join sets") ───────────────────────────────────────
export {
  classifyIncludes,
  includeQueryValue,
  includesAllSatisfied,
  normalizeIncludes,
} from "./includes";

// ── Credentials ──────────────────────────────────────────────────────────────
export {
  CredentialManager,
  CredentialsApi,
  type CredentialManagerOptions,
  type CredentialStrategy,
} from "./credentials";

// ── Transactions (AC1, AC3) ──────────────────────────────────────────────────
export {
  TxApi,
  TxSubmitWaitError,
  TxWaitTimeoutError,
  type SubmitOptions,
  type SubmitResult,
  type TnSigner,
  type WaitForReceiptOptions,
} from "./tx";

// ── Typed namespaces ─────────────────────────────────────────────────────────
export {
  ChainReader,
  MarketsReader,
  NamespaceReader,
  StreamsReader,
  type NamespaceRequestOptions,
  type V1StreamLocator,
} from "./namespaces";

// ── Client ───────────────────────────────────────────────────────────────────
export { V1Client, type V1ClientOptions } from "./client";
