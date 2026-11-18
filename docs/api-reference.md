# API Reference

## Overview

The TRUF.NETWORK SDK provides a comprehensive interface for stream management, offering powerful primitives for data streaming, composition, and on-chain interactions.

## Client Initialization

### `createClient(config: ClientConfig)`
Initializes a TrufNetwork client with specified configuration.

#### Parameters
- `config: Object`
  - `privateKey: string` - Ethereum private key (securely managed)
  - `network: Object`
    - `endpoint: string` - RPC endpoint URL
    - `chainId: string` - Network chain identifier
  - `timeout?: number` - Optional request timeout (default: 30000ms)

#### Example
```typescript
import { createClient } from '@trufnetwork/sdk-js';

const client = createClient({
  privateKey: process.env.PRIVATE_KEY,
  network: {
    endpoint: 'http://localhost:8484',
    chainId: 'tn-v2.1' // Or left empty for local nodes
  },
  timeout: 45000  // Optional custom timeout
});
```

### Timeout

All network calls have a timeout. You can override it with the `timeout` option:

```typescript
const client = new NodeTNClient({
  // …other options…
  timeout: 45000, // Example of setting timeout to 45 seconds
});
```

### Session tokens

A gateway that can carry its session in a header returns a session token when a signer signs in, and the client sends it with that signer's reads as `Authorization: Bearer <token>`. This keeps the session where the gateway's cookie is dropped, as in a wallet's in-app browser.

#### Options

- `sessionTokens?: Record<string, string>` - Tokens saved from earlier sign-ins, keyed by the identifier `onSessionToken` reported
- `onSessionToken?: (identifier: string, token: string | undefined) => void` - Called when a signer's token changes: the new token after a sign-in, `undefined` after a logout or when the gateway refuses it

#### Methods

- `client.getSessionToken(): string | undefined` - The token held for the client's signer
- `client.setSessionToken(token: string | undefined): void` - Sets or clears it; does not call `onSessionToken`. Clearing only forgets the token here; the gateway session stays valid until it ends

Page scripts can read the token, unlike the gateway's cookie, and anyone who copies it can use the session until it ends.

#### Example

```typescript
import { BrowserTNClient } from '@trufnetwork/sdk-js';

// address and signer come from the connected wallet
let saved: Record<string, string> = {};
try {
  const parsed: unknown = JSON.parse(sessionStorage.getItem('tn-session-tokens') || '{}');
  // keep only an object of strings, so a damaged value cannot stop the saving
  if (
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((token) => typeof token === 'string')
  ) {
    saved = parsed as Record<string, string>;
  }
} catch {
  // storage blocked or the saved value unreadable: start without saved tokens
}

const client = new BrowserTNClient({
  endpoint: 'https://gateway.mainnet.truf.network',
  signerInfo: { address, signer },
  chainId: 'tn-v2.1',
  sessionTokens: saved,
  onSessionToken: (identifier, token) => {
    if (token) saved[identifier] = token;
    else delete saved[identifier];
    try {
      sessionStorage.setItem('tn-session-tokens', JSON.stringify(saved));
    } catch {
      // storage blocked or full: the client keeps its token in memory
    }
  },
});
```

## Kwil-free v1 Client (`@trufnetwork/sdk-js/v1`)

The consolidated v1 API has a second entry point that never loads
`@trufnetwork/kwil-js`, `ethers`, `pg`, or a Node builtin. A browser can place a
trade without a local payload encoder: `prepare` builds the payload
server-side, and the client echoes that envelope back when signing.

```typescript
import { V1Client } from "@trufnetwork/sdk-js/v1";

const client = new V1Client({
  baseUrl: "https://api.trufscan.io", // required; the SDK never hard-codes a host
  network: "mainnet", // becomes the /{network}/v1/... path segment
  signer: {
    address: walletAddress,
    // `signMessage` receives the exact UTF-8 bytes of `signature_message`. For
    // the default "secp256k1_ep" type it applies Ethereum personal-sign
    // (EIP-191), which is what ethers' `wallet.signMessage` does.
    signMessage: (message) => wallet.signMessage(message),
  },
});
```

- Import from the subpath only. The root entry still depends on `kwil-js`;
  `npm run check:v1` bundles the subpath for the browser and fails closed if that
  ever changes.
- `baseUrl` is required and must be an absolute `http(s)` URL. There is no
  built-in default: the hosted deployment used by Trufscan is
  `https://api.trufscan.io`, and any deployment exposing the same
  `/{network}/v1/...` routes works. The testnet `/v0` host is an unstable EC2
  DNS name, so the SDK ships no testnet default.
- `network` is validated (`[A-Za-z0-9._-]+`) and placed in the path.
- `timeoutMs` defaults to `30000`.
- The entry is side-effect free (`sideEffects: false`) and tree-shakeable.

### Three ways to transact

An intent names the namespace, the action, the account used for the nonce
lookup, and the typed arguments:

```typescript
import type { TxIntent } from "@trufnetwork/sdk-js/v1";

const intent: TxIntent = {
  namespace: "main",
  action: "place_trade",
  sender: walletAddress, // used for the nonce lookup, not as the envelope sender
  args: [
    { type: "text", value: "st_btcusd" },
    { type: "int8", value: 1 }, // a JSON number; see Precision below
  ],
};
```

**1. Convenience** — `submit` prepares, signs, broadcasts, and can wait for the
receipt. Verification is off by default.

```typescript
const { broadcast, receipt } = await client.tx.submit(intent, { wait: true });
```

**2. Verified** — opt-in hardening. A mismatch throws
`PayloadVerificationError` before anything is signed or broadcast.

```typescript
await client.tx.submit(intent, { verify: true }); // payload + envelope checks
await client.tx.submit(intent, { verify: { mode: "payload" } }); // payload only
```

**3. Self-construct** — `broadcast` is a pure passthrough. It accepts a signed
envelope built by any client and does not require a prior `prepare` in the same
instance, so an existing SDK can keep building transactions and relay them here.

```typescript
await client.tx.broadcast(envelopeBuiltElsewhere);
```

The step-by-step API is available when `submit` is too coarse:
`client.tx.params(sender)`, `client.tx.prepare(intent)`, `client.tx.verify(...)`,
`client.tx.sign(prepared)`, `client.tx.broadcast(signed)`,
`client.tx.get(hash)`, `client.tx.events(hash)`, and
`client.tx.waitForReceipt(hash)`.

### Signing and the envelope

`sign` takes the `signature_message` the API returned, hands its exact bytes to
the wallet, and returns a deep clone of the prepared envelope with two fields
added:

- `signature: { sig, type }` — `sig` is **base64 of the 65 raw `r || s || v`
  bytes**, and `type` is the signer's `signatureType`. The key is `sig`, not
  `data`; using `signature.data` is the usual cause of "invalid signature"
  reports.
- `sender` — the bare lowercase account hex, without `0x`.

Nothing else is re-encoded or re-ordered, and the prepared object is not
mutated, so the envelope you echo is exactly the one the server built.

The node checks each signature type differently, so `signatureType` decides
what `signMessage` must sign:

| `signatureType` | `address` | `signMessage` signs |
| :--- | :--- | :--- |
| `"secp256k1_ep"` (default) | the 20-byte Ethereum address | the message with Ethereum personal-sign (EIP-191), as `wallet.signMessage(message)` does |
| `"secp256k1"` | the 33-byte compressed public key | the sha256 of the message, as a plain secp256k1 signature with no EIP-191 prefix (the node does not read `v`) |

`sign` refuses an `address` of the wrong length for either type before the
wallet is asked to sign.

`sign` signs the message **verbatim**; it does not rebuild it. That is why
verification (below) refuses a `prepare` whose `signature_message` does not
match its own `body`: otherwise a dishonest API could show you a body worth
signing and hand the wallet a message for a different one.

### Verification semantics

`verifyPrepared(prepared, intent)` decodes the payload with a native
`EXECUTE_ACTION` decoder and compares it **semantically** with the intent. It
never re-encodes, never relies on `desc` (which is API-authored), and reports
issues instead of throwing; `assertPrepared` throws `PayloadVerificationError`
with the same issue list.

A payload that cannot be decoded at all is one of those reported failures, not
an exception: the result carries a `payload_decode` issue and `decoded` is
`null`, so `assertPrepared` still throws `PayloadVerificationError`. A caller
therefore never has to distinguish "the payload is wrong" from "the payload is
unreadable" with a `try`/`catch`.

The payload check covers the namespace, the action, the single-call shape, the
argument count, each argument's declared type (including `numeric(p,s)`
precision and scale), and each value. In `full` mode (the default) the envelope's
`body.type`, `fee`, `nonce`, and `chain_id` are also checked against what
`prepare` reported. `{ mode: "payload" }` restricts the check to the payload.

Strings (the namespace, the action, and `text` values) are compared as the node
reads them, byte for byte: a leading U+FEFF is kept, so it only matches an
intent that has it, and bytes that are not valid UTF-8 are a `payload_decode`
issue rather than a match for U+FFFD.

#### The signed message is bound to the body

A payload check alone proves what the envelope's `body` holds, not what the
signature authorizes, because `sign` signs `signature_message` as returned. So
verification also rebuilds the message from `body` and compares it with
`signature_message`. The message is kwil's `concat` serialization
(`txMsgToSignTmplV0`):

```
<desc>

PayloadType: <type>
PayloadDigest: <first 20 bytes of sha256(payload), hex>
Fee: <fee>
Nonce: <nonce>

Kwil Chain ID: <chain_id>
```

The trailing newline is part of the message. Rebuilding it costs a SHA-256 over
the payload (tens of bytes) and keeps verification synchronous; it is computed
in TypeScript rather than with `crypto.subtle`, which would force an async API
and is unavailable in non-secure browser contexts.

This check runs in **both** modes. The digest line is what commits the payload,
so it belongs to payload verification, not to the envelope echo that `full` mode
adds. It requires `transaction.serialization` to be `"concat"`; `direct` signs a
raw hash, which cannot be compared with a text message, and is reported as a
`serialization` issue instead of being silently skipped.

The reported `VerificationIssue.code` values are `payload_decode`,
`payload_type`, `namespace`, `action`, `call_count`, `argument_count`,
`argument_type`, `argument_value`, `array_length`, `serialization`,
`signature_message`, `fee`, `nonce`, and `chain_id`.

Comparison follows the server's coercion rules:

- `int8` accepts a safe JSON number (preferred), a `bigint`, or a decimal
  integer string in the intent; the decoded value is a `bigint`. Only a JSON
  `number` is guaranteed to be accepted by the server for `int8` (see
  Precision).
- `uuid` compares normalised forms, so case, dashes, and braces are ignored and a
  dashless or braced intent matches the server's canonical output; `bytea`
  accepts hex with or without `0x`.
- `numeric` compares canonically, so `1.50` equals `1.5` and `1E-7` equals
  `0.0000001`. A `bigint` or `number` intent value is canonicalised too; any
  non-decimal value is reported as a mismatch rather than throwing.
- A scalar JSON `null` ignores the declared type; a `null` array is the empty
  array.

### Precision

`int8` intents are best given as JSON numbers. Verification also accepts a
`bigint` or an integer string, but a `bigint` cannot be `JSON.stringify`'d:
the transport serialises one as a decimal string, which the server accepts for
`numeric(p,s)` but rejects for `int8`. Keep `int8` values within
`Number.MAX_SAFE_INTEGER` (`2^53 - 1`); verification rejects anything larger
rather than silently truncating it.

### Credentials

There is no refresh route. A credential is re-minted (public preset) or
re-redeemed (paid preset), and `expires_at` is the schedule. The routes are
reachable through `client.credentialsApi`:

| Method | Route |
|---|---|
| `mint(preset?)` | `POST /{network}/v1/credentials` |
| `jwks()` | `GET /{network}/v1/credentials/jwks` |
| `quote(preset, days)` | `GET /{network}/v1/credentials/quote` |
| `redeem({ tx_hash, preset, signature, quote? })` | `POST /{network}/v1/credentials/redemptions` |

These four routes are ungated on the server, so the client sends no bearer token
when calling them. That is what lets `CredentialManager` mint the very token it
will use for every other route: a gated mint would have to acquire a token to
acquire a token, which recurses.

`client.credentialsApi.mint()` needs an `Origin` on the API's allowlist. A
browser sets its own, so a page served from an allowed origin works as-is; a
server-side mint passes `origin` in the constructor options.

To let the client manage the credential, give it a strategy. Requests then carry
`Authorization: Bearer <credential>` and a burst of calls shares one acquisition
(single flight), refreshed lazily from `expires_at` with a 30-second skew.

```typescript
const client = new V1Client({
  baseUrl,
  network,
  // Public preset: re-minted when it nears expiry.
  credentialStrategy: { kind: "public", preset: "public" },
  // Paid preset: re-redeemed on demand. `payment` returns a fresh (or
  // idempotent) payment for each acquisition.
  // credentialStrategy: { kind: "redeem", payment: async () => payment },
});

// Access the manager directly to inspect or force a refresh.
await client.credentialManager?.getToken();
```

A static `token` is also accepted; it is ignored when `getToken` or a strategy is
set.

### Capabilities and namespace gating

Capabilities is the degradation switch. Load it once, then ask before calling a
namespace:

```typescript
await client.loadCapabilities();

client.supportsNamespace("markets"); // offered and permitted
client.offersNamespace("markets"); // offered, regardless of permission
client.namespace("markets"); // throws NamespaceUnavailableError if not usable
```

