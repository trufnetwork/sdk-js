# TN SDK JS

The TN SDK provides developers with tools to interact with the [TRUF.NETWORK](https://truf.network/), a decentralized platform for publishing, composing, and consuming economic data streams.

## Core Concepts

TN supports two main types of streams:

- **Primitive Streams**: Direct data sources from providers.
- **Composed Streams**: Aggregate data from multiple streams using weights.

These streams form the basis of economic data flows on the TRUF.NETWORK, allowing for flexible and transparent data provision and consumption.

### What is a `streamID`?

A `streamID` is an identifier used in the TRUF.NETWORK (TN) to identify the deployed contract. It is a unique string generated from a descriptive name, such as an English name, to ensure easy reference and management of data streams.

For a deeper dive into these and other foundational concepts, please see our [Core Concepts documentation](./docs/core-concepts.md).

## Getting Started

This section will guide you through the initial setup and a basic client initialization. For a more detailed step-by-step tutorial, please refer to our [Getting Started Guide](./docs/getting-started.md).

### Prerequisites

- Node.js 18 or later (For enabling Explorer-related features, please use Node.js 18)
- A valid Ethereum private key

### Installation

```bash
npm install @trufnetwork/sdk-js
# or
yarn add @trufnetwork/sdk-js
# or
pnpm install @trufnetwork/sdk-js
```

### Basic Client Initialization

Here's a quick example of how to initialize the client for a Node.js environment. The initialized `client` and `wallet` instances can typically be reused for subsequent operations shown in later examples.

```ts
import { NodeTNClient } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Create a wallet.
const wallet = new Wallet("YOUR_PRIVATE_KEY");

// Initialize client for Node.js
const client = new NodeTNClient({
	// Use the mainnet gateway or your own local node endpoint
	endpoint: "https://gateway.mainnet.truf.network", // e.g., http://localhost:8484 for a local node
	signerInfo: {
		address: wallet.address,
		signer: wallet, // Any object that implements signMessage
	},
	chainId: "tn-v2", // or use NodeTNClient.getDefaultChainId(endpoint)
});
```

> **Note:** `YOUR_PRIVATE_KEY` is a placeholder. **Never hardcode private keys.** For Node.js, store it in a `.env` file (e.g., `PRIVATE_KEY="0xabc..."`) and use [`dotenv`](https://www.npmjs.com/package/dotenv) (`npm install dotenv`) to load it as `process.env.PRIVATE_KEY`. Your private key is essential for signing and authenticating requests.

### Client for Different Environments

Import the client relevant to your JavaScript environment:

```typescript
// For Node.js applications
import { NodeTNClient } from "@trufnetwork/sdk-js";

// For browser applications
import { BrowserTNClient } from "@trufnetwork/sdk-js";
```

For detailed configuration options for both clients, please see our [API Reference](./docs/api-reference.md).

## Usage Examples

Here is a common use case for the SDK. For a wider range of examples and advanced scenarios, please explore the [example scripts in this repository](./examples) and our [detailed API Reference](./docs/api-reference.md).

### Reading from a Stream

Assuming you have initialized `client` as shown in the [Basic Client Initialization](#basic-client-initialization) section, you can read from any public stream. The following example demonstrates how to read from AI Index.

```ts
import { StreamId, EthereumAddress } from "@trufnetwork/sdk-js";

// Create a stream locator for the AI Index
const aiIndexLocator = {
	streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
	dataProvider: EthereumAddress.fromString(
		"0x4710a8d8f0d845da110086812a32de6d90d7ff5c"
	).throw(),
};

// Load the action client
const streamAction = client.loadAction();

// Get the latest records
const records = await streamAction.getRecord({
	stream: aiIndexLocator,
});
```

> **Note:** For streams that you have deployed using the same wallet, you can use `client.ownStreamLocator(streamId)` as a convenient shorthand to create the stream locator. This is equivalent to specifying the `streamId` and your wallet's `dataProvider` address explicitly.

### Creating a Stream

You can create two types of streams in the TRUF.NETWORK: Primitive and Composed streams.

#### Creating a Primitive Stream

A primitive stream is a direct data source that allows you to insert individual records.

```typescript
// Generate a unique stream ID
const streamId = await StreamId.generate("my_first_stream");

// Deploy the primitive stream
const deployResult = await client.deployStream(
	streamId, 
	StreamType.Primitive
);

// Load the primitive action to insert records
const primitiveAction = client.loadPrimitiveAction();

// Insert a record
await primitiveAction.insertRecord({
	stream: client.ownStreamLocator(streamId),
	eventTime: Date.now(), // Unix timestamp
	value: "100.50" // Value as a string for precision
});
```

#### Creating a Composed Stream

A composed stream aggregates data from multiple primitive streams with configurable weights.

```typescript
// Generate stream IDs for parent and child streams
const parentStreamId = await StreamId.generate("composite_economic_index");
const childStream1Id = await StreamId.generate("child_stream_1");
const childStream2Id = await StreamId.generate("child_stream_2");

// Deploy the parent composed stream
await client.deployStream(
	parentStreamId, 
	StreamType.Composed
);

// Load the composed action to set taxonomy
const composedAction = client.loadComposedAction();

// Set stream taxonomy (how child streams are combined)
await composedAction.setTaxonomy({
	stream: client.ownStreamLocator(parentStreamId),
	taxonomyItems: [
		{
			childStream: client.ownStreamLocator(childStream1Id),
			weight: "0.6" // 60% weight
		},
		{
			childStream: client.ownStreamLocator(childStream2Id),
			weight: "0.4" // 40% weight
		}
	],
	startDate: Date.now() // When this taxonomy becomes effective
});
```

#### Stream Visibility and Permissions

You can control stream visibility and access permissions:

```typescript
// Set read visibility (public or private)
await streamAction.setReadVisibility(
	client.ownStreamLocator(streamId), 
	visibility.public // or visibility.private
);

// Allow specific wallets to read the stream
await streamAction.allowReadWallet(
	client.ownStreamLocator(streamId),
	EthereumAddress.fromString("0x1234...")
);
```

**Notes:**
- Stream IDs are generated deterministically from a descriptive string.
- Always use string values for numeric data to maintain precision.
- Weights in composed streams must sum to 1.0.
- Streams can be made public or private, with fine-grained access control.

### Explorer Interaction

To enable Explorer-related features, you need to set the `neonConnectionString` in the `NodeTNClient` constructor.
You can request the explorer write-only connection string by contacting us.

```ts
const wallet = new Wallet("YOUR_PRIVATE_KEY");

const client = new NodeTNClient({
	endpoint: "https://gateway.mainnet.truf.network",
	signerInfo: {
		address: wallet.address,
		signer: wallet,
	},
	chainId: "tn-v2",
	neonConnectionString: yourNeonConnectionString, // Add your connection string here
});
```

For more details on specific methods related to Explorer interactions, consult the [API Reference](./docs/api-reference.md).

### Using the SDK with Your Local Node

If you are running your own TRUF.NETWORK node, you can configure the SDK to interact with your local instance by changing the `endpoint` in the client configuration, as shown in the [Basic Client Initialization](#basic-client-initialization) section. This is useful for development, testing, or when operating within a private network.
For more detailed instructions, prerequisites, and examples, please see our [Using the SDK with Your Local Node Guide](./docs/local-node-guide.md).

## Deployment Considerations

### Running with Deno

This package works with Deno when using the `--allow-net` permission flag:

```ts
import { ... } from "npm:@trufnetwork/sdk-js"
```

#### Deno Environment Permissions

By default, some dependencies require environment permissions. If you need to run without environment permissions, please see [this GitHub issue](https://github.com/denoland/deno/issues/20898#issuecomment-2500396620) for potential workarounds.

**Need Immediate Deno Support?**
- Open an issue on our GitHub repository
- Reach out to our support team
- Provide details of your specific use case

## Serverless Deployment Notes

### Handling Crypto Hashing in Serverless Environments

When deploying to some serverless environments, Node.js modules like `crypto-hash` may encounter compatibility issues. To resolve this, you can create a shim for the
`crypto-hash` module and use
Webpack's `NormalModuleReplacementPlugin` to replace it during the build process.

##### 1. Create a Shim File

Add a new file named `crypto-hash-sync.js` to your project:

```javascript
import { createHash } from "crypto";

export const sha1 = (input) => createHash("sha1").update(input).digest("hex");
export const sha256 = (input) =>
	createHash("sha256").update(input).digest("hex");
export const sha384 = (input) =>
	createHash("sha384").update(input).digest("hex");
export const sha512 = (input) =>
	createHash("sha512").update(input).digest("hex");
```

##### 2. Update Your Bundler Configuration (Example: Webpack)

If you are using Webpack (common in Next.js or custom serverless setups), modify your configuration (e.g., `next.config.js` or `webpack.config.js`):

```javascript
const path = require("path");

module.exports = {
	// ... other configurations
	webpack: (config, { isServer, webpack }) => {
		// Add shim for crypto-hash
		config.plugins.push(
			new webpack.NormalModuleReplacementPlugin(
				/crypto-hash/,
				path.resolve(__dirname, "crypto-hash-sync.js")
			)
		);
		return config;
	},
	// ... other configurations
};
```

For other bundlers or serverless platforms, consult their documentation on module aliasing or replacement.

## Further Resources & Next Steps

To continue learning and building with the TN SDK, explore the following resources:

- **Tutorials & Guides**:
  - [Getting Started Guide](./docs/getting-started.md): A detailed walkthrough for setting up and making your first interactions with the SDK.
  - [Core Concepts Explained](./docs/core-concepts.md): Understand the fundamental building blocks of the TRUF.NETWORK and the SDK.
- **Detailed Documentation**:
  - [API Reference](./docs/api-reference.md): Comprehensive details on all SDK classes, methods, types, and parameters.
- **Examples & Demos**:
  - [Local Examples Directory](./examples)
- **Whitepaper**:
  - [Truflation Whitepaper](https://whitepaper.truflation.com)

## Mainnet Network

The mainnet network is available at: `https://gateway.mainnet.truf.network`

## Support

For support, please [open an issue](https://github.com/trufnetwork/sdk-js/issues) on our GitHub repository.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for details.
