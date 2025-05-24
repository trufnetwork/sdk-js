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
const endpoint = process.env.TN_ENDPOINT || "https://gateway.mainnet.truf.network";
const chainId = process.env.CHAIN_ID || "tn-v2" || (await NodeTNClient.getDefaultChainId(endpoint));

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

## Reading from Existing Streams

You can read data from any public stream, such as the Truflation AI Index:

```typescript
// Create a stream locator for the AI Index
const aiIndexLocator = {
  streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
  dataProvider: EthereumAddress.fromString("0x4710a8d8f0d845da110086812a32de6d90d7ff5c").throw(),
};

// Load the action client
const stream = client.loadAction();

// Get the latest records
const records = await stream.getRecord({
  stream: aiIndexLocator,
});

console.log("AI Index records:", records);
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
- Check our [example scripts](../examples) for comprehensive examples

## Support

For support and issues, please visit our [GitHub repository](https://github.com/trufnetwork/sdk-js/issues).