Before capabilities are loaded the client treats the namespace as unknown and
lets the server answer (`409 namespace_unavailable`, or `403 permission_denied`).
`capabilitiesSupports`, `capabilitiesPermits`, and `capabilitiesAllow` are
exported for the same checks against a document you already hold.

### Join sets (`include`)

The v1 lists accept one join parameter, `include`, with the tokens `metadata`,
`prices`, `depth`, and `chain`. `normalizeIncludes` makes a set order-insensitive
and duplicate-free, `includeQueryValue` produces the query value, and
`classifyIncludes` maps the response to per-token `satisfied`, `unavailable`, or
`uncollected` outcomes. An unavailable include is data, not a failed request.

### Pagination

Every list shares one cursor walker. A cursor is opaque, route-scoped, and
`null` on the last page; `walkCursor` copies it verbatim, stops on `null` or an
empty page, honours `maxPages`, and throws if a server ever repeats a cursor.
`NamespaceReader.paginate` and `.collect` wrap it, and `limit` is the only paging
knob v1 has.

```typescript
for await (const page of client.markets.markets({ limit: 100 })) {
  consume(page.data);
}
const all = await client.markets.collect("", { limit: 100 });
```

Most lists return their rows as `data`. A few keep the v0 object as `data` and
put the rows in one of its fields, for example `events` on
`markets/{id}/activity` and `trades` on `markets/{id}/trades`. Pass `rows` to
pick them out; `collect` and `collectCursor` throw without it on such a list,
and `paginate` and `walkCursor` use it to stop on an empty page.

```typescript
const events = await client.markets.collect("3105/activity", {
  rows: (data: { query_id: number; events: MarketEvent[] }) => data.events,
});
```

### Namespaces

Phase 1 ships typed readers for `tx`, `capabilities`, `credentials`, `streams`,
`chain`, and `markets`. `client.namespace(name)` is the generic accessor for any
other namespace (`agents`, `bridge`, `metadata`), which get named readers later.

| Reader | Routes |
|---|---|
| `client.streams` | `streams/{provider}/{id}` and its `records`, `index`, `index-change`, `first-record`, `taxonomy`, `access` sub-routes (locator-addressed; there is no list route) |
| `client.chain` | `chain/blocks`, `chain/block`, `chain/transactions`, `chain/transactions/{hash}`, and the count routes |
| `client.markets` | `markets`, `markets/{id}`, `markets/{id}/{sub}`, `markets/participants/{wallet}/{sub}` |

### Typed errors

The transport throws `V1ApiError`. Branch on `code` and `details.lever`, never on
`message`:

- `code` is one of `invalid_argument`, `unauthenticated`,
  `permission_denied`, `resource_exhausted`, `not_found`,
  `namespace_unavailable`, `failed_precondition`, `unavailable`, `internal`.
- `V1ApiError.TRANSPORT_CODE` (`transport_error`) means there was no v1 JSON
  error: a plain-text `404`, invalid JSON, or a network failure. `status` is
  `0` when no response arrived (a timeout or an unreachable host); a timeout or
  failure while reading an error response's body keeps that response's status.
- `is(code)` and `isLever(lever)` are conveniences over those fields.

The transport never retries a `429`; surface `details.lever` to the caller. The
one retry in the client is `tx.waitForReceipt`, described below.

### Receipts and troubleshooting

- `tx.get(hash)` returns the receipt; `height` is `-1` while the transaction is
  still in the mempool.
- `tx.waitForReceipt(hash)` resolves once `height >= 0`. It retries a
  `not_found` while the node has not admitted the transaction, a `503`
  `unavailable`, a `429` `resource_exhausted`, a `502` or `504` from a proxy,
  and a request that got no response, and throws `TxWaitTimeoutError` when the
  timeout elapses, with the last failed read as `cause`. No read starts after
  `timeoutMs`, and a read still in flight then, or the credential fetch it
  waits on, is cancelled. Any other error, such as a plain-text `404` from a
  wrong `baseUrl`, and an abort end the wait at once.
- `tx.submit(intent, { wait })` throws `TxSubmitWaitError` when the broadcast
  succeeded but the wait failed. It carries `hash`, `signed`, `prepared`, and
  `broadcast`, and the original error as `cause`: poll `hash` again or resend
  `signed`. Calling `submit` again would prepare a second transaction with the
  next nonce.
- A `200` at broadcast followed by a receipt that **stays** `404` means the node
  did not admit the envelope. Prepare and sign again instead of polling forever.
- Resending the same signed envelope is safe; it has the same transaction hash.
- A definitive `400` means the envelope was rejected. Re-prepare on a definitive
  `400` to get a fresh nonce, and never reuse an old nonce after a gap.

### Packaging and version

`main`, `module`, and `types` are unchanged, and the existing `node`, `browser`,
and `default` conditions moved verbatim under the `.` key; `exports` gained the
`./v1` subpath, which is why the sugar form had to become the expanded form.
Existing imports keep working with no code change.

## Stream Identification

### `StreamId.generate(name: string): Promise<StreamId>`
Generates a deterministic, unique stream identifier.

#### Parameters
- `name: string` - Descriptive name for the stream

#### Returns
- `Promise<StreamId>` - Unique stream identifier

#### Example
```typescript
const marketIndexStreamId = await StreamId.generate('market_index');
```

## Stream Deployment

### `client.deployStream(streamId: StreamId, type: StreamType, synchronous?: boolean, allowZeros?: boolean): Promise<Types.GenericResponse<Types.TxReceipt>>`
Deploys a new stream to the TRUF.NETWORK.

#### Parameters
- `streamId: StreamId` - Unique stream identifier
- `type: StreamType` - Stream type (Primitive or Composed)
- `synchronous?: boolean` - When true, the kwild gateway holds the request open until the deploy transaction is confirmed.
- `allowZeros?: boolean` - Per-stream toggle controlling whether `value=0` inserts are persisted. Default `false` preserves the historical behavior (zeros are silently dropped on insert and excluded from `getRecord` results). Set `true` for streams where zero is a meaningful measurement. This setting can be toggled later via `action.setAllowZeros`.

#### Returns
- `Promise<Types.GenericResponse<Types.TxReceipt>>` — re-exported from `@trufnetwork/kwil-js`.
  - `status: number` - HTTP-style status from the kwild RPC.
  - `data?: { tx_hash: string }` - Present on success; `tx_hash` is the broadcast transaction hash. The deploy is in the mempool (or, with `synchronous: true`, mined) — pass the hash to `client.waitForTx(tx_hash)` before issuing dependent operations such as `insertRecord`.

#### Example
```typescript
const deploymentResult = await client.deployStream(
        marketIndexStreamId,
        StreamType.Composed
);

// Stream where zero is a valid value:
await client.deployStream(
  hormuzStreamId,
  StreamType.Primitive,
  /* synchronous */ false,
  /* allowZeros */ true,
);
```

### `action.setAllowZeros(stream: StreamLocator, value: boolean)`
Toggles the per-stream `allow_zeros` flag for an existing stream. Owner-gated.

The flip is forward-only — historical inserts are not rewritten. Zero records that were dropped before the flip stay dropped; zeros that arrive after the flip persist.

```typescript
const action = client.loadAction();
await action.setAllowZeros({ streamId, dataProvider }, true);
```

### `action.getAllowZeros(stream: StreamLocator): Promise<boolean>`
Returns the current `allow_zeros` setting for the stream. Returns `false` when the stream has no explicit metadata row, matching the implicit default applied at insert time.

## Stream Destruction

### `client.destroyStream(streamLocator: StreamLocator): Promise<DestructionResult>`
Permanently removes a stream from the network.

#### Parameters
- `streamLocator: Object`
  - `streamId: StreamId`
  - `dataProvider: EthereumAddress`

#### Example
```typescript
await client.destroyStream({
  streamId: marketIndexStreamId,
  dataProvider: wallet.address
});
```

## Record Insertion

### `streamAction.insertRecord(options: InsertRecordOptions): Promise<InsertResult>`
Inserts a single record into a stream.

#### Parameters
- `options: Object`
  - `stream: StreamLocator` - Target stream
  - `eventTime: number` - UNIX timestamp of the record in seconds.
  - `value: string` - Record value

#### Example
```typescript
const insertResult = await primitiveAction.insertRecord({
  stream: streamLocator,
  eventTime: Date.now(),
  value: "100.50"
});
```

### `streamAction.insertRecords(records: InsertRecordOptions[]): Promise<BatchInsertResult>`
Batch inserts multiple records for efficiency.

#### Parameters
- `records: Array<InsertRecordOptions>` - Array of record insertion options

#### Example
```typescript
const batchResult = await primitiveAction.insertRecords([
	{
		stream: stockStream,
		eventTime: Math.floor(Date.now() / 1000),
		value: "150.25",
	},
	{
		stream: commodityStream,
		eventTime: Math.floor(Date.now() / 1000),
		value: "75.10",
	},
]);
```

## Stream Querying

### `streamAction.getRecord(input: GetRecordInput): Promise<StreamRecord[]>`
Retrieves the **raw numeric values** recorded in a stream for each timestamp.  For primitive streams this is a direct read of the stored events; for composed streams the engine performs an _on-the-fly_ aggregation of all underlying child streams using the active taxonomy and weights at each point in time.

The call is the foundation on which `getIndex` and `getIndexChange` are built—use it whenever you need the exact original numbers without any normalisation.

**Key behaviours**

1. **Time window** — `from` and `to` are inclusive UNIX epoch timestamps in **seconds**.
2. **LOCF gap-filling** — If no event exists exactly at `from`, the service automatically carries forward the last known value so that downstream analytics have a continuous series.
3. **Time-travel (`frozenAt`)** — Supply a block-height timestamp to query the database _as it looked in the past_ (i.e. ignore records created after that height).
4. **Access control** — Internally calls `is_allowed_to_read_all` ensuring the caller has permission to view every sub-stream referenced by a composed stream.
5. **Performance** — For large ranges prefer batching or add tighter `from` / `to` filters.

#### Parameters
- `input: Object`
  - `stream: StreamLocator` – Target stream (primitive **or** composed)
  - `from?: number` – Optional start timestamp (UNIX seconds). If omitted returns the latest value.
  - `to?: number` – Optional end timestamp (UNIX seconds). Must be ≥ `from`.
  - `frozenAt?: number` – Optional created-at cut-off for historical queries.
  - `baseTime?: number` – Ignored by `getRecord`; present only for signature compatibility with other helpers.

#### Example
```typescript
const nowInSeconds = Math.floor(Date.now() / 1000);
const { data: records } = await streamAction.getRecord(
	marketIndexLocator,
	{ from: nowInSeconds - 86400, to: nowInSeconds }
);
```

### `streamAction.getIndex(input: GetRecordInput): Promise<StreamRecord[]>`
Transforms raw stream values into an "index" series normalised to a base value of **100** at a reference time.  This is useful for turning any price/metric into a percentage-based index so that unrelated streams can be compared on the same scale.

The underlying formula (applied server-side, see `get_index` action) is:

```
index_t = (value_t * 100) / baseValue
```

where `baseValue` is the stream value obtained at `baseTime` (or the closest available value before/after that time if no exact sample exists).

#### Parameters
- `input: Object`
  - `stream: StreamLocator` – Target stream (primitive **or** composed)
  - `from?: number` – Optional start timestamp (UNIX seconds).
  - `to?: number` – Optional end timestamp (UNIX seconds).
  - `frozenAt?: number` – Optional timestamp for "time-travel" queries (records created at or before `frozenAt` only)
  - `baseTime?: number` – Reference timestamp (UNIX seconds) used for normalisation. If omitted, the SDK will try, in order:
    1. `default_base_time` metadata on the stream
    2. The first available record in the stream

#### Returns
- `Promise<StreamRecord[]>` – Array of `{ eventTime: number, value: string }` representing indexed values.

#### Example
```typescript
const nowInSeconds = Math.floor(Date.now() / 1000);
const { data: indexSeries } = await streamAction.getIndex(
	marketIndexLocator,
	{
		from: nowInSeconds - 30 * 24 * 60 * 60, // 30 days
		to: nowInSeconds,
		baseTime: nowInSeconds - 365 * 24 * 60 * 60, // One year ago
	}
);
```

### `streamAction.getIndexChange(input: GetRecordInput): Promise<StreamRecord[]>`
Computes the **percentage change** of the index value over a fixed rolling window `timeInterval`.

For each returned `eventTime` the engine looks backwards by `timeInterval` seconds and picks the closest index value **at or before** that point.  The change is then calculated as:

```
change_t = ((index_t − index_{t−Δ}) / index_{t−Δ}) * 100
```

This is equivalent to the classic Δ% formula used in financial analytics.

#### Parameters
- `input: Object`
  - All properties from `GetRecordInput` (`stream`, `from`, `to`, `frozenAt`, `baseTime`)
  - `timeInterval: number` – Window size in **seconds** (e.g. `86400` for daily change, `31536000` for yearly change). **Required.**

#### Returns
- `Promise<StreamRecord[]>` – Array of `{ eventTime: number, value: string }` where `value` is the percentage change over `timeInterval`.

#### Example
```typescript
const nowInSeconds = Math.floor(Date.now() / 1000);
const { data: yearlyChange } = await streamAction.getIndexChange(
	marketIndexLocator,
	{
		from: nowInSeconds - 2 * 365 * 24 * 60 * 60, // Last 2 years
		to: nowInSeconds,
		timeInterval: 31536000, // 1 year in seconds
	}
);
console.log("Year-on-year % change", yearlyChange);
```

