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
Retrieves records from a stream with advanced filtering.

#### Parameters
- `input: Object`
  - `stream: StreamLocator` - Target stream
  - `from?: number` - Optional start timestamp
  - `to?: number` - Optional end timestamp
  - `frozenAt?: number` - Optional timestamp for frozen state
  - `baseTime?: number` - Optional base time for relative queries

#### Example
```typescript
const records = await streamAction.getRecord({
  stream: marketIndexLocator,
  from: Date.now() - 86400000, // Last 24 hours
  to: Date.now()
});
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