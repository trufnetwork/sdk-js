# Getting Started with TN SDK JS

## Prerequisites

* Node.js 18 or later
* A valid Ethereum private key

## Installation

```bash
npm install @trufnetwork/sdk-js
# or
pnpm install @trufnetwork/sdk-js
# or 
yarn add @trufnetwork/sdk-js
```

## Quick Start

```typescript
import { Wallet } from "ethers";
import {
  NodeTNClient,
  StreamId,
  EthereumAddress,
} from "@trufnetwork/sdk-js";
import * as dotenv from "dotenv";

dotenv.config();

// Initialize wallet
const wallet = new Wallet(process.env.PRIVATE_KEY!);

// Prepare client options
const endpoint = process.env.TN_ENDPOINT!;
const chainId = process.env.CHAIN_ID || (await NodeTNClient.getDefaultChainId(endpoint));

// Initialize TN client
const client = new NodeTNClient({
  endpoint,
  signerInfo: {
    address: wallet.address,
    signer: wallet,
  },
  chainId,
});

// Generate a new stream ID
const streamId = await StreamId.generate("my-stream");

// Deploy a primitive stream synchronously
await client.deployStream(streamId, "primitive", true);

// Prepare stream locator
const streamLocator = {
  streamId,
  dataProvider: EthereumAddress.fromString(wallet.address).throw(),
};

// Load primitive action client
const primitiveStream = client.loadPrimitiveAction();

// Insert records
await primitiveStream.insertRecords([
  {
    stream: streamLocator,
    eventTime: Math.floor(new Date("2024-01-01").getTime() / 1000),
    value: "100.5",
  },
]);

// Read back records
const records = await primitiveStream.getRecord({
  stream: streamLocator,
  from: Math.floor(new Date("2024-01-01").getTime() / 1000),
  to: Math.floor(new Date("2024-01-01").getTime() / 1000),
});
console.log("Fetched records:", records);
```

## Environment-Specific Usage

The SDK provides optimized clients for different environments:

```typescript
// For Node.js
import { NodeTNClient } from "@trufnetwork/sdk-js";

// For browsers
import { BrowserTNClient } from "@trufnetwork/sdk-js"; 
```

## Next Steps

- Review [Core Concepts](./core-concepts.md) to understand streams and permissions
- See the [API Reference](./api-reference.md) for detailed method documentation
- Check our [integration tests](../tests/integration) for comprehensive examples

## Support

For support and issues, please visit our [GitHub repository](https://github.com/trufnetwork/sdk-js/issues).
