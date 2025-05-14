# API Reference

For detailed information about TN concepts and operations, please refer to the [Js SDK Documentation](https://github.com/trufnetwork/sdk-js/blob/main/docs/api-reference.md).

## Installation

```bash
npm install @trufnetwork/sdk-js
```

## Client Initialization

```typescript
import {
  NodeTNClient,
  StreamId,
  EthereumAddress,
} from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const endpoint = process.env.TN_ENDPOINT || "https://gateway.mainnet.truf.network";

// (Optional) Fetch default chain ID:
// const chainId = await NodeTNClient.getDefaultChainId(endpoint);

const wallet = new Wallet(process.env.PRIVATE_KEY!);

const client = new NodeTNClient({
  endpoint,
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Must implement signMessage
  },
  chainId: process.env.CHAIN_ID || "tn-v2",
  neonConnectionString: process.env.NEON_CONNECTION_STRING, // Optional, for explorer-related queries
  timeout: 30000, // Optional, default 10000 ms
});
```

## Example Usage

```typescript
// Fetch recent transactions
const lastTxs = await client.getLastTransactions({
  dataProvider: undefined, // or your wallet address
  limitSize: 6,
});
console.log("Last transactions:", lastTxs);
```

## Stream Operations

### Stream Locators

```typescript
import { StreamLocator } from "@trufnetwork/sdk-js";

const streamLocator: StreamLocator = {
  streamId: await StreamId.generate("my-stream"),
  dataProvider: EthereumAddress.fromString(wallet.address).throw(),
};
```

### Base Stream Methods

```typescript
// Load the generic Action client
const stream = client.loadAction();

// Get stream type
const type = await stream.getType(streamLocator);

// Get records within a time range, if from and to set to null, it will return latest record
const records = await stream.getRecord({
  stream: streamLocator,
  from: 1680307200,      // Unix timestamp (seconds)
  to: 1682899200,
  frozenAt: 12345,       // Optional block height
});

// Get index values within a time range, if from and to set to null, it will return latest index
const index = await stream.getIndex({
  stream: streamLocator,
  from: 1680307200,
  to: 1682899200,
  baseTime: 1703980800,  // Optional where the value considered as 100
});

// Get first record after a timestamp
const first = await stream.getFirstRecord({
  stream: streamLocator,
  after: 1680307200,
  frozenAt: 12345,
});

// Calculate year-over-year index changes
const changes = await stream.getIndexChange({
  stream: streamLocator,
  from: 1680307200,
  to: 1703980800,
  timeInterval: 365 * 24 * 60 * 60,
  baseTime: 1680307200,   // Optional
});
```

### Primitive Stream Operations

```typescript
// Load primitive-specific methods
const primitiveStream = client.loadPrimitiveAction();

// Insert new records
await primitiveStream.insertRecords([
  {
    stream: streamLocator,
    eventTime: 1680307200,
    value: "100.5",
  },
]);
```

### Composed Stream Operations

```typescript
// Load composed-specific methods
const composedStream = client.loadComposedAction();

// Set taxonomy weights
await composedStream.setTaxonomy({
  stream: streamLocator,
  taxonomyItems: [
    { childStream: childStreamLocator, weight: "1.5" },
  ],
  startDate: 1680307200,  // Optional
});

// Describe taxonomy configurations
const taxonomy = await composedStream.describeTaxonomies({
  stream: streamLocator,
  latestGroupSequence: true,
});
```

### Permission Management

```typescript
// Set visibility
await stream.setReadVisibility(streamLocator, visibility.private);
await stream.setComposeVisibility(streamLocator, visibility.public);

// Grant permissions
await stream.allowReadWallet(streamLocator, new EthereumAddress("0x..."));
await stream.allowComposeStream(streamLocator, otherStreamLocator);

// Query permissions
const readers = await stream.getAllowedReadWallets(streamLocator);
const composers = await stream.getAllowedComposeStreams(streamLocator);
```

### Stream Management

```typescript
// Deploy a new stream
await client.deployStream(streamLocator.streamId, StreamType.Primitive, true);

// Destroy an existing stream
await client.destroyStream(streamLocator, true);

// List streams
const all = await client.getListStreams({ dataProvider: undefined, limit: 100 });
const mine = await client.getListStreams({ dataProvider: wallet.address, limit: 100 });
```

For comprehensive examples, see the [integration tests](../tests/integration) and [example scripts](../examples).
