# API Reference

For detailed information about TN concepts and operations, please refer to the [Js SDK Documentation](https://github.com/trufnetwork/sdk-js/blob/main/docs/api-reference.md).

## Client Initialization

```typescript
import { NodeTNClient, BrowserTNClient } from "@trufnetwork/sdk-js";

const client = new NodeTNClient({
  endpoint: "https://staging.tsn.truflation.com",
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Must implement signMessage (e.g. ethers Wallet)
  },
  chainId: "tsn-1",
});

// Get chain ID automatically
const chainId = await NodeTNClient.getDefaultChainId(endpoint);
```

## Stream Operations

### Base Stream Methods

```typescript
// Get stream type
const type = await stream.getType(); // Returns StreamType

// Get stream records
const records = await stream.getRecord({
  stream: streamLocator,
  from: new Date("2024-01-01").getTime() / 1000,
  to: new Date("2024-01-31").getTime() / 1000,
  frozenAt: 12345, // Optional block height
});

// Get stream index
const index = await stream.getIndex({
  stream: streamLocator,
  from: new Date("2024-01-01").getTime() / 1000,
  to: new Date("2024-01-31").getTime() / 1000,
  baseTime: new Date("2023-12-31").getTime() / 1000, // Optional
});

// Get first record
const firstRecord = await stream.getFirstRecord({
  stream: streamLocator,
  after: new Date("2024-01-01").getTime() / 1000,
  frozenAt: 12345,
}); // Returns StreamRecord | null

// Calculate year-over-year changes
const changes = await stream.getIndexChange({
  stream: streamLocator,
  from: new Date("2024-01-01").getTime() / 1000,
  to: new Date("2024-12-31").getTime() / 1000,
  timeInterval: 365 * 24 * 60 * 60,
  baseTime: new Date("2024-01-01").getTime() / 1000, // Optional
}); // Returns StreamRecord[]
```

### Primitive Stream Operations

```typescript
const primitiveStream = client.loadPrimitiveAction(streamLocator);

// Insert data
await primitiveStream.insertRecords([
  { stream: streamLocator, eventTime: new Date("2024-01-01").getTime() / 1000, value: "100.5" },
]);
```

### Composed Stream Operations

```typescript
const composedStream = client.loadComposedAction(streamLocator);

// Set stream weights
await composedStream.setTaxonomy({
  stream: streamLocator,
  taxonomyItems: [
    {
      childStream: childStreamLocator,
      weight: "1.5",
    },
  ],
  startDate: new Date("2024-01-01").getTime() / 1000, // Optional
});

// Get taxonomy
const taxonomy = await composedStream.describeTaxonomies({
  stream: streamLocator,
  $latestGroupSequence: true,
});
```

### Permission Management

```typescript
// Set visibility
await stream.setReadVisibility(streamLocator, visibility.private);
await stream.setComposeVisibility(streamLocator, visibility.public);

// Get visibility
const readVisibility = await stream.getReadVisibility(streamLocator); // Returns VisibilityEnum | null
const composeVisibility = await stream.getComposeVisibility(streamLocator);

// Manage permissions
await stream.allowReadWallet(new EthereumAddress("0x..."));
await stream.allowComposeStream(streamLocator, otherStreamLocator);

// Query permissions
const readers = await stream.getAllowedReadWallets(streamLocator);
const composers = await stream.getAllowedComposeStreams(streamLocator);
```

### Stream Management

```typescript
// Deploy new stream
await client.deployStream(streamId, StreamType.Primitive, true);

// Destroy stream
await client.destroyStream(streamLocator, true);

// List streams
const allStreams = await client.getAllStreams();
const ownerStreams = await client.getAllStreams(ownerAddress);
```

For comprehensive examples of these APIs in use, please check our [integration tests](../tests/integration).