### `streamAction.customProcedureWithArgs(procedure: string, args: Record<string, ValueType | ValueType[]>): Promise<StreamRecord[]>`
Allows you to invoke any stored procedure defined in the underlying Kwil database and receive the results in `StreamRecord` format.  Use this when the built-in helpers (`getRecord`, `getIndex`, `getIndexChange`) don't meet a specialised analytics need.

#### Parameters
- `procedure: string` – Name of the stored procedure.
- `args: Record<string, ValueType | ValueType[]>` – Named parameters **including** the leading `$` expected by Kwil.

#### Returns
- `Promise<StreamRecord[]>` – Each row emitted by the procedure must expose `event_time` and `value` columns for automatic mapping.

#### Example
```typescript
const result = await streamAction.customProcedureWithArgs(
  "get_divergence_index_change",
  {
    $from: 1704067200,
    $to: 1746316800,
    $frozen_at: null,
    $base_time: null,
    $time_interval: 31536000,
  },
);
```

## Cache Support

The SDK can transparently use a node-side cache layer (when the node has the `tn_cache` extension enabled).  The feature is *opt-in* – you simply pass `useCache: true` inside the options object of any read helper and the same function now returns a wrapper that includes cache metadata.

### What's new

* `useCache` (boolean) – optional flag in **all** data-retrieval helpers (`getRecord`, `getIndex`, `getIndexChange`, `getFirstRecord`).
* Return type becomes `CacheAwareResponse<T>` which contains:
  * `data` – the normal payload you used to receive.
  * `cache` – `{ hit: boolean; height?: number }` when the node emitted cache metadata.
  * `logs` – raw NOTICE logs (useful for debugging).
* Legacy signatures are still available but are **deprecated** – a one-time `console.warn` is printed if you call them.

### Cache Metadata

The cache metadata includes both node-provided and SDK-enhanced fields:

```typescript
interface CacheMetadata {
  // Node-provided fields
  hit: boolean;                    // Whether data came from cache
  cacheDisabled?: boolean;         // Whether cache was disabled for this query
  
  // SDK-provided context fields
  streamId?: string;              // Stream ID used in the query
  dataProvider?: string;          // Data provider address
  from?: number;                  // Start time of the query range
  to?: number;                    // End time of the query range
  frozenAt?: number;              // Frozen time for historical queries
  rowsServed?: number;            // Number of rows returned
}
```

### Cache Aggregation

For batch operations or analytics, use `CacheMetadataParser.aggregate()` to combine multiple cache metadata entries:

```typescript
import { CacheMetadataParser } from '@trufnetwork/sdk-js';

const metadataList: CacheMetadata[] = [
  { hit: true, rowsServed: 10, streamId: 'stream-1' },
  { hit: false, rowsServed: 5, streamId: 'stream-2' },
  { hit: true, rowsServed: 15, streamId: 'stream-3' }
];

const aggregated = CacheMetadataParser.aggregate(metadataList);
// Returns: CacheMetadataCollection
// {
//   totalQueries: 3,
//   cacheHits: 2,
//   cacheMisses: 1,
//   cacheHitRate: 0.67,
//   totalRowsServed: 30,
//   entries: [...metadataList]
// }
```

### Quick example
```typescript
// Enhanced call – identical parameters plus the flag
const { data: records, cache } = await streamAction.getRecord(
        aiIndexLocator,
        { from: now - 86400, to: now, useCache: true },
);

if (cache?.hit) {
  console.log('Cache hit!');
}
```

## Composition Management

### `composedAction.setTaxonomy(options: TaxonomyConfig): Promise<TaxonomyResult>`
Configures stream composition and weight distribution.

#### Parameters
- `options: Object`
  - `stream: StreamLocator` - Composed stream
  - `taxonomyItems: Array<{childStream: StreamLocator, weight: string}>`
  - `startDate: number` - Effective date for taxonomy

#### Example
```typescript
await composedAction.setTaxonomy({
	stream: composedMarketIndexLocator,
	taxonomyItems: [
		{ childStream: stockStream, weight: "0.6" },
		{ childStream: commodityStream, weight: "0.4" },
	],
	startDate: Math.floor(Date.now() / 1000),
});
```

### `composedAction.listTaxonomiesByHeight(params?: ListTaxonomiesByHeightParams): Promise<TaxonomyQueryResult[]>`
Queries taxonomies within a specific block height range for efficient incremental synchronization. This method enables detecting taxonomy changes since a specific block height without expensive full-stream scanning.

#### Parameters
- `params?: Object` - Optional query parameters
  - `fromHeight?: number` - Start height (inclusive). If null, uses earliest available.
  - `toHeight?: number` - End height (inclusive). If null, uses current height.
  - `limit?: number` - Maximum number of results to return. Default: 1000
  - `offset?: number` - Number of results to skip for pagination. Default: 0
  - `latestOnly?: boolean` - If true, returns only latest group_sequence per stream. Default: false

#### Returns
- `Promise<TaxonomyQueryResult[]>` - Array of taxonomy entries with:
  - `dataProvider: EthereumAddress` - Parent stream data provider
  - `streamId: StreamId` - Parent stream ID
  - `childDataProvider: EthereumAddress` - Child stream data provider  
  - `childStreamId: StreamId` - Child stream ID
  - `weight: string` - Weight of the child stream in the taxonomy
  - `createdAt: number` - Block height when taxonomy was created
  - `groupSequence: number` - Group sequence number for this taxonomy set
  - `startTime: number` - Start time timestamp for this taxonomy

#### Example
```typescript
// Get taxonomies created between blocks 1000 and 2000
const taxonomies = await composedAction.listTaxonomiesByHeight({
  fromHeight: 1000,
  toHeight: 2000,
  limit: 100,
  latestOnly: true
});

// Get latest taxonomies with pagination
const latestTaxonomies = await composedAction.listTaxonomiesByHeight({
  latestOnly: true,
  limit: 50,
  offset: 100
});
```

### `composedAction.getTaxonomiesForStreams(params: GetTaxonomiesForStreamsParams): Promise<TaxonomyQueryResult[]>` 🔍
Batch fetches taxonomies for specific streams. This is the primary method for discovering stream composition relationships. Useful for validating taxonomy data for known streams or processing multiple streams efficiently.

#### Parameters
- `params: Object` - Query parameters (required)
  - `streams: StreamLocator[]` - Array of stream locators to query
  - `latestOnly?: boolean` - If true, returns only latest group_sequence per stream. Default: false

#### Returns
- `Promise<TaxonomyQueryResult[]>` - Array of taxonomy entries containing:
  - `dataProvider: EthereumAddress` - Parent stream data provider
  - `streamId: StreamId` - Parent stream ID
  - `childDataProvider: EthereumAddress` - Child stream data provider  
  - `childStreamId: StreamId` - Child stream ID
  - `weight: string` - Weight of the child stream (0.0 to 1.0)
  - `createdAt: number` - Block height when taxonomy was created
  - `groupSequence: number` - Group sequence number for this taxonomy set
  - `startTime: number` - Start time timestamp for this taxonomy

#### Example
```typescript
const streams = [
  { dataProvider: provider1, streamId: streamId1 },
  { dataProvider: provider2, streamId: streamId2 }
];

const taxonomies = await composedAction.getTaxonomiesForStreams({
  streams,
  latestOnly: true
});

// Process results for each stream
taxonomies.forEach(taxonomy => {
  console.log(`Stream ${taxonomy.streamId.getId()} has child ${taxonomy.childStreamId.getId()} with weight ${taxonomy.weight}`);
});

// Example: Build a taxonomy map for visualization
const taxonomyMap = new Map();
taxonomies.forEach(taxonomy => {
  const parentId = taxonomy.streamId.getId();
  if (!taxonomyMap.has(parentId)) {
    taxonomyMap.set(parentId, []);
  }
  taxonomyMap.get(parentId).push({
    childId: taxonomy.childStreamId.getId(),
    weight: parseFloat(taxonomy.weight)
  });
});
```

### High-Level Client Methods

The new taxonomy querying methods are also available directly on the client for convenience:

```typescript
// Equivalent to composedAction.listTaxonomiesByHeight()
const taxonomies = await client.listTaxonomiesByHeight({
  fromHeight: 1000,
  toHeight: 2000,
  limit: 100,
  latestOnly: true
});

// Equivalent to composedAction.getTaxonomiesForStreams()
const streamTaxonomies = await client.getTaxonomiesForStreams({
  streams: [streamLocator1, streamLocator2],
  latestOnly: true
});
```

## Visibility and Permissions

### `streamAction.setReadVisibility(streamLocator: StreamLocator, visibility: Visibility)`
Controls stream read access.

#### Example
```typescript
await streamAction.setReadVisibility(
        streamLocator,
        visibility.private
);
```

### `streamAction.allowReadWallet(streamLocator: StreamLocator, walletAddress: EthereumAddress)`
Grants read permissions to specific wallets.

#### Example
```typescript
await streamAction.allowReadWallet(
        streamLocator,
        EthereumAddress.fromString("0x...")
);
```

## Transaction Ledger Queries

Query transaction history, fees, and distributions for auditing and analytics.

### `transactionAction.getTransactionEvent(input: GetTransactionEventInput): Promise<TransactionEvent>`

Retrieves detailed information about a specific transaction by its hash.

#### Parameters
- `input: Object`
  - `txId: string` - Transaction hash (with or without `0x` prefix)

#### Returns
- `Promise<TransactionEvent>` - Complete transaction details including:
  - `txId: string` - Transaction hash (0x-prefixed)
  - `blockHeight: number` - Block number where transaction was included
  - `stampMs: number` - Millisecond timestamp from the block header (0 when unavailable)
  - `method: string` - Method name (e.g., "deployStream", "insertRecords")
  - `caller: string` - Ethereum address of the caller (lowercase, 0x-prefixed)
  - `feeAmount: string` - Total fee amount as string (handles large numbers)
  - `feeRecipient?: string` - Primary fee recipient address (optional)
  - `metadata?: string` - Optional metadata JSON (optional)
  - `feeDistributions: FeeDistribution[]` - Array of fee distributions

#### FeeDistribution Type
```typescript
interface FeeDistribution {
  recipient: string;  // Recipient Ethereum address
  amount: string;     // Amount as string (handles large numbers)
}
```

#### Example
```typescript
const transactionAction = client.loadTransactionAction();

const txEvent = await transactionAction.getTransactionEvent({
  txId: '0xabcdef123456...'
});

console.log(`Method: ${txEvent.method}`);
console.log(`Caller: ${txEvent.caller}`);
console.log(`Fee: ${txEvent.feeAmount} wei`);
console.log(`Block: ${txEvent.blockHeight}`);
console.log(`Timestamp: ${txEvent.stampMs}`);

// Check fee distributions
for (const dist of txEvent.feeDistributions) {
  console.log(`  → ${dist.recipient}: ${dist.amount} wei`);
}
```

### `transactionAction.listTransactionFees(input: ListTransactionFeesInput): Promise<TransactionFeeEntry[]>`

Lists transactions filtered by wallet address and mode, with pagination support.

#### Parameters
- `input: Object`
  - `wallet: string` - Ethereum address to query (required)
  - `mode?: 'paid' | 'received' | 'both'` - Filter mode (optional, default: `'paid'`):
    - `'paid'` - Transactions where wallet paid fees
    - `'received'` - Transactions where wallet received fee distributions
    - `'both'` - All transactions involving the wallet
  - `limit?: number` - Maximum **transactions** to return (optional, default: 20; the node errors above 1000). The node paginates before expanding each transaction into one row per fee distribution, so the returned array can be longer than this.
  - `offset?: number` - Transactions to skip, for pagination (optional, default: 0)

#### Returns
- `Promise<TransactionFeeEntry[]>` - Array of transaction entries, each containing:
  - `txId: string` - Transaction hash
  - `blockHeight: number` - Block number
  - `method: string` - Method name
  - `caller: string` - Caller address
  - `totalFee: string` - Total fee amount
  - `feeRecipient?: string` - Primary recipient (optional)
  - `metadata?: string` - Optional metadata (optional)
  - `distributionSequence: number` - Distribution index (for multiple distributions)
  - `distributionRecipient?: string` - Recipient address for this distribution (optional)
  - `distributionAmount?: string` - Amount for this distribution (optional)

**Note:** This method returns one row per fee distribution. If a transaction has multiple distributions, it will appear multiple times with different `distributionSequence` values.

#### Example - List Fees Paid
```typescript
const transactionAction = client.loadTransactionAction();
const wallet = client.address().getAddress();

const entries = await transactionAction.listTransactionFees({
  wallet,
  mode: 'paid',
  limit: 10
});

for (const entry of entries) {
  console.log(`${entry.method}: ${entry.totalFee} wei (block ${entry.blockHeight})`);
}
```

#### Example - Pagination
```typescript
// Get first page
const page1 = await transactionAction.listTransactionFees({
  wallet,
  mode: 'both',
  limit: 20,
  offset: 0
});

// Get second page
const page2 = await transactionAction.listTransactionFees({
  wallet,
  mode: 'both',
  limit: 20,
  offset: 20
});
```

#### Example - Fees Received
```typescript
// Track fee distributions received by a validator
const entries = await transactionAction.listTransactionFees({
  wallet: validatorAddress,
  mode: 'received',
  limit: 100
});

let totalReceived = BigInt(0);
for (const entry of entries) {
  if (entry.distributionAmount) {
    totalReceived += BigInt(entry.distributionAmount);
  }
}

console.log(`Total fees received: ${totalReceived} wei`);
```

