# Core Concepts

## Stream Types

TSN supports two types of streams:

- **Primitive Streams**: Single data source streams that store raw values
- **Composed Streams**: Aggregate multiple streams with configurable weights

```typescript
import { StreamType } from "@truflation/tsn-sdk-js";

// Available stream types
StreamType.Primitive  // Single data source
StreamType.Composed   // Aggregates multiple streams with weights
```

For detailed information about stream types and their use cases, see the [Go SDK Documentation](https://github.com/truflation/tsn-sdk/blob/main/docs/readme.md).

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

## Permissions Model

Streams support granular permissions for both reading and composing:

```typescript
import { visibility } from "@truflation/tsn-sdk-js";

// Set visibility
await stream.setReadVisibility(visibility.private);
await stream.setComposeVisibility(visibility.public);

// Grant specific permissions
await stream.allowReadWallet(new EthereumAddress("0x..."));
await stream.allowComposeStream(otherStreamLocator);
```

## Transaction Handling

The SDK provides transaction monitoring with configurable timeouts:

```typescript
// Wait for transaction with custom timeout
await client.waitForTx(txHash, 15000); // 15 second timeout

// Default handling
const tx = await stream.initializeStream();
if (tx.data?.tx_hash) {
  await client.waitForTx(tx.data.tx_hash);
}
```

## Further Reading

- [Integration Tests](../tests/integration) - Usage examples
- [Go SDK Documentation](https://github.com/truflation/tsn-sdk/blob/main/docs/readme.md) - Detailed TSN concepts
- [monads-io Documentation](https://github.com/AlexXanderGrib/monads-io) - Error handling patterns
