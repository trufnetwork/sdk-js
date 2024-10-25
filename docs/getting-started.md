# Getting Started with TSN SDK JS

## Prerequisites
- Node.js 18 or later

## Installation

```bash
npm install @truflation/tsn-sdk-js
# or
pnpm install @truflation/tsn-sdk-js
# or 
yarn add @truflation/tsn-sdk-js
```

## Quick Start

```typescript
import { NodeTSNClient, StreamId } from "@truflation/tsn-sdk-js";
import { Wallet } from "ethers";

// Initialize client
const wallet = new Wallet(privateKey);
const chainId = await NodeTSNClient.getDefaultChainId("https://staging.tsn.truflation.com");

const client = new NodeTSNClient({
  endpoint: "https://staging.tsn.truflation.com",
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Must implement signMessage (e.g. ethers Wallet)
  },
  chainId,
});

// Create and initialize a primitive stream
const streamId = await StreamId.generate("my-stream");
await client.deployStream(streamId, "primitive", true);

const stream = client.loadPrimitiveStream({
  streamId,
  dataProvider: client.address(),
});

await stream.initializeStream();

// Insert data
await stream.insertRecords([
  { dateValue: "2024-01-01", value: "100.5" }
]);

// Read data
const data = await stream.getRecord({
  dateFrom: "2024-01-01",
  dateTo: "2024-01-01"
});
```

## Environment-Specific Usage

The SDK provides optimized clients for different environments:

```typescript
// For Node.js
import { NodeTSNClient } from "@truflation/tsn-sdk-js";

// For browsers
import { BrowserTSNClient } from "@truflation/tsn-sdk-js"; 
```

## Next Steps

- Review [Core Concepts](./core-concepts.md) to understand streams and permissions
- See the [API Reference](./api-reference.md) for detailed method documentation
- Check our [integration tests](../tests/integration) for comprehensive examples

## Support

For support and issues, please visit our [GitHub repository](https://github.com/truflation/tsn-sdk-js/issues).
