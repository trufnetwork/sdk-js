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
    chainId: 'tn-v2' // Or left empty for local nodes
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

### `composedAction.getTaxonomiesForStreams(params: GetTaxonomiesForStreamsParams): Promise<TaxonomyQueryResult[]>`
Batch fetches taxonomies for specific streams. Useful for validating taxonomy data for known streams or processing multiple streams efficiently.

#### Parameters
- `params: Object` - Query parameters (required)
  - `streams: StreamLocator[]` - Array of stream locators to query
  - `latestOnly?: boolean` - If true, returns only latest group_sequence per stream. Default: false

#### Returns
- `Promise<TaxonomyQueryResult[]>` - Array of taxonomy entries (same format as `listTaxonomiesByHeight`)

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

## Transaction Handling

### `client.waitForTx(txHash: string, timeout?: number): Promise<TransactionReceipt>`
Waits for transaction confirmation with optional timeout.

#### Parameters
- `txHash: string` - Transaction hash
- `timeout?: number` - Maximum wait time in milliseconds

#### Example
```typescript
const txReceipt = await client.waitForTx(txHash, 30000);
```

## Performance Recommendations
- Use batch record insertions
- Implement client-side caching
- Handle errors with specific catch blocks

## SDK Compatibility
- Minimum Node.js Version: 18.x