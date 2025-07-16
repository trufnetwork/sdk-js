# Getting Started with TN SDK JS

## Prerequisites

- Node.js 18 or later
- A valid Ethereum private key

## Installation

```bash
npm install @trufnetwork/sdk-js
# or
pnpm install @trufnetwork/sdk-js
# or
yarn add @trufnetwork/sdk-js
```

## Quick Start

### Mainnet Configuration

```typescript
import { Wallet } from "ethers";
import {
	NodeTNClient,
	StreamId,
	EthereumAddress,
	StreamType,
} from "@trufnetwork/sdk-js";
import * as dotenv from "dotenv";

dotenv.config();

// Initialize wallet
const wallet = new Wallet(process.env.PRIVATE_KEY!);

// Mainnet configuration
const endpoint = "https://gateway.mainnet.truf.network";
const chainId = "tn-v2";

// Initialize TN client
const client = new NodeTNClient({
	endpoint,
	signerInfo: {
		address: wallet.address,
		signer: wallet,
	},
	chainId,
});
```

### Local Node Configuration

```typescript
// Local node configuration
const localEndpoint = "http://localhost:8484";

const localClient = new NodeTNClient({
	endpoint: localEndpoint,
	signerInfo: {
		address: wallet.address,
		signer: wallet,
	},
	chainId: "", // Local node might use empty chainId
});
```

### Stream Creation and Management

```typescript
// Generate a new stream ID
const streamId = await StreamId.generate("my-stream");

// Deploy a primitive stream
const deployTx = await client.deployStream(streamId, StreamType.Primitive);
await client.waitForTx(deployTx.data.tx_hash);

// Prepare stream locator
const streamLocator = {
	streamId,
	dataProvider: EthereumAddress.fromString(wallet.address).throw(),
};

// Load primitive action client
const primitiveStream = client.loadPrimitiveAction();

// Insert records
const insertTx = await primitiveStream.insertRecords([
	{
		stream: streamLocator,
		eventTime: Math.floor(new Date("2024-01-01").getTime() / 1000),
		value: "100.5",
	},
]);
await client.waitForTx(insertTx.data.tx_hash);

// Read back records
const { data: records } = await primitiveStream.getRecord(
	streamLocator,
	{
		from: Math.floor(new Date("2024-01-01").getTime() / 1000),
		to: Math.floor(new Date("2024-01-01").getTime() / 1000),
	}
);
console.log("Fetched records:", records);
```

### Composed Stream Example

```typescript
// Create a composed stream
const composedStreamId = await StreamId.generate("market_index");
await client.deployStream(composedStreamId, StreamType.Composed);

const composedAction = client.loadComposedAction();
await composedAction.setTaxonomy({
	stream: client.ownStreamLocator(composedStreamId),
	taxonomyItems: [
		{
			childStream: stockPriceStream,
			weight: "0.6", // 60% weight
		},
		{
			childStream: commodityPriceStream,
			weight: "0.4", // 40% weight
		},
	],
	startDate: Math.floor(Date.now() / 1000),
});
```

## Reading from Existing Streams

You can read data from any public stream, such as the Truflation AI Index:

```typescript
// Create a stream locator for the AI Index
const aiIndexLocator = {
	streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
	dataProvider: EthereumAddress.fromString(
		"0x4710a8d8f0d845da110086812a32de6d90d7ff5c"
	).throw(),
};

// Load the action client
const stream = client.loadAction();

// Get the latest records
const { data: records } = await stream.getRecord(aiIndexLocator);

console.log("AI Index records:", records);
```

### Using the cache (optional)

Need faster reads? Pass `useCache: true` and inspect the extra metadata:

```typescript
const { data: cachedRecords, cache } = await stream.getRecord(
	aiIndexLocator,
	{ useCache: true }
);

if (cache?.hit) {
	console.log('Served from cache at', new Date(cache.cachedAt! * 1000));
}
```

## Error Handling

```typescript
try {
	const deployTx = await client.deployStream(streamId, StreamType.Primitive);
	await client.waitForTx(deployTx.data.tx_hash);
} catch (error) {
	console.error("Stream deployment failed:", error);
}
```

## Environment-Specific Usage

The SDK provides optimized clients for different environments:

```typescript
// For Node.js
import { NodeTNClient } from "@trufnetwork/sdk-js";

// For browsers
import { BrowserTNClient } from "@trufnetwork/sdk-js";
```

## Local Node Considerations

- Ensure your local node is fully synchronized
- Use `http://localhost:8484` as the default endpoint
- The `chainId` might be an empty string
- Verify network connectivity before querying

## Next Steps

- Review [Core Concepts](./core-concepts.md) to understand streams and permissions
- See the [API Reference](./api-reference.md) for detailed method documentation
- Check our [example scripts](../examples) for comprehensive examples
- Explore [Local Node Guide](./local-node-guide.md) for node-specific configurations

## Support

For support and issues, please visit our [GitHub repository](https://github.com/trufnetwork/sdk-js/issues).
