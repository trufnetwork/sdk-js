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
  - `eventTime: number` - Timestamp of the record
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
    eventTime: Date.now(),
    value: "150.25"
  },
  {
    stream: commodityStream,
    eventTime: Date.now(),
    value: "75.10"
  }
]);
```

## Stream Querying

### `streamAction.getRecord(input: GetRecordInput): Promise<StreamRecord[]>`
Retrieves the **raw numeric values** recorded in a stream for each timestamp.  For primitive streams this is a direct read of the stored events; for composed streams the engine performs an _on-the-fly_ aggregation of all underlying child streams using the active taxonomy and weights at each point in time.

The call is the foundation on which `getIndex` and `getIndexChange` are built—use it whenever you need the exact original numbers without any normalisation.

**Key behaviours**
1. **Time window** — `from` and `to` are inclusive UNIX-epoch seconds.
2. **LOCF gap-filling** — If no event exists exactly at `from`, the service automatically carries forward the last known value so that downstream analytics have a continuous series.
3. **Time-travel (`frozenAt`)** — Supply a block-height timestamp to query the database _as it looked in the past_ (i.e. ignore records created after that height).
4. **Access control** — Internally calls `is_allowed_to_read_all` ensuring the caller has permission to view every sub-stream referenced by a composed stream.
5. **Performance** — For large ranges prefer batching or add tighter `from` / `to` filters.

#### Parameters
- `input: Object`
  - `stream: StreamLocator` – Target stream (primitive **or** composed)
  - `from?: number` – Optional start timestamp (seconds). If omitted returns the latest value.
  - `to?: number` – Optional end timestamp (seconds). Must be ≥ `from`.
  - `frozenAt?: number` – Optional created-at cut-off for historical queries.
  - `baseTime?: number` – Ignored by `getRecord`; present only for signature compatibility with other helpers.

#### Example
```typescript
const records = await streamAction.getRecord({
  stream: marketIndexLocator,
  from: Date.now() - 86400000, // Last 24 hours
  to: Date.now()
});
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
  - `from?: number` – Optional start timestamp
  - `to?: number` – Optional end timestamp
  - `frozenAt?: number` – Optional timestamp for "time-travel" queries (records created at or before `frozenAt` only)
  - `baseTime?: number` – Reference timestamp used for normalisation. If omitted, the SDK will try, in order:
    1. `default_base_time` metadata on the stream
    2. The first available record in the stream

#### Returns
- `Promise<StreamRecord[]>` – Array of `{ eventTime: number, value: string }` representing indexed values.

#### Example
```typescript
const indexSeries = await streamAction.getIndex({
  stream: marketIndexLocator,
  from: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days
  to: Date.now(),
  baseTime: Date.now() - 365 * 24 * 60 * 60 * 1000 // One year ago
});
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
const yearlyChange = await streamAction.getIndexChange({
  stream: marketIndexLocator,
  from: Date.now() - 2 * 365 * 24 * 60 * 60 * 1000, // Last 2 years
  to: Date.now(),
  timeInterval: 31536000, // 1 year in seconds
  baseTime: null,
  frozenAt: null
});
console.log("Year-on-year % change", yearlyChange);
```

### `streamAction.customProcedureWithArgs(procedure: string, args: Record<string, ValueType | ValueType[]>): Promise<StreamRecord[]>`
Allows you to invoke any stored procedure defined in the underlying Kwil database and receive the results in `StreamRecord` format.  Use this when the built-in helpers (`getRecord`, `getIndex`, `getIndexChange`) don’t meet a specialised analytics need.

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
    { childStream: commodityStream, weight: "0.4" }
  ],
  startDate: Date.now()
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