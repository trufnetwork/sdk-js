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

### `client.deployStream(streamId: StreamId, type: StreamType): Promise<DeploymentResult>`
Deploys a new stream to the TRUF.NETWORK.

#### Parameters
- `streamId: StreamId` - Unique stream identifier
- `type: StreamType` - Stream type (Primitive or Composed)

#### Returns
- `Promise<DeploymentResult>`
  - `txHash: string` - Transaction hash
  - `streamLocator: StreamLocator` - Stream location details

#### Example
```typescript
const deploymentResult = await client.deployStream(
        marketIndexStreamId,
        StreamType.Composed
);
```

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

### `client.getHistory(bridgeIdentifier: string, walletAddress: string, limit?: number, offset?: number): Promise<BridgeHistory[]>`
Retrieves the transaction history for a wallet on a specific bridge. This method is provided by the base action handler and exposed directly on the client for convenience.

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
  to_address: string | null;   // Recipient address (hex)
  internal_tx_hash: string | null; // Kwil TX hash (base64)
  external_tx_hash: string | null; // Ethereum TX hash (base64)
  status: string;              // "completed", "pending_epoch", "claimed"
  block_height: number;        // Kwil block height
  block_timestamp: number;     // Kwil block timestamp
  external_block_height: number | null; // Ethereum block height
}
```

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
  - `mode: 'paid' | 'received' | 'both'` - Filter mode:
    - `'paid'` - Transactions where wallet paid fees
    - `'received'` - Transactions where wallet received fee distributions
    - `'both'` - All transactions involving the wallet
  - `limit?: number` - Maximum results to return (optional, default: 20, max: 1000)
  - `offset?: number` - Pagination offset (optional, default: 0)

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
const wallet = client.address;

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

**Note**: When used in attestation results (via `parseAttestationPayload`), each `DecodedRow` contains exactly two values: a Unix timestamp and a decimal value string.

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

Bridge instances on TN are identified by specific names that may differ from network names. For example:
- Network `"sepolia"` → Bridge identifier `"sepolia"` (matches)
- Network `"hoodi"` → Bridge identifier `"hoodi_tt"` (different due to multiple token support)

Always use the **bridge identifier** when calling bridge methods, not the network name.

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

#### `orderbook.getMarketInfo(queryId: number): Promise<MarketInfo>`

Gets detailed information about a market.

```typescript
const market = await orderbook.getMarketInfo(queryId);
console.log(`Settle Time: ${new Date(market.settleTime * 1000)}`);
console.log(`Settled: ${market.settled}`);
if (market.settled) {
  console.log(`Winner: ${market.winningOutcome ? "YES" : "NO"}`);
}
```

#### `orderbook.listMarkets(input?: ListMarketsInput): Promise<MarketSummary[]>`

Lists markets with optional filtering.

```typescript
// Get all unsettled markets
const markets = await orderbook.listMarkets({
  settledFilter: true, // true=unsettled, false=settled, null=all
  limit: 100,
  offset: 0,
});
```

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

### Settlement Operations

#### `orderbook.settleMarket(queryId: number): Promise<TxReceipt>`

Settles a market after settlement time has passed.

```typescript
const result = await orderbook.settleMarket(queryId);
await client.waitForTx(result.data!.tx_hash);
```

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

## Performance Recommendations
- Use batch record insertions
- Implement client-side caching
- Handle errors with specific catch blocks

## SDK Compatibility
- Minimum Node.js Version: 18.x