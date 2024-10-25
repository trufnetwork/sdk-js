# API Reference

For detailed information about TSN concepts and operations, please refer to the [Go SDK Documentation](https://github.com/truflation/tsn-sdk/blob/main/docs/readme.md).

## Client Initialization

```typescript
import { NodeTSNClient, BrowserTSNClient } from "@truflation/tsn-sdk-js";

const client = new NodeTSNClient({
  endpoint: "https://staging.tsn.truflation.com",
  signerInfo: {
    address: wallet.address,
    signer: wallet,  // Must implement signMessage (e.g. ethers Wallet)
  },
  chainId: "tsn-1",
});

// Get chain ID automatically
const chainId = await NodeTSNClient.getDefaultChainId(endpoint);
```

## Stream Operations

### Base Stream Methods

```typescript
// Get stream type
const type = await stream.getType(); // Returns StreamType

// Get stream records
const records = await stream.getRecord({
  dateFrom: "2024-01-01",
  dateTo: "2024-01-31",
  frozenAt: 12345  // Optional block height
});

// Get stream index
const index = await stream.getIndex({
  dateFrom: "2024-01-01", 
  dateTo: "2024-01-31",
  baseDate: "2023-12-31"
});

// Get first record
const firstRecord = await stream.getFirstRecord({
  afterDate: "2024-01-01",
  frozenAt: 12345
}); // Returns StreamRecord | null
```

### Primitive Stream Operations

```typescript
const primitiveStream = client.loadPrimitiveStream(streamLocator);

// Insert data
await primitiveStream.insertRecords([
  { dateValue: "2024-01-01", value: "100.5" }
]);
```

### Composed Stream Operations

```typescript
const composedStream = client.loadComposedStream(streamLocator);

// Set stream weights
await composedStream.setTaxonomy({
  taxonomyItems: [
    {
      childStream: childStreamLocator,
      weight: "1.5"
    }
  ],
  startDate: "2024-01-01" // Optional
});

// Get taxonomy
const taxonomy = await composedStream.describeTaxonomies({
  latestVersion: true
});
```

### Permission Management

```typescript
// Set visibility
await stream.setReadVisibility(visibility.private);
await stream.setComposeVisibility(visibility.public);

// Get visibility
const readVisibility = await stream.getReadVisibility(); // Returns VisibilityEnum | null
const composeVisibility = await stream.getComposeVisibility();

// Manage permissions
await stream.allowReadWallet(new EthereumAddress("0x..."));
await stream.allowComposeStream(otherStreamLocator);

// Query permissions
const readers = await stream.getAllowedReadWallets();
const composers = await stream.getAllowedComposeStreams();
```

### Stream Management

```typescript
// Deploy new stream
await client.deployStream(streamId, StreamType.Primitive, true);

// Initialize stream
await stream.initializeStream();

// Destroy stream
await client.destroyStream(streamId, true);

// List streams
const allStreams = await client.getAllStreams();
const ownerStreams = await client.getAllStreams(ownerAddress);
```


For comprehensive examples of these APIs in use, please check our [integration tests](../tests/integration).
