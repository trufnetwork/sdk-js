# Core Concepts

## Stream Types

TN supports two types of streams:

- **Primitive Streams**: Single data source streams that store raw values
- **Composed Streams**: Aggregate multiple streams with configurable weights

```typescript
import { StreamType } from "@trufnetwork/sdk-js";

// Available stream types
StreamType.Primitive  // Single data source
StreamType.Composed   // Aggregates multiple streams with weights
```

For detailed information about stream types and their use cases, see the [API Reference](./api-reference.md).

## Error Handling

The SDK uses Either monad from monads-io for parsing addresses and stream IDs:

```typescript
// Safe address parsing
const addressResult = EthereumAddress.fromString("0x123...")
  .mapRight(addr => addr.getAddress())
  .mapLeft(error => handleError(error));

// Safe stream ID parsing  
const streamIdResult = StreamId.fromString("st123...")
  .mapRight(id => id.getId())
  .mapLeft(error => handleError(error));
```

## Stream Identification

Each stream is identified by two components:

```typescript
interface StreamLocator {
  streamId: StreamId;        // Unique stream identifier
  dataProvider: EthereumAddress;  // Stream owner's address
}

// Generate a deterministic stream ID
const streamId = await StreamId.generate("my-unique-name");
```

## Accessing Existing Streams

You can access existing streams on the network if they are public or you have permission:

```typescript
// Access the Truflation AI Index
const aiIndexLocator = {
  streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
  dataProvider: EthereumAddress.fromString("0x4710a8d8f0d845da110086812a32de6d90d7ff5c").throw(),
};

const stream = client.loadAction();
const records = await stream.getRecord({ stream: aiIndexLocator });
```

## Permissions Model

Streams support granular permissions for both reading and composing:

```typescript
import { visibility } from "@trufnetwork/sdk-js";

// Set visibility
await stream.setReadVisibility(streamLocator, visibility.private);
await stream.setComposeVisibility(streamLocator, visibility.public);

// Grant permissions
await stream.allowReadWallet(streamLocator, new EthereumAddress("0x..."));
await stream.allowComposeStream(streamLocator, otherStreamLocator);
```

## Transaction Handling

The SDK provides transaction monitoring with configurable timeouts:

```typescript
// Wait for transaction with custom timeout
await client.waitForTx(txHash, 15000); // 15 second timeout

// Default handling
const tx = await stream.insertRecords([{
  stream: streamLocator,
  eventTime: Math.floor(Date.now() / 1000),
  value: "100.5",
}]);

if (tx.data?.tx_hash) {
  await client.waitForTx(tx.data.tx_hash);
}
```

## Mainnet Network

The mainnet network is available at:
- Endpoint: `https://gateway.mainnet.truf.network`
- Chain ID: `tn-v2`

## Further Reading

- [Example Scripts](../examples) - Usage examples
- [API Reference](./api-reference.md) - Detailed SDK methods
- [monads-io Documentation](https://github.com/AlexXanderGrib/monads-io) - Error handling patterns