### Use Cases

#### Auditing: Track Monthly Spending
```typescript
// Calculate total fees paid by wallet
const entries = await transactionAction.listTransactionFees({
  wallet: myWallet,
  mode: 'paid'
});

let totalSpent = BigInt(0);
for (const entry of entries) {
  totalSpent += BigInt(entry.totalFee);
}

console.log(`Total spent: ${totalSpent} wei`);
```

#### Analytics: Transaction Patterns
```typescript
// Analyze transaction types and their costs
const methodCounts = new Map<string, number>();
const methodCosts = new Map<string, bigint>();

const entries = await transactionAction.listTransactionFees({
  wallet: myWallet,
  mode: 'paid'
});

for (const entry of entries) {
  methodCounts.set(entry.method, (methodCounts.get(entry.method) || 0) + 1);
  methodCosts.set(
    entry.method,
    (methodCosts.get(entry.method) || BigInt(0)) + BigInt(entry.totalFee)
  );
}

for (const [method, count] of methodCounts) {
  const avgCost = methodCosts.get(method)! / BigInt(count);
  console.log(`${method}: ${count} calls, avg cost ${avgCost} wei`);
}
```

#### Fee Distribution Tracking
```typescript
// Monitor where your fees are going
const txEvent = await transactionAction.getTransactionEvent({
  txId: deployTxHash
});

console.log(`Transaction: ${txEvent.txId}`);
console.log(`Total Fee: ${txEvent.feeAmount} wei`);
console.log('\nFee Distributions:');

for (let i = 0; i < txEvent.feeDistributions.length; i++) {
  const dist = txEvent.feeDistributions[i];
  console.log(`  ${i + 1}. ${dist.recipient}: ${dist.amount} wei`);
}
```

## Transaction Handling

### Understanding Async Transaction Behavior ⚠️

**Critical Understanding**: TN operations return success when transactions enter the mempool, NOT when they're executed on-chain. For operations where order matters, you must wait for transactions to be mined before proceeding.

> 💡 **See Complete Example**: For a comprehensive demonstration of transaction lifecycle patterns, see [Transaction Lifecycle Example](../examples/transaction-lifecycle-example/index.ts)

#### The Race Condition Problem

```typescript
// ❌ DANGEROUS - Race condition possible
const deployResult = await client.deployStream(streamId, StreamType.Primitive);
// Stream might not be ready yet!
await primitiveAction.insertRecord({ stream: client.ownStreamLocator(streamId), ... }); // Could fail

const destroyResult = await client.destroyStream(client.ownStreamLocator(streamId));
// Stream might not be destroyed yet!
await primitiveAction.insertRecord({ stream: client.ownStreamLocator(streamId), ... }); // Could succeed unexpectedly
```

### `client.waitForTx(txHash: string, timeout?: number): Promise<TransactionReceipt>`
Waits for transaction confirmation with optional timeout. Use this for operations where order matters.

#### Parameters
- `txHash: string` - Transaction hash from operation result
- `timeout?: number` - Maximum wait time in milliseconds (default: 30000)

#### Returns
- `Promise<TransactionReceipt>` - Transaction receipt with confirmation status

#### Safe Pattern Example
```typescript
// ✅ SAFE - Explicit transaction confirmation
const deployResult = await client.deployStream(streamId, StreamType.Primitive);
if (!deployResult.data) {
  throw new Error('Deploy failed');
}

// Wait for deployment to complete
await client.waitForTx(deployResult.data.tx_hash);

// Now safe to proceed
await primitiveAction.insertRecord({
  stream: client.ownStreamLocator(streamId),
  eventTime: Math.floor(Date.now() / 1000),
  value: "100.50"
});
```

#### When to Use waitForTx:
- ✅ **Stream deployment** before data insertion
- ✅ **Stream deletion** before cleanup verification  
- ✅ **Sequential operations** with dependencies
- ✅ **Testing and development** scenarios

#### When Async is Acceptable:
- ⚡ **High-throughput data insertion** (independent records)
- ⚡ **Fire-and-forget operations** (with proper error handling)

## Attestation Payload Parsing

### `parseAttestationPayload(payload: Uint8Array): ParsedAttestationPayload`
Parses and decodes a canonical attestation payload (without the 65-byte signature).

#### Parameters
- `payload: Uint8Array` - Canonical payload bytes (full payload minus last 65 bytes)

#### Returns
- `ParsedAttestationPayload` object with:
  - `version: number` - Protocol version (currently 1)
  - `algorithm: number` - Signature algorithm (0 = secp256k1)
  - `blockHeight: bigint` - Block height when attestation was created
  - `dataProvider: string` - Data provider Ethereum address (hex format)
  - `streamId: string` - Stream identifier
  - `actionId: number` - Action identifier
  - `arguments: any[]` - Decoded action arguments
  - `result: DecodedRow[]` - Decoded query results as rows (see [`DecodedRow`](#decodedrow))

#### Example
```typescript
import { parseAttestationPayload } from "@trufnetwork/sdk-js";
import { sha256, recoverAddress } from "ethers";

// Get signed attestation
const attestationAction = client.loadAttestationAction();
const signedAttestation = await attestationAction.getSignedAttestation({
  requestTxId: "0x..."
});

// Extract canonical payload (without signature)
const payloadBytes = signedAttestation.payload;
const canonicalPayload = payloadBytes.slice(0, -65);
const signature = payloadBytes.slice(-65);

// Verify signature
const digest = sha256(canonicalPayload);
const r = "0x" + Buffer.from(signature.slice(0, 32)).toString("hex");
const s = "0x" + Buffer.from(signature.slice(32, 64)).toString("hex");
const v = signature[64];
const validatorAddress = recoverAddress(digest, { r, s, v });

// Parse payload
const parsed = parseAttestationPayload(canonicalPayload);

console.log(`Validator: ${validatorAddress}`);
console.log(`Block: ${parsed.blockHeight}`);
console.log(`Provider: ${parsed.dataProvider}`);
console.log(`Stream: ${parsed.streamId}`);
console.log(`Results: ${parsed.result.length} rows`);

// Access query results
parsed.result.forEach((row, idx) => {
  const [timestamp, value] = row.values;
  console.log(`Row ${idx + 1}: timestamp=${timestamp}, value=${value}`);
});
```

### `DecodedRow`

Represents a decoded row from attestation query results.

#### Type Definition
```typescript
interface DecodedRow {
  values: any[];
}
```

#### Fields
- `values: any[]` - Array of decoded column values
  - For attestation results: `values[0]` is the timestamp (string), `values[1]` is the value (string)
  - Values are decoded according to their data types (integers as BigInt, strings as string, etc.)

#### Example
```typescript
// Example DecodedRow from attestation result
const row: DecodedRow = {
  values: [
    "1704067200",              // timestamp (Unix time as string)
    "77.051806494788211665"    // value (18-decimal fixed-point as string)
  ]
};

// Accessing row data
const [timestamp, value] = row.values;
console.log(`Timestamp: ${timestamp}, Value: ${value}`);
```

**Note**: When used in attestation results (via `parseAttestationPayload`), each `DecodedRow` contains exactly two values: a Unix timestamp and a decimal value string. For the outcome actions (ids 13-16) there is one row and its value is `"1"` (YES), `"0"` (NO) or `"-1"` (INVALID).

### `parseOutcomeResult(payload: Uint8Array): OutcomeResult`

Reads the result of an outcome action (ids 13-16) from a canonical attestation payload (without
the 65-byte signature). It mirrors the node's `parse_attestation_outcome`.

#### Returns
- `{ outcome: 1 | 0 | -1, actionId: number }`. `1` is YES, `0` is NO, and `-1` is INVALID: a
  capture taken at or after `timestamp + window` found no record, or, on id 13, the prior record
  is zero. The constants are exported as `OUTCOME_YES`, `OUTCOME_NO` and `OUTCOME_INVALID`.

#### Throws
- The action is not 13-16 (`unsupported action_id N`).
- The result does not hold exactly one data point.
- The value is not exactly `1e18`, `0` or `-1e18`.

```typescript
import { parseOutcomeResult, OUTCOME_INVALID } from "@trufnetwork/sdk-js";

const { outcome, actionId } = parseOutcomeResult(canonicalPayload);
if (outcome === OUTCOME_INVALID) {
  console.log(`action ${actionId}: INVALID, the market is refunded`);
}
```

### `isOutcomeAction(action: number | string): boolean`

`true` for the four outcome actions, by id (`OUTCOME_ACTION_IDS` = 13, 14, 15, 16) or by name
(`index_change_in_range_v2`, `price_above_threshold_v2`, `price_below_threshold_v2`,
`value_in_range_v2`). `isBinaryAction` stays `false` for them, because their result is a data
point and not an `abi.encode(bool)`.

### Attestation Result Format

Query results in attestations are ABI-encoded as:
```solidity
abi.encode(uint256[] timestamps, int256[] values)
```

Where:
- **timestamps**: Array of Unix timestamps (uint256)
- **values**: Array of 18-decimal fixed-point integers (int256)

Example decoded output:
```javascript
[
  { values: ["1704067200", "77.051806494788211665"] },
  { values: ["1704153600", "78.718654581755352351"] },
  // ...
]
```

### Complete Attestation Workflow

```typescript
// 1. Request attestation
const attestationAction = client.loadAttestationAction();
const result = await attestationAction.requestAttestation({
  dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
  streamId: "stai0000000000000000000000000000",
  actionName: "get_record",
  args: [...],
  encryptSig: false,
  maxFee: 1000000,
});

// 2. Wait for transaction confirmation
await client.waitForTx(result.requestTxId);

// 3. Poll for signature (validators sign asynchronously)
let signedAttestation;
for (let i = 0; i < 15; i++) {
  try {
    signedAttestation = await attestationAction.getSignedAttestation({
      requestTxId: result.requestTxId,
    });
    if (signedAttestation.payload.length > 65) break;
  } catch (e) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// 4. Parse and verify
const canonicalPayload = signedAttestation.payload.slice(0, -65);
const signature = signedAttestation.payload.slice(-65);

const digest = sha256(canonicalPayload);
const validatorAddress = recoverAddress(digest, {
  r: "0x" + Buffer.from(signature.slice(0, 32)).toString("hex"),
  s: "0x" + Buffer.from(signature.slice(32, 64)).toString("hex"),
  v: signature[64],
});

const parsed = parseAttestationPayload(canonicalPayload);

// 5. Use the verified data
console.log(`✅ Verified by: ${validatorAddress}`);
parsed.result.forEach(row => {
  console.log(`Data: ${row.values}`);
});
```

## Bridge Operations

The SDK provides methods for interacting with bridge instances on TN, enabling token transfers between TN and supported blockchain networks.

### Understanding Bridge Identifiers

Bridge instances on TN are identified by specific names that may differ from network names. Always use the **bridge identifier** when calling bridge methods, not the network name.

#### Mainnet vs testnet identifiers

| Identifier | Network | Token | Decimals | Notes |
|---|---|---|---|---|
| `eth_truf` | mainnet | TRUF | 18 | Used for protocol fees (stream write, attestation, market creation) |
| `eth_usdc` | mainnet | USDC | 6 | Used for prediction-market collateral |
| `ethereum_bridge` | mainnet | TRUF | 18 | Legacy — replaced by `eth_truf` |
| `hoodi_tt` | testnet | TRUF (test) | 18 | Hoodi testnet |
| `hoodi_tt2` | testnet | USDC (test) | 18 | Hoodi testnet — prediction-market collateral |
| `sepolia_bridge` | testnet | TRUF (test) | 18 | Sepolia testnet, deprecated |

Examples below use testnet identifiers; substitute the mainnet equivalent for production. Order-book actions (`createMarket`, `placeBuyOrder`, etc.) accept `"eth_usdc"` or `"eth_truf"` as the `bridge` field on mainnet.

### `client.getWalletBalance(bridgeIdentifier: string, walletAddress: string): Promise<string>`

Gets the wallet balance for a specific bridge instance.

#### Parameters
- `bridgeIdentifier: string` - Bridge instance identifier (e.g., `"sepolia"`, `"hoodi_tt"`, `"ethereum"`)
- `walletAddress: string` - Ethereum address to check balance for

#### Returns
- `Promise<string>` - Balance in wei as a string (to handle large numbers safely)

#### Example
```typescript
// Simple case - identifier matches network name
const sepoliaBalance = await client.getWalletBalance("sepolia", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
console.log(`Balance: ${sepoliaBalance} wei`);

// Multi-token bridge - specify bridge instance explicitly
const hoodiBalance = await client.getWalletBalance("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");

// Convert wei to human-readable format
import { formatEther } from 'ethers';
const balanceInTokens = formatEther(hoodiBalance);
console.log(`Balance: ${balanceInTokens} tokens`);
```

### `client.getOrderedBalances(options: OrderedBalancesOptions): Promise<TokenBalance[]>`

Gets a token's wallet balances in balance order — a "richlist". Where `getWalletBalance` reads one
wallet on one bridge, this ranks every holder of a token and returns the top (or bottom) slice.

#### Parameters
- `options.token: "TRUF" | "USDC"` - Which token's balance ledger to rank
- `options.ascending?: boolean` - Smallest balance first. Defaults to `false` (largest first)
- `options.limit?: number` - How many wallets to return. Defaults to `20`, and the node clamps it to a maximum of **50** — asking for more returns 50 rather than failing
- `options.minBalance?: string` - Only include wallets at or above this balance, in token base units. Defaults to no threshold

#### Returns
- `Promise<TokenBalance[]>` - Matching wallets ordered by balance, each `{ address, balance }`. `address` is 0x-prefixed lowercase hex; `balance` is in token base units (18 decimals for TRUF, 6 for USDC), as a string.

Returns an empty array when no wallet clears the threshold — that is a legitimate result, not an error. An unsupported token throws.

> **Balances are strings, and converting them to `number` loses data.** A real mainnet TRUF balance
> such as `685701000000000000000000` has 24 digits, well past `Number.MAX_SAFE_INTEGER` (~9.0e15).
> Use `BigInt` for arithmetic and `formatUnits` for display.

#### Example
```typescript
// The 10 largest TRUF holders
const top = await client.getOrderedBalances({ token: "TRUF", limit: 10 });
for (const { address, balance } of top) {
  console.log(`${address}: ${balance}`);
}

// The smallest USDC holders still holding at least 1 USDC (6 decimals)
const small = await client.getOrderedBalances({
  token: "USDC",
  ascending: true,
  limit: 5,
  minBalance: "1000000",
});

// Comparing or summing balances — use BigInt, never Number
const total = top.reduce((sum, r) => sum + BigInt(r.balance), 0n);

// Display in human-readable units
import { formatUnits } from 'ethers';
console.log(`Top holder: ${formatUnits(top[0].balance, 18)} TRUF`);
```

### `client.withdraw(bridgeIdentifier: string, amount: string, recipient: string): Promise<string>`

Initiates a withdrawal by bridging tokens from TN to a destination chain. This is a convenience method that calls `bridgeTokens` and waits for transaction confirmation.

#### Parameters
- `bridgeIdentifier: string` - Bridge instance identifier (e.g., `"sepolia"`, `"hoodi_tt"`)
- `amount: string` - Amount to withdraw in wei (as string to preserve precision)
- `recipient: string` - Recipient address on the destination chain

#### Returns
- `Promise<string>` - Transaction hash of the withdrawal

#### Example
```typescript
import { parseEther } from 'ethers';

// Withdraw 100 tokens to Sepolia
const amount = parseEther("100"); // Convert to wei
const txHash = await client.withdraw("sepolia", amount.toString(), "0x742d35Cc...");

console.log(`Withdrawal initiated: ${txHash}`);

// For non-custodial bridges (like Hoodi), you must claim the withdrawal manually
// See getWithdrawalProof() for claiming process
```

**Important Notes:**
- **Non-custodial bridges** (Hoodi): You must manually claim withdrawals using `getWithdrawalProof()`
- **Wait time**: Withdrawals become claimable after the epoch period (typically 10 minutes)

### `client.transfer(bridgeIdentifier: string, recipient: string, amount: string): Promise<string>`

Sends tokens from the caller to another in-network wallet via the bridge's public transfer action. Binds to the on-chain action `<bridgeIdentifier>_transfer` — `eth_truf_transfer` / `eth_usdc_transfer` on mainnet, `ethereum_transfer` / `sepolia_transfer` on dev/test.

The caller pays a **1-token action fee** on top of `amount`, denominated in the same token as the bridge (1 TRUF for `eth_truf`, 1 USDC for `eth_usdc`). The action reverts if the caller balance is below `amount + 1 token`.

#### Parameters
- `bridgeIdentifier: string` — Bridge / action namespace prefix (e.g. `"eth_truf"`, `"eth_usdc"`, `"sepolia"`).
- `recipient: string` — Destination wallet address (Ethereum 0x… format).
- `amount: string` — Transfer amount in wei (as string to preserve precision).

#### Returns
- `Promise<string>` — Transaction hash of the transfer.

#### Example — Refill bot pattern
```typescript
import { parseEther } from "ethers";

// Top up an adapter wallet; budget an extra 1 TRUF for the action fee.
const txHash = await client.transfer(
  "eth_truf",
  "0xAdapterWallet...",
  parseEther("100").toString(), // 100 TRUF
);
console.log(`Refill TX Hash: ${txHash}`);
```

### `client.getWithdrawalProof(bridgeIdentifier: string, walletAddress: string): Promise<WithdrawalProof[]>`

Gets withdrawal proofs for claiming withdrawals on non-custodial bridges. Returns merkle proofs and validator signatures needed for submitting claims to the destination chain contract.

#### Parameters
- `bridgeIdentifier: string` - Bridge instance identifier (e.g., `"hoodi_tt"`)
- `walletAddress: string` - Wallet address to get withdrawal proofs for

#### Returns
- `Promise<WithdrawalProof[]>` - Array of withdrawal proofs (empty array if no unclaimed withdrawals)

#### WithdrawalProof Type
```typescript
interface WithdrawalProof {
  chain: string;           // Source chain name (e.g., "hoodi")
  chain_id: string;        // Numeric chain ID (e.g., "560048")
  contract: string;        // Bridge contract address on destination chain
  created_at: number;      // Block number when withdrawal was created
  recipient: string;       // Recipient wallet address
  amount: string;          // Withdrawal amount in wei
  block_hash: string;      // Kwil block hash (base64-encoded)
  root: string;            // Merkle root (base64-encoded)
  proofs: string[];        // Merkle proofs (base64-encoded, usually empty)
  signatures: string[];    // Validator signatures (base64-encoded, 65 bytes each)
}
```

#### Example - Check for Claimable Withdrawals
```typescript
// Check for claimable withdrawals
const proofs = await client.getWithdrawalProof("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");

if (proofs.length === 0) {
  console.log("No withdrawals ready to claim");
} else {
  console.log(`${proofs.length} withdrawal(s) ready to claim`);

  for (const proof of proofs) {
    console.log(`Amount: ${proof.amount} wei`);
    console.log(`Recipient: ${proof.recipient}`);
    console.log(`Contract: ${proof.contract}`);
  }
}
```

#### Example - Claim Withdrawal On-Chain
```typescript
import { Contract, ethers } from 'ethers';

// 1. Get withdrawal proof from TN
const proofs = await client.getWithdrawalProof("hoodi_tt", walletAddress);
if (proofs.length === 0) {
  throw new Error("No withdrawals to claim");
}

const proof = proofs[0];

// 2. Decode base64 data for smart contract call
const blockHash = Buffer.from(proof.block_hash, 'base64');
const root = Buffer.from(proof.root, 'base64');
const merkleProofs = proof.proofs.map(p => Buffer.from(p, 'base64'));

// 3. Split signatures into v, r, s components
const signatures = proof.signatures.map(sig => {
  const sigBytes = Buffer.from(sig, 'base64');
  return {
    v: sigBytes[64],
    r: '0x' + sigBytes.slice(0, 32).toString('hex'),
    s: '0x' + sigBytes.slice(32, 64).toString('hex')
  };
});

// 4. Call bridge contract to claim withdrawal
const bridgeContract = new Contract(proof.contract, BRIDGE_ABI, signer);

const tx = await bridgeContract.claimWithdrawal(
  proof.recipient,
  proof.amount,
  '0x' + blockHash.toString('hex'),
  '0x' + root.toString('hex'),
  merkleProofs.map(p => '0x' + p.toString('hex')),
  signatures.map(s => ({ v: s.v, r: s.r, s: s.s }))
);

await tx.wait();
console.log(`Withdrawal claimed! Tx: ${tx.hash}`);
```

### `client.getHistory(bridgeIdentifier: string, walletAddress: string, limit?: number, offset?: number): Promise<BridgeHistory[]>`
Retrieves the transaction history for a wallet on a specific bridge. This method is provided by the base action handler (`client.loadAction()`) and also exposed directly on the client instance (`client.getHistory(...)`) for convenience.

#### Parameters
- `bridgeIdentifier: string` - The unique identifier of the bridge (e.g., "hoodi_tt2")
- `walletAddress: string` - The wallet address to query
- `limit?: number` - Max number of records to return (optional, default 20)
- `offset?: number` - Number of records to skip (optional, default 0)

#### Returns
- `Promise<BridgeHistory[]>` - Array of history records

#### Example
```typescript
const history = await client.getHistory("hoodi_tt2", "0x...", 10, 0);

for (const rec of history) {
  console.log(`${rec.type} - Amount: ${rec.amount} - Status: ${rec.status}`);
}
```

#### `BridgeHistory` Type

```typescript
interface BridgeHistory {
  type: string;                // "deposit", "withdrawal", "transfer"
  amount: string;              // NUMERIC(78,0) as string
  from_address: string | null; // Sender address (hex)
  to_address: string;          // Recipient address (hex)
  internal_tx_hash: string | null; // Kwil TX hash (base64)
  external_tx_hash: string | null; // Ethereum TX hash (base64)
  status: string;              // "completed", "pending_epoch", "claimed"
  block_height: number;        // Kwil block height
  block_timestamp: number;     // Kwil block timestamp
  external_block_height: number | null; // Ethereum block height
}
```

### `action.listWalletRewards(bridgeIdentifier: string, wallet: string, withPending: boolean): Promise<any[]>`

Lists wallet rewards for a specific bridge instance. This is a low-level method that directly accesses the bridge extension namespace.

**⚠️ Deprecated**: Most users should use `getWithdrawalProof()` instead, which provides a higher-level interface.

#### Parameters
- `bridgeIdentifier: string` - Bridge instance identifier
- `wallet: string` - Wallet address to query
- `withPending: boolean` - Whether to include pending (not yet finalized) rewards

#### Returns
- `Promise<any[]>` - Array of reward records

#### Example
```typescript
const action = client.loadAction();
const rewards = await action.listWalletRewards("hoodi_tt", walletAddress, true);
console.log(`Found ${rewards.length} reward(s)`);
```

### Bridge Configuration Best Practices

When integrating bridge functionality in your application:

1. **Use bridge identifiers directly**:
```typescript
// Always use the exact bridge identifier
const balance = await client.getWalletBalance('hoodi_tt', address);
const sepoliaBalance = await client.getWalletBalance('sepolia', address);

// For multiple Hoodi bridges
const tt2Balance = await client.getWalletBalance('hoodi_tt2', address);
```

2. **Handle custodial vs non-custodial bridges differently**:
```typescript
const isCustodial = {
  ethereum: true,  // Auto-claimed
  sepolia: true,   // Auto-claimed
  hoodi_tt: false, // Manual claim required
};

if (isCustodial[bridgeId]) {
  console.log("Withdrawal will be automatically claimed");
} else {
  console.log("You must claim withdrawal manually using getWithdrawalProof()");
}
```

3. **Poll for withdrawal proofs** on non-custodial bridges:
```typescript
async function waitForClaimableWithdrawal(bridgeId: string, address: string, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const proofs = await client.getWithdrawalProof(bridgeId, address);
    if (proofs.length > 0) {
      return proofs[0];
    }
    // Wait 10 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error("Withdrawal not ready after 10 minutes");
}
```

## Order Book Operations

The Order Book API enables binary prediction markets on TRUF.NETWORK. Markets are automatically settled based on real-world data from trusted data providers.

### Loading the Order Book Action

```typescript
const orderbook = client.loadOrderbookAction();
```

### Market Operations

#### `orderbook.createMarket(input: CreateMarketInput): Promise<TxReceipt>`

Creates a new binary prediction market.

##### Parameters
- `input: Object`
  - `bridge: BridgeIdentifier` - Bridge for collateral (`"hoodi_tt2"`, `"sepolia_bridge"`, `"ethereum_bridge"`)
  - `queryComponents: Uint8Array` - ABI-encoded query tuple (use `encodeQueryComponents()`)
  - `settleTime: number` - Unix timestamp for market settlement
  - `maxSpread: number` - Maximum bid-ask spread (1-50 cents)
  - `minOrderSize: number` - Minimum order size

##### Example
```typescript
import { OrderbookAction } from "@trufnetwork/sdk-js";

const args = OrderbookAction.encodeActionArgs(
  dataProviderAddress,
  streamId,
  timestamp,
  "50000.00", // threshold
  frozenAt
);

const queryComponents = OrderbookAction.encodeQueryComponents(
  dataProviderAddress,
  streamId,
  "price_above_threshold",
  args
);

const result = await orderbook.createMarket({
  bridge: "hoodi_tt2",
  queryComponents,
  settleTime: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  maxSpread: 10,
  minOrderSize: 1,
});

await client.waitForTx(result.data!.tx_hash);
```

#### `orderbook.createPriceAboveThresholdMarket(input): Promise<TxReceipt>`

Convenience method for creating "price above threshold" markets.

```typescript
const result = await orderbook.createPriceAboveThresholdMarket({
  dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
  streamId: "stbtc0000000000000000000000000000",
  timestamp: Math.floor(Date.now() / 1000) + 3600,
  threshold: "50000.00",
  frozenAt: 0,
  bridge: "hoodi_tt2",
  settleTime: Math.floor(Date.now() / 1000) + 3600,
  maxSpread: 10,
  minOrderSize: 1,
});
```

#### `orderbook.createIndexChangeInRangeMarket(input): Promise<TxReceipt>`

Creates a market on how far a stream's index moved, rather than on the value it publishes:
*"will year-over-year inflation land between 2% and 3%?"*. A stream publishing an index level
of 335 is struck at `2`, not at `343`.

The bounds are in percent, measured against the stream's own value one `timeInterval` earlier,
and they are **half-open** — `[minChange, maxChange)`. A change landing exactly on a boundary
belongs to the bucket above it, so a set of buckets tiles the number line without two of them
settling YES.

```typescript
const observedAt = Math.floor(Date.now() / 1000) + 3600;

const result = await orderbook.createIndexChangeInRangeMarket({
  dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
  streamId: "stcpiyoy000000000000000000000000",
  timestamp: observedAt,
  timeInterval: 31536000, // look back one year
  minChange: "2",
  maxChange: "3",
  frozenAt: 0,
  bridge: "eth_usdc",
  settleTime: observedAt,
  maxSpread: 10,
  minOrderSize: 1,
});
```

Omit either bound (or pass `null`) to strike an **open tail**, which is how the outer two buckets
of a set are struck. Omitting both is rejected — that would be every outcome at once.

```typescript
// The three buckets of one set: below 2%, [2%, 3%), and 3% or more.
const buckets = [
  { minChange: null, maxChange: "2" },
  { minChange: "2", maxChange: "3" },
  { minChange: "3", maxChange: null },
];
```

`timestamp`, `timeInterval` and `baseTime` all go into the market's hash and cannot be changed
once it exists. `baseTime` is optional and, unlike `frozenAt`, has no `0` sentinel: omit it for
the stream's own default base date.

Bounds are rendered as the chain stores a `NUMERIC(36,18)`, so `"2"` and `"2.0"` produce the same
market. A bound with more than 18 decimal places, more than 18 integer digits, or a non-zero
magnitude below `1e-6` is rejected rather than silently rounded or reformatted.

> Requires node migration 055. On a network without it, the market is created but can never be
> attested.

### Outcome Markets (v2)

The v2 outcome actions always settle. A capture taken at or after `timestamp + window` that finds
no record answers **INVALID**, and the market is refunded, so it never hangs waiting for a print.
The rule applies when the capture is taken: a record written after the deadline but before the
first capture still decides the market.

| id | Action | Helper | YES when |
|----|--------|--------|----------|
| 14 | `price_above_threshold_v2` | `createPriceAboveThresholdV2Market` | value > `threshold` |
| 15 | `price_below_threshold_v2` | `createPriceBelowThresholdV2Market` | value < `threshold` |
| 16 | `value_in_range_v2` | `createValueInRangeV2Market` | `minValue` <= value < `maxValue` |
| 13 | `index_change_in_range_v2` | `createIndexChangeInRangeV2Market` | `minChange` <= % change < `maxChange` |

Every helper takes `dataProvider`, `streamId`, `timestamp`, `window` and `tolerance`, plus the
market fields `bridge`, `settleTime`, `maxSpread` and `minOrderSize`. There is no `frozenAt`.

- `timestamp` is the moment the market asks about, in unix seconds.
- `tolerance` is how far from `timestamp` a record may sit and still count. Ids 14-16 read the
  latest record in `[timestamp - tolerance, timestamp]`. Id 13 reads the first record in
  `[timestamp, timestamp + tolerance]`, and compares it with the record nearest
  `current - timeInterval`, also within `tolerance`.
- `window` is how long after `timestamp` a capture waits for that record. Before
  `timestamp + window`, a capture that finds no record fails and is taken again later. From then
  on, it answers INVALID. On id 13, a prior record of zero answers INVALID without waiting for
  the deadline, because the change is undefined.
- On ids 13 and 16, leave a bound unset (or `null`) for an open tail. Leaving both unset is
  rejected.

```typescript
// A daily ladder: every band on value_in_range_v2, the outer two open.
const strikes = ["4.04", "4.33", "4.62", "4.92"];
const bands = [null, ...strikes].map((min, i) => [min, strikes[i] ?? null]);
for (const [minValue, maxValue] of bands) {
  await orderbook.createValueInRangeV2Market({
    dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
    streamId: "stmsft00000000000000000000000000",
    timestamp: 1767225600,  // the market's reference time
    window: 259200,
    tolerance: 86400,
    minValue,
    maxValue,
    bridge: "eth_usdc",
    settleTime: 1767484800,
    maxSpread: 10,
    minOrderSize: 1000000,
  });
}

// CPI year over year for the month starting 1 Jan 2026.
await orderbook.createIndexChangeInRangeV2Market({
  dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
  streamId: "stcpi0000000000000000000000000us",
  timestamp: 1767225600,  // data month start
  window: 7776000,
  tolerance: 172800,
  timeInterval: 31536000,
  minChange: "2",
  maxChange: "3",
  bridge: "eth_usdc",
  settleTime: 1775001600,
  maxSpread: 10,
  minOrderSize: 1000000,
});
```

#### Defaults

| Market | `timestamp` | `tolerance` | `window` | `timeInterval` |
|--------|-------------|-------------|----------|----------------|
| Month-start series (CPI, PCE) on id 13 | the data month start | 172800 (2 days) | 7776000 (90 days) | 31536000 |
| Daily ladder on ids 14-16 | the market's reference time | 86400 (1 day) | 259200 (3 days) | |
| EPS level market on ids 14-16 | after the stamp (the settle time) | 1728000 (20 days) | 1728000 (20 days) | |

Strike a ladder with `value_in_range_v2` for every band, the outer two with an open tail. A top band
on `price_above_threshold_v2` is strict, so a value exactly on its strike would pay no band.

#### Bounds

The helpers check exactly what the node checks, and nothing more:

- `0 <= timestamp`
- `0 < window <= 315360000` (`OUTCOME_MAX_SPAN_SECONDS`, 10 years)
- `0 <= tolerance <= 3888000` (`OUTCOME_MAX_TOLERANCE_SECONDS`, 45 days)
- `window >= tolerance`
- id 13: `0 < timeInterval <= 315360000` and `2 * tolerance < timeInterval`
- `threshold` is required on ids 14 and 15. On ids 13 and 16 the bounds cannot both be open, and
  `min < max` when both are set.

The node also refuses a `timestamp` more than 10 years past the block time, and a composed stream:
the v2 actions read primitive streams only.

Thresholds and bounds are plain decimal strings (`"2"`, `"-0.5"`). They are rendered as sdk-go
renders a `NUMERIC(36,18)`. A value with more than 18 decimal places or more than 18 integer
digits is rejected rather than rounded.

#### Same market from every SDK

The args are encoded byte for byte as sdk-go encodes them: INT8 for the time fields, Go's
`NUMERIC(36,18)` rendering, Go's NULL for an open tail, and the data provider lowercased. The same
question therefore has the same market hash whether it was created from JavaScript, Go or Python.
Creating it twice fails with "Market already exists" instead of opening a duplicate. The v1
encoders are unchanged.

To build the bytes without sending a transaction, use
`buildPriceAboveThresholdV2QueryComponents`, `buildPriceBelowThresholdV2QueryComponents`,
`buildValueInRangeV2QueryComponents` and `buildIndexChangeInRangeV2QueryComponents`, which take the
same fields as the helpers. For the args alone, use `encodePriceThresholdV2ActionArgs`,
`encodeValueInRangeV2ActionArgs` and `encodeIndexChangeV2ActionArgs`.

> Requires node v2.6.8 (migration 063).

#### `orderbook.getMarketInfo(queryId: number): Promise<MarketInfo>`

Gets detailed information about a market. Returns `MarketInfo` object containing `queryComponents` bytes.

```typescript
const market = await orderbook.getMarketInfo(queryId);
console.log(`Settle Time: ${new Date(market.settleTime * 1000)}`);
```

`winningOutcome` is `true` for YES and `false` for NO. It is `null` while the market is unsettled,
and also when the market settled with no result. Use `isMarketRefunded(market)` to tell those
apart. It returns `true` when `settled` is `true` and `winningOutcome` is `null`. A refunded market
paid every YES and NO share 50¢, returned open bids at their locked price, and took no fee.

```typescript
import { isMarketRefunded } from "@trufnetwork/sdk-js";

if (isMarketRefunded(market)) {
  console.log("Refunded: no result");
} else if (market.settled) {
  console.log(market.winningOutcome ? "YES" : "NO");
}
```

#### `decodeMarketData(encoded: string | Uint8Array): MarketData`

Decodes the `queryComponents` field from a `MarketInfo` object into high-level structured data.

#### Example
```typescript
import { decodeMarketData } from "@trufnetwork/sdk-js";

const market = await orderbook.getMarketInfo(123);
const details = decodeMarketData(market.queryComponents);

console.log(`Type: ${details.type}`);             // e.g. "above"
console.log(`Thresholds: ${details.thresholds}`); // e.g. ["100000.0"]
```

#### `MarketData` Interface
```typescript
interface MarketData {
  dataProvider: string;
  streamId: string;
  actionId: string;
  type: "above" | "below" | "between" | "equals" | "change_between" | "range" | "unknown";
  thresholds: string[]; // Formatted numeric values as strings
  timestamp: number | null;    // The point in the stream the query observes
  frozenAt: number | null;     // Block height the data is pinned to; null = latest (always null for v2)
  baseTime: number | null;     // v1 "change_between" only; null = the stream's default base
  timeInterval: number | null; // "change_between" only, in seconds, e.g. 31536000 for YoY
  window: number | null;       // v2 only: seconds after timestamp until no record answers INVALID
  tolerance: number | null;    // v2 only: seconds from timestamp a record may sit and still count
}
```

`thresholds` holds one entry per strike slot the action declares, in order. A `"change_between"`
or `"range"` market may strike an open tail, which reads back as an **empty string in place** rather
than as a shorter array — so `["", "2.000000000000000000"]` is "below 2%", and dropping the empty entry
would slide the surviving bound into the wrong slot and turn it into "2% or more".

The v2 outcome actions decode as follows. `actionId` keeps the action name, and `window` and
`tolerance` are set, so a v2 market is easy to tell from a v1 one.

| Action | `type` | `thresholds` | Other fields |
|--------|--------|--------------|--------------|
| `price_above_threshold_v2` | `"above"` | `[threshold]` | `timestamp`, `window`, `tolerance` |
| `price_below_threshold_v2` | `"below"` | `[threshold]` | `timestamp`, `window`, `tolerance` |
| `value_in_range_v2` | `"range"` | `[min, max]`, `""` for an open tail | `timestamp`, `window`, `tolerance` |
| `index_change_in_range_v2` | `"change_between"` | `[min, max]`, `""` for an open tail | `timestamp`, `window`, `tolerance`, `timeInterval` |

`"range"` is half-open `[min, max)` in the stream's own units. The v1 `"between"` is closed at both
ends and never open.

#### `orderbook.listMarkets(input?: ListMarketsInput): Promise<MarketSummary[]>`

Lists markets with optional filtering.

```typescript
// Get all settled markets
const markets = await orderbook.listMarkets({
  settledFilter: true, // true=settled, false=active, null=all
  limit: 100,
  offset: 0,
});
```

`settledFilter: true` includes refunded markets. Filter them with `isMarketRefunded`.

#### `orderbook.validateMarketCollateral(queryId: number): Promise<MarketValidation>`

Validates market collateral integrity (YES/NO token parity and vault balance).

```typescript
const validation = await orderbook.validateMarketCollateral(queryId);
console.log(`Valid: ${validation.validCollateral}`);
console.log(`Total YES: ${validation.totalTrue}`);
console.log(`Total NO: ${validation.totalFalse}`);
```

### Order Operations

#### `orderbook.placeBuyOrder(input: PlaceOrderInput): Promise<TxReceipt>`

Places a buy order for shares. Locks collateral: `amount x price x 10^16 wei`.

```typescript
await orderbook.placeBuyOrder({
  queryId: market.id,
  outcome: true,  // true=YES, false=NO
  price: 55,      // 55 cents
  amount: 100,    // 100 shares
});
```

#### `orderbook.placeSellOrder(input: PlaceOrderInput): Promise<TxReceipt>`

Places a sell order for owned shares.

```typescript
await orderbook.placeSellOrder({
  queryId: market.id,
  outcome: true,
  price: 60,
  amount: 50,
});
```

#### `orderbook.placeSplitLimitOrder(input: PlaceSplitLimitOrderInput): Promise<TxReceipt>`

Places a split limit order for market making. Atomically:
1. Locks collateral ($1.00 per pair)
2. Mints a YES/NO share pair
3. Keeps YES shares as holdings
4. Places NO shares as a sell order at `(100 - truePrice)` cents

```typescript
// Create 100 pairs: YES holdings + NO sell orders at 45c
await orderbook.placeSplitLimitOrder({
  queryId: market.id,
  truePrice: 55,  // YES at 55c, NO at 45c
  amount: 100,
});
```

#### `orderbook.cancelOrder(input: CancelOrderInput): Promise<TxReceipt>`

Cancels an open order (cannot cancel holdings where price=0).

```typescript
await orderbook.cancelOrder({
  queryId: market.id,
  outcome: true,
  price: 55, // Price of order to cancel
});
```

### Query Operations

#### `orderbook.getOrderBook(queryId: number, outcome: boolean): Promise<OrderBookEntry[]>`

Gets the order book for a market outcome.

```typescript
const yesOrders = await orderbook.getOrderBook(queryId, true);
for (const order of yesOrders) {
  const type = order.price < 0 ? "BUY" : order.price > 0 ? "SELL" : "HOLDING";
  console.log(`${type}: ${order.amount} shares at ${Math.abs(order.price)}c`);
}
```

#### `orderbook.getBestPrices(queryId: number, outcome: boolean): Promise<BestPrices>`

Gets the best bid and ask prices for an outcome.

```typescript
const prices = await orderbook.getBestPrices(queryId, true);
console.log(`YES: Bid=${prices.bestBid}c, Ask=${prices.bestAsk}c, Spread=${prices.spread}c`);
```

#### `orderbook.getMarketDepth(queryId: number, outcome: boolean): Promise<DepthLevel[]>`

Gets aggregated volume at each price level.

```typescript
const depth = await orderbook.getMarketDepth(queryId, true);
for (const level of depth) {
  console.log(`${level.price}c: ${level.totalAmount} shares`);
}
```

#### `orderbook.getFullMarketDepth(queryId: number): Promise<FullDepthLevel[]>`

Gets aggregated volume at each price level for **both** outcomes, from one read.

Same aggregation as `getMarketDepth`, for the whole market instead of one
outcome, with each level tagged by the outcome it rests on. Rows arrive YES first
then NO, price ascending within each.

One statement means one snapshot. Anything comparing the two outcomes to each
other wants this rather than two `getMarketDepth` calls, because between two
calls an order can land on one side and not the other. `getMarketDepth` is
unchanged and stays the right call when you want one outcome — a depth chart, a
market-making bot quoting one side.

```typescript
const depth = await orderbook.getFullMarketDepth(queryId);
for (const level of depth) {
  const side = level.outcome ? "YES" : "NO";
  console.log(`${side} ${level.price}c: ${level.buyVolume} buy, ${level.sellVolume} sell`);
}
```

#### `orderbook.getConsolidatedOrderBook(queryId: number, outcome?: boolean): Promise<ConsolidatedOrderBook>`

Gets one outcome's book with the opposite outcome's quotes folded in, so you see
every quote the chain will actually fill.

The two books of a binary market are two views of one position. A resting SELL NO
at 93c is a standing **bid** for YES at 7c: a trader hits it by **selling** YES,
both sides sell, and the matching engine burns the share pair. In the YES frame:

```text
consolidated bids = YES bids + (100 - p for every NO ask)
consolidated asks = YES asks + (100 - p for every NO bid)
```

The sides swap: a NO ask arrives as a YES bid. `outcome` defaults to `true`, and
the NO-framed book is the YES-framed book reflected. Costs one
`getFullMarketDepth` read, so both sides are one snapshot of the chain and
`isCrossed` describes a state the book was really in. This used to take two
`getMarketDepth` calls, where an order landing between them could make the
stitched ladder read as crossed when neither height was. Requires a node carrying
`get_full_market_depth`.

```typescript
const book = await orderbook.getConsolidatedOrderBook(queryId);
for (const level of book.asks) {
  console.log(`${level.price}c: ${level.total} shares (${level.native} direct, ${level.inverse} mint)`);
}
if (book.isCrossed) console.log("best bid is at or above best ask");
```

**This is not a sweepable ladder.** A direct same-outcome match crosses prices,
but mint and burn fire only when the two prices sum to exactly 100. So one order
fills every native level past its limit plus exactly **one** inverse level.
Walking these levels the way you would walk `getMarketDepth` quotes fills the
chain will not produce, which is why each level keeps `native` and `inverse`
separate rather than only their sum.

A consolidated book can also sit crossed indefinitely: a YES bid at 61 against a
NO bid at 45 shows a bid at 61 over an ask at 55, and 61 + 45 is not 100 so
nothing matches. Render it rather than treating it as bad data.

#### `reflectConsolidatedBook(book: ConsolidatedOrderBook): ConsolidatedOrderBook`

Returns the same market in the opposite outcome's frame, with no second chain
read.

Both outcome views come from one `getFullMarketDepth` response, so the opposite
view is an exact reflection rather than new information: prices complement to
100, bids and asks swap, and native and inverse volume swap with them, because a
resting order belongs to the other outcome once the frame flips.

```typescript
import { reflectConsolidatedBook } from "@trufnetwork/sdk-js";

const yes = await orderbook.getConsolidatedOrderBook(queryId, true);
const no = reflectConsolidatedBook(yes);
```

Anything rendering both outcomes wants this rather than a second
`getConsolidatedOrderBook` call. It halves the round trips, and it removes the
chance of stitching two different moments of the chain into one view.

#### `quoteConsolidatedBuy(levels, shares)` / `quoteConsolidatedSell(levels, shares)`

Answers what an order of a given size will actually do against a consolidated
ladder, so no caller has to re-derive the matching rules.

```typescript
import { quoteConsolidatedBuy } from "@trufnetwork/sdk-js";

const book = await orderbook.getConsolidatedOrderBook(queryId);
const quote = quoteConsolidatedBuy(book.asks, 700);

console.log(`submit ${quote.limitPrice}c for ${quote.filledShares} shares, $${quote.estimatedTotalCost}`);
for (const fill of quote.fills) {
  console.log(`  ${fill.shares} @ ${fill.price}c by ${fill.path}`);
}
```

Pass `book.asks` to buy and `book.bids` to sell. Three things the returned quote
makes explicit, each of which a hand-rolled ladder walk gets wrong:

- **`availableShares` is not the ladder's total.** It is the most any single
  order can take, which is smaller whenever inverse volume rests at more than one
  price. A ladder summing to 350 can cap one order at 200.
- **Fillable size is not monotonic in the limit price.** Raising the limit can
  lose the inverse level the fill was counting on, so the model evaluates every
  candidate price instead of walking down the ladder.
- **A sell pays its limit on every share.** A direct match pays the seller the
  ask price and refunds the buyer the difference, so crediting each resting bid
  its own price overstates any sell reaching past one level.

`fills` carries each leg's `path` — `"direct"`, `"mint"` or `"burn"` — for
callers that want to show how the order settles.

Each leg also carries two prices, and they are not the same thing. `price` is
what a share on that leg pays or receives; `levelPrice` is the ladder level the
liquidity rested at. They agree on every buy leg. They diverge on a sell, where
a direct match pays the seller the submitted limit rather than each resting
bid's own price, so one order can take three bids and be paid the same on all
three. Anything rendering which levels an order consumed wants `levelPrice`;
anything totalling money wants `price`.

**Choosing the limit is the caller's policy, not the SDK's.** These two apply one
reasonable default: the limit that fills the most, cheapest for a buy and highest
for a sell. A caller wanting a price ceiling, the least market impact, or a price
something downstream already settled on uses `quoteConsolidatedBuyAtPrice(levels,
shares, limit)` or `quoteConsolidatedSellAtPrice(levels, shares, limit)` instead.

A limit only counts if an order could carry it: a whole cent from 1 through 99,
which is what the node accepts. `isSubmittablePrice` is that check. The model
never chooses a limit that fails it, and the `AtPrice` variants quote nothing
when handed one — `availableShares` is still filled in, so a zero fill beside a
non-zero `availableShares` says the limit was the problem rather than the book.

The quote assumes the order reaches the front of the queue at its price. Matching
is FIFO within a level, so an older order resting at the same price takes the
counterparty first and the real fill comes up short.

#### `orderbook.getUserPositions(): Promise<UserPosition[]>`

Gets the caller's positions across all markets.

```typescript
const positions = await orderbook.getUserPositions();
for (const pos of positions) {
  const type = pos.price === 0 ? "HOLDING" : pos.price < 0 ? "BUY" : "SELL";
  console.log(`Market ${pos.queryId}: ${pos.outcome ? "YES" : "NO"} ${type} ${pos.amount}`);
}
```

#### `orderbook.getUserCollateral(): Promise<UserCollateral>`

Gets the caller's total locked collateral.

```typescript
const collateral = await orderbook.getUserCollateral();
console.log(`Total Locked: ${collateral.totalLocked} wei`);
console.log(`Buy Orders: ${collateral.buyOrdersLocked} wei`);
console.log(`Shares Value: ${collateral.sharesValue} wei`);
```

### Market Activity

`getMarketDepth` and the other book reads answer what is resting right now.
`getMarketActivity` answers how much traded: filled volume and unique traders
for one order book over a time window.

#### `orderbook.getMarketActivity(queryId: number, fromTs: number, toTs: number): Promise<MarketActivity>`

**Parameters:**
- `queryId`: the market to read.
- `fromTs`: window start, unix seconds, inclusive.
- `toTs`: window end, unix seconds, inclusive. A window that ends before it
  starts is rejected rather than read as empty.

Calls the node action `get_market_activity($query_id, $from_ts, $to_ts)` (node
migration `058-order-book-market-activity.sql`), which holds the one definition
of volume, so every SDK reads the same figures. Requires a node carrying that
action. A market that does not exist is an error: `Market not found: <queryId>`.

**Returns** `MarketActivity`:

| Field | Type | Meaning |
|---|---|---|
| `bridge` | `string` | The collateral token the figures are in |
| `volumeCents` | `string` | Filled volume in cents, `NUMERIC(78,0)` as a decimal string |
| `directCents` | `string` | The part of `volumeCents` from counterparty matches |
| `mintBurnCents` | `string` | The part of `volumeCents` from mint and burn matches |
| `uniqueTraders` | `number` | Distinct participants on either side of a fill |
| `fillCount` | `number` | Fills, one per trade |
| `directFillCount` | `number` | The part of `fillCount` that were counterparty matches |
| `sharesTraded` | `number` | Shares across those fills |
| `firstEventTs` | `number \| null` | First fill inside the window, `null` when nothing traded |
| `lastEventTs` | `number \| null` | Last fill inside the window, `null` when nothing traded |
| `coverageFromBlock` | `number` | Earliest block whose order events the node still holds |
| `coverageComplete` | `boolean` | False when the market is older than `coverageFromBlock` |

The three cents fields are strings because `NUMERIC(78,0)` can exceed
`Number.MAX_SAFE_INTEGER`. Use `BigInt` to do arithmetic on them.

Volume counts each trade once. A direct match counts its buy side at
`price * amount`, and a mint or burn counts its YES side at `100 * amount`.
Splits, placements, cancels, amends and settlement are not volume.
`volumeCents` always equals `directCents + mintBurnCents`, and `directFillCount`
never exceeds `fillCount`.

```typescript
const now = Math.floor(Date.now() / 1000);
const activity = await orderbook.getMarketActivity(782, now - 7 * 86400, now);
if (activity.fillCount === 0 && !activity.coverageComplete) {
  console.log("no fills retained; the node may have trimmed them");
}
console.log(
  `${activity.volumeCents} cents of ${activity.bridge} across ` +
    `${activity.fillCount} fills by ${activity.uniqueTraders} traders`
);
```

**Volume is per bridge.** It is in cents of the market's own collateral. Base
units differ between collateral tokens by orders of magnitude, so never add
volumes from markets on different bridges. Unique traders do compare across
bridges.

**A zero can be truncation.** The node trims order events once they are indexed
and keeps a rolling window. When `coverageComplete` is false, the market was
created before the earliest block the node still holds, so fills may be missing
and a zero says nothing about activity. It is also false on a node that holds no
order events at all.

**A call costs what its window holds.** The node indexes order events by market
and time, so a short window reads only the events inside it.

### Market Forecasting

Prediction markets price **ranges**, not values. A five-bucket EPS market says
"34% chance EPS lands between $2.06 and $2.21"; it never says "EPS will be
$2.14". These helpers invert that, collapsing the order books across every
bucket of one market into the single number they collectively imply.

```text
market says                     ->  forecast says
"34% between 2.06 and 2.21"         "2.14, p10..p90 1.91..2.35"
```

This is the same algorithm as `sdk-py`'s `get_market_forecast`, and the two are
verified to produce the same numbers.

#### `orderbook.getMarketForecast(queryIds: number[]): Promise<MarketForecast | null>`

Collapses a market's bucket books into the single value they imply.

**Parameters:**
- `queryIds: number[]` — The bucket query_ids of **one** market. Order does not
  matter; they are sorted by bound internally. See *Finding a market's
  queryIds* below.

**Returns:** A `MarketForecast`, or `null` when no bucket has a usable quote.

**Throws:** if fewer than two query_ids are given, if any is repeated, if they
do not all belong to the same market, or if a market is missing the
`queryComponents` needed to derive its bounds.

**v2 outcome markets include the INVALID refund.** A v2 outcome market (action
ids 13-16) pays $0.50 per YES and per NO share when it settles INVALID, so a
bucket's YES price is about P(YES) + 0.5 × P(INVALID). The forecast prices each
bucket from its full YES and NO books, weighted by committed notional, and a NO
price read as YES (1 minus the NO price) carries the same refund share. It
normalises those bucket prices, so for a v2 set the returned probabilities include
that refund value and are not a distribution over valid outcomes only. Such a
forecast carries this warning, exported as `OUTCOME_REFUND_WARNING`:

```text
v2 outcome markets: each YES price includes the $0.50 per share an INVALID result pays, so these probabilities include that refund value and are not a distribution over valid outcomes only
```

One forecast covers the buckets of **one** market. A repeated query_id would
have its bucket counted twice, and mixing two markets would normalise unrelated
probabilities into a single distribution — both are rejected rather than warned
about. Buckets of one market differ only in their strike, so the identity
compared is `(dataProvider, streamId, bridge, settleTime, timestamp, frozenAt,
baseTime, timeInterval, window, tolerance)` — the bridge included because an
identical question collateralised two ways is two markets with two separate
books. `window` and `tolerance` are null for v1 markets, so a v1 set and a v2
set on the same timestamp are two markets, as are two v2 sets with a different
window or tolerance.

**Cost:** two order-book reads plus one market-info read per bucket. Both the
YES and NO books are fetched, because on this venue a resting BUY NO at *p* is
hittable by a BUY YES at *100-p* (mint match), so NO liquidity is executable
YES liquidity and ignoring it would discard real quotes.

```typescript
const forecast = await orderbook.getMarketForecast([419, 420, 421, 422, 423]);
if (forecast) {
  console.log(forecast.value.toFixed(4)); // 2.1362

  // p10/p90 are null when the market has too few strikes to place them.
  const band =
    forecast.p10 !== null && forecast.p90 !== null
      ? `${forecast.p10.toFixed(4)}..${forecast.p90.toFixed(4)}`
      : "unresolved";
  console.log(band); // 1.9100..2.3500

  for (const bucket of forecast.buckets) {
    console.log(`  ${bucket.lower}-${bucket.upper}: ${(bucket.probability * 100).toFixed(1)}%`);
  }
  for (const warning of forecast.warnings) {
    console.log(`  ! ${warning}`);
  }
}
```

#### `MarketForecast`

| Field | Type | Meaning |
|-------|------|---------|
| `value` | `number` | The point estimate: the **median** of the implied distribution |
| `p10`, `p90` | `number \| null` | The published band. When both ends are interior, the market implies an 80% chance the outcome lands inside it; an end flagged `"tail"` is the outer strike, and the band then holds less than 80% |
| `marginOfError` | `number` | Half the P10..P90 band. **Not** a standard error — see below |
| `sigma` | `number` | The band scaled to a normal-equivalent standard deviation |
| `valueBasis` | `ForecastBasis` | `"interior"`, `"tail"`, or `"unresolved"` — see below |
| `p10Basis`, `p90Basis` | `ForecastBasis` | Same flags, for each end of the band |
| `method` | `ForecastMethod` | `"rank"` normally, `"discrete"` on a degenerate book |
| `buckets` | `BucketEstimate[]` | Per-bucket detail |
| `warnings` | `string[]` | Book-quality problems worth surfacing |
| `multimodal`, `nPeaks` | `boolean`, `number` | Whether the book implies more than one peak |
| `low`, `high` | `number` | `value -/+ marginOfError`. Either can fall past the outer strikes, for example when `valueBasis` is `"tail"`, so `p10` and `p90` are the ones to show |

Each `BucketEstimate` carries `queryId`, `lower`, `upper`, `probability`
(normalised, sums to 1), `rawProbability`, `confidence`, `oneSided` and
`quoted`. `forecastToJSON(forecast)` gives a flat, JSON-serialisable form.

**`marginOfError` is a band, not a precision.** It is half the P10..P90 spread,
so it describes how uncertain the **outcome** is, not how tightly the book pins
your estimate. Expect it to be large — on a live five-bucket EPS market, roughly
0.22 against a value of 2.14. Publishing it as "± 0.22" is correct; reading it
as "our estimate is accurate to 0.22" is not. The margin is 0 when `p10` and
`p90` both sit at the same outer strike (both flagged `"tail"`), which means the
book puts nearly all its mass past that strike, not that the value is certain.

**Check the `Basis` flags before displaying a number.** The outer two buckets are
open-ended, so the books say nothing about how far out they extend. When a
percentile falls inside one, the number is the outer strike; the value lies at
or beyond it, and the corresponding flag reads `"tail"`. `"interior"` means it
was read between real strikes with no shape assumption. `"unresolved"` means the
market has too few strikes to place it at all.

**Read `warnings`.** Unquoted or one-sided buckets, crossed books, and
dutch-book deviations are reported rather than silently smoothed over. A v2 set
also carries `OUTCOME_REFUND_WARNING` (see above).

#### Finding a market's queryIds

Each bucket is a **separate market** with its own query_id, so a "market" is a
set of them. They can be reassembled from chain data alone: buckets of the same
market share every field of the forecast identity above and differ only in their
strike, so group by that identity.

```typescript
import { decodeMarketData } from "@trufnetwork/sdk-js";

const groups = new Map<string, number[]>();
for (const summary of await orderbook.listMarkets({ settledFilter: false, limit: 100 })) {
  const info = await orderbook.getMarketInfo(summary.id);
  // Legacy markets carry no query_components and cannot be decoded.
  if (!info.queryComponents || info.queryComponents.length === 0) continue;
  const marketData = decodeMarketData(info.queryComponents);
  // The full forecast identity. window and tolerance are null for v1, so a v1
  // set and a v2 set on the same stream and settle time land in different groups.
  const key = [
    marketData.dataProvider, marketData.streamId, info.bridge, summary.settleTime,
    marketData.timestamp, marketData.frozenAt, marketData.baseTime,
    marketData.timeInterval, marketData.window, marketData.tolerance,
  ].join("@");
  groups.set(key, [...(groups.get(key) ?? []), summary.id]);
}

// A complete v1 market tiles the line: one "below" bucket, one "above", ranges
// between. A v2 ladder strikes every band on value_in_range_v2 ("range"), with
// the outer two open. A stream can also carry a market that is not part of a
// bucket set at all, so skip anything too small to forecast rather than letting
// it throw.
for (const [, queryIds] of groups) {
  if (queryIds.length < 2) continue;
  const forecast = await orderbook.getMarketForecast(queryIds);
}
```

A layout that does not tile the line is still estimated, with the problem
reported in `warnings` rather than thrown.

#### Forecasting from your own book data

If you already hold the books, the algorithm is available as pure functions with
no I/O. `forecastFromDepth` is the preferred entry point; it consolidates the
YES and NO ladders itself.

```typescript
import {
  forecastFromDepth,
  forecastFromBuckets,
  type BucketDepth,
  type BucketBook,
} from "@trufnetwork/sdk-js";

// Full ladders. Prices are positive 1-99 cents on every side.
const buckets: BucketDepth[] = [
  {
    lower: null,                          // null = open-ended outer bucket
    upper: 1.91,
    yesBids: [{ price: 4, size: 386 }],
    yesAsks: [],
    noBids: [{ price: 83, size: 25 }],
    noAsks: [{ price: 97, size: 6 }],
    queryId: 419,
  },
  // ... remaining buckets, ascending
];
const forecast = forecastFromDepth(buckets);

// Or, if you only have top-of-book (no consolidation, weaker estimate):
const fromQuotes = forecastFromBuckets([
  { lower: null, upper: 1.91, bestBid: 4, bestAsk: 17, queryId: 419 },
  // ...
] as BucketBook[]);
```

A complete market spans the whole line, with the first bucket open below
(`lower: null`) and the last open above (`upper: null`). That is what the
algorithm is designed for, but it is not enforced: an interior-only or gapped
set still returns a forecast, with the problem reported in `warnings`. The mass
beyond an unrepresented tail simply has nowhere to go, so treat those results
accordingly.

These functions see prices, not action ids, so they never add
`OUTCOME_REFUND_WARNING`. Books from v2 outcome markets still carry the INVALID
refund in their YES prices.

`bucketBoundsFromMarketData(marketData)` converts the output of
`decodeMarketData` into a `{ lower, upper }` pair, handling the `below`,
`between`, `above`, `equals`, `range` and `change_between` market types. Either
side is `null` when that tail is open.

Note the units differ: `change_between` bounds are in percent, against the
stream's value one `timeInterval` earlier, where the other types are in the
stream's own units. Comparing bounds across market types is the caller's
responsibility.

### Settlement Operations

#### `orderbook.settleMarket(queryId: number): Promise<TxReceipt>`

Settles a market after settlement time has passed.

```typescript
const result = await orderbook.settleMarket(queryId);
await client.waitForTx(result.data!.tx_hash);
```

A v2 outcome market settles **INVALID** when its capture answers INVALID, for example when a
capture taken at or after `timestamp + window` finds no record (see
[Outcome Markets (v2)](#outcome-markets-v2)). `settled` becomes `true` and `winningOutcome` stays
`null` (see `isMarketRefunded`). Every YES and NO share, held or listed, is paid 50¢, and open bids
are refunded at their locked price (`amount * |price| / 100` dollars). No fee is taken, and nothing
goes to LPs, the data provider or validators, so `getDistributionSummary` throws "No distribution
found" for that market.

### Price Representation

Prices are represented as integers in cents (1-99):
- A YES price of 60 means 60 cents, implying 60% probability
- The complementary NO price is always `100 - YES_price`

### Order Types

| Price Value | Type | Description |
|------------|------|-------------|
| -99 to -1 | Buy Order | Bid to buy at \|price\| cents |
| 0 | Holding | Shares owned (not listed) |
| 1 to 99 | Sell Order | Ask to sell at price cents |

### Static Helper Methods

```typescript
// Encode action arguments for query components
const args = OrderbookAction.encodeActionArgs(
  dataProvider,  // Ethereum address
  streamId,      // 32-char stream ID
  timestamp,     // Unix timestamp
  threshold,     // Price threshold (e.g., "50000.00")
  frozenAt       // Block height for data snapshot
);

// Encode full query components
const queryComponents = OrderbookAction.encodeQueryComponents(
  dataProvider,
  streamId,
  actionId,      // e.g., "price_above_threshold"
  args
);
```

## Local (Off-Chain) Stream Actions

`LocalActions` talks to the node's admin JSON-RPC server (default port
`8485`) instead of the gateway. Local streams live off-chain on a single
node: no consensus broadcast, no transaction fees, implicitly owned by the
node operator. The server derives `data_provider` from the node's
secp256k1 key — clients never supply it on the wire.

Admin operations are Node.js only; `loadLocalActions` does not exist on
`BrowserTNClient`.

Use `LocalActions` when the data should stay on one node (private
primitive data, composed streams that compose local children, node-operator
tooling). Use `NodeTNClient` for anything that needs consensus (cross-node
reads, role management, bridge operations).

### Construction

Three equivalent entry points:

```typescript
import {
  AdminClient,
  LocalActions,
  NodeTNClient,
} from "@trufnetwork/sdk-js";

// 1. Standalone — no NodeTNClient, no wallet, no chain id.
const local = new LocalActions(
  new AdminClient({ adminProvider: "http://127.0.0.1:8485" }),
);

// 2. Standalone + operator-key signing (required on
//    require_signature = true nodes).
const signed = new LocalActions(
  new AdminClient({ adminProvider: "http://127.0.0.1:8485" }),
  { signer: process.env.OPERATOR_KEY },
);

// 3. Share the admin transport with a full NodeTNClient app.
const client = new NodeTNClient({ /* endpoint, chainId, signer */ });
const viaClient = client.loadLocalActions(
  { adminProvider: "http://127.0.0.1:8485" },
  { signer: process.env.OPERATOR_KEY },
);
```

#### `LocalActionsOptions`

- `signer?: string` — Operator secp256k1 key (hex, with or without the
  `0x` prefix). **Required** when the target node has
  `[extensions.tn_local] require_signature = true`. When set, every call
  carries a server-recoverable `_auth` envelope (`sig`, `ts`, `ver`); the
  server rejects requests signed by any other key. Leave unset to talk to
  nodes with the flag off. Malformed hex is rejected at construction time.

Extract the autogenerated operator key from the dev container once:

```bash
export OPERATOR_KEY="$(docker exec tn-db cat /root/.kwild/nodekey.json | jq -r '.key')"
```

### API surface

Every method below accepts only business inputs — no `dataProvider` is
ever sent on the wire. Responses include `dataProvider` (server-derived,
always the node's own address, lowercased).

| Method | Purpose |
|---|---|
| `createStream({ streamId, streamType })` | Create a local primitive or composed stream. |
| `deleteStream({ streamId })` | Remove a local stream and all child rows (records, taxonomies). |
| `insertRecords({ streamId, eventTime, value })` | Append records. Parallel arrays: `streamId[i]` gets `(eventTime[i], value[i])`. |
| `insertTaxonomy({ streamId, childStreamIds, weights, startDate })` | Add a taxonomy group to a composed stream. |
| `disableTaxonomy({ streamId, groupSequence })` | Soft-delete a taxonomy group. |
| `getRecord({ streamId, fromTime?, toTime? })` | Query records (latest if both bounds unset). |
| `getIndex({ streamId, fromTime?, toTime?, baseTime? })` | Query the computed index series. |
| `listStreams()` | List every local stream on this node. |

### Auth behavior

- No `signer` + server `require_signature = false` → request goes through unsigned.
- No `signer` + server `require_signature = true` → server returns `tn_local: unauthenticated` with `reason: "missing _auth"`.
- Wrong `signer` + server `require_signature = true` → server returns `tn_local: unauthenticated` with `reason: "signer is not this node's operator"`.
- Operator `signer` + server `require_signature = true` → every `local.*` call succeeds; `dataProvider` is the operator address.

### Transport auth

The admin server has its own transport-level auth (unix socket, mTLS, or
`--admin.pass`) completely independent of `tn_local`'s
`require_signature`. Pick a transport that matches your trust model:
loopback TCP + `--admin.notls` is fine for on-host dev work but is **not**
equivalent to the default unix socket; any other process running as any
user on the host can still reach it. For production, use the unix socket,
mTLS, or `--admin.pass`. See
[`node/docs/development.md`](https://github.com/trufnetwork/node/blob/main/docs/development.md)
for the full matrix.

### Full example

A working script that creates a primitive stream, a composed stream with a
taxonomy, queries both, and demonstrates wrong-key rejection lives at
[`examples/local_actions_example/`](../examples/local_actions_example/).
Run it against either a flag-off or a flag-on node; its README walks
through both invocation shapes.

## Performance Recommendations
- Use batch record insertions
- Implement client-side caching
- Handle errors with specific catch blocks

## SDK Compatibility
- Minimum Node.js Version: 18.x