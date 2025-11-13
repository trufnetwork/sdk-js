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
	chainId: "tn-v2.1", // or use NodeTNClient.getDefaultChainId(endpoint)
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
const deployResult = await client.deployStream(streamId, StreamType.Primitive);

// Load the primitive action to insert records
const primitiveAction = client.loadPrimitiveAction();

// Insert a record
await primitiveAction.insertRecord({
	stream: client.ownStreamLocator(streamId),
	eventTime: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
	value: "100.50", // Value as a string for precision
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
await client.deployStream(parentStreamId, StreamType.Composed);

// Load the composed action to set taxonomy
const composedAction = client.loadComposedAction();

// Set stream taxonomy (how child streams are combined)
await composedAction.setTaxonomy({
	stream: client.ownStreamLocator(parentStreamId),
	taxonomyItems: [
		{
			childStream: client.ownStreamLocator(childStream1Id),
			weight: "0.6", // 60% weight
		},
		{
			childStream: client.ownStreamLocator(childStream2Id),
			weight: "0.4", // 40% weight
		},
	],
	startDate: Math.floor(Date.now() / 1000), // When this taxonomy becomes effective
});

// Get taxonomy information for the composed stream
const taxonomies = await composedAction.getTaxonomiesForStreams({
	streams: [client.ownStreamLocator(parentStreamId)],
	latestOnly: true
});

console.log("Current taxonomy:");
taxonomies.forEach(taxonomy => {
	console.log(`Child: ${taxonomy.childStreamId.getId()}, Weight: ${taxonomy.weight}`);
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


### Data Attestations

Data attestations enable validators to cryptographically sign query results, providing verifiable proofs that can be consumed by smart contracts and external applications.

#### Requesting an Attestation

```typescript
// Load the attestation action
const attestationAction = client.loadAttestationAction();

// Request a signed attestation of query results
const result = await attestationAction.requestAttestation({
	dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
	streamId: "stai0000000000000000000000000000",
	actionName: "get_record", // Action to attest
	args: [
		"0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
		"stai0000000000000000000000000000",
		Math.floor(Date.now() / 1000) - 86400, // from: 1 day ago
		Math.floor(Date.now() / 1000),         // to: now
		null,  // frozen_at
		false, // use_cache
	],
	encryptSig: false, // Encryption not implemented in MVP
	maxFee: 1000000,   // Maximum fee willing to pay
});

console.log(`Request TX ID: ${result.requestTxId}`);
```

#### Retrieving a Signed Attestation

The leader validator signs attestations asynchronously after a few blocks. Poll to retrieve the signed payload:

```typescript
// Wait for transaction confirmation
await client.waitForTx(result.requestTxId);

// Poll for signature (with retry logic)
let signed = null;
for (let i = 0; i < 15; i++) {
	try {
		signed = await attestationAction.getSignedAttestation({
			requestTxId: result.requestTxId,
		});
		if (signed.payload.length > 65) break; // Got signature
	} catch (e) {
		await new Promise(resolve => setTimeout(resolve, 2000));
	}
}

console.log(`Signed payload: ${signed.payload.length} bytes`);
```

#### Listing Attestations

```typescript
// Get your wallet address as bytes
const myAddress = client.address().getAddress();
const myAddressBytes = new Uint8Array(Buffer.from(myAddress.slice(2), "hex"));

// List your recent attestations
const attestations = await attestationAction.listAttestations({
	requester: myAddressBytes,
	limit: 10,
	orderBy: "created_height desc",
});

attestations.forEach(att => {
	console.log(`TX: ${att.requestTxId}, Signed: ${att.signedHeight ? "Yes" : "Pending"}`);
});
```

#### Parsing Attestation Payloads

The SDK provides utilities to parse and verify signed attestation payloads:

```typescript
import { parseAttestationPayload } from "@trufnetwork/sdk-js";
import { sha256, recoverAddress } from "ethers";

// Get signed attestation
const signed = await attestationAction.getSignedAttestation({
  requestTxId: result.requestTxId,
});

// Extract canonical payload and signature
const canonicalPayload = signed.payload.slice(0, -65);
const signature = signed.payload.slice(-65);

// Verify signature
const digest = sha256(canonicalPayload);
const validatorAddress = recoverAddress(digest, {
  r: "0x" + Buffer.from(signature.slice(0, 32)).toString("hex"),
  s: "0x" + Buffer.from(signature.slice(32, 64)).toString("hex"),
  v: signature[64]
});

// Parse and decode the payload
const parsed = parseAttestationPayload(canonicalPayload);
console.log(`Validator: ${validatorAddress}`);
console.log(`Query Results: ${parsed.result.length} rows`);
```

**📖 For complete documentation including signature verification, payload structure, result decoding, and EVM integration examples, see the [Attestation Payload Parsing](./docs/api-reference.md#attestation-payload-parsing) section in the API Reference.**

#### Attestation Payload Structure

The signed attestation payload is a binary blob containing:
1. Version (1 byte)
2. Algorithm (1 byte, 0 = secp256k1)
3. Block height (8 bytes)
4. Data provider (20 bytes, length-prefixed)
5. Stream ID (32 bytes, length-prefixed)
6. Action ID (2 bytes)
7. Arguments (variable, length-prefixed)
8. Result (variable, ABI-encoded, length-prefixed)
9. Signature (65 bytes, secp256k1)

This payload can be passed to EVM smart contracts for on-chain verification using `ecrecover`.

For a complete example, see [examples/attestation](./examples/attestation).

### Transaction Ledger Queries

Query transaction history, fees, and distributions for auditing and analytics.

```typescript
// Get transaction details
const transactionAction = client.loadTransactionAction();
const txEvent = await transactionAction.getTransactionEvent({
  txId: '0xabcdef...'
});
console.log(`Method: ${txEvent.method}, Fee: ${txEvent.feeAmount} wei`);

// List fees paid by wallet
const entries = await transactionAction.listTransactionFees({
  wallet: address,
  mode: 'paid',  // 'paid', 'received', or 'both'
  limit: 10
});
```

**📖 For complete documentation including parameters, return types, pagination, filtering modes, and real-world examples, see the [Transaction Ledger Queries](./docs/api-reference.md#transaction-ledger-queries) section in the API Reference.**

### Transaction Lifecycle and Best Practices ⚠️

**Critical Understanding**: TN operations return success when transactions enter the mempool, NOT when they're executed on-chain. For operations where order matters, you must wait for transactions to be mined before proceeding.

> 💡 **See Complete Example**: For a comprehensive demonstration of transaction lifecycle patterns, see [`examples/transaction-lifecycle-example/index.ts`](./examples/transaction-lifecycle-example/index.ts)

#### The Race Condition Problem

```typescript
// ❌ DANGEROUS - Race condition possible
const deployResult = await client.deployStream(streamId, StreamType.Primitive);
// Stream might not be ready yet!
await primitiveAction.insertRecord({ stream: client.ownStreamLocator(streamId), ... }); // Could fail

const destroyResult = await client.destroyStream(client.ownStreamLocator(streamId));
// Stream might not be destroyed yet!
await primitiveAction.insertRecord({ stream: client.ownStreamLocator(streamId), ... }); // Could succeed unexpectedly
```

#### Solution: Use waitForTx (Recommended for Critical Operations)

```typescript
// ✅ SAFE - Explicit transaction confirmation
const deployResult = await client.deployStream(streamId, StreamType.Primitive);
if (!deployResult.data) {
  throw new Error('Deploy failed');
}

// Wait for deployment to complete
await client.waitForTx(deployResult.data.tx_hash);

// Now safe to proceed
await primitiveAction.insertRecord({
  stream: client.ownStreamLocator(streamId),
  eventTime: Math.floor(Date.now() / 1000),
  value: "100.50"
});
```

#### When to Use Synchronous Patterns:
- ✅ **Stream deployment before data insertion**
- ✅ **Stream deletion before cleanup verification**  
- ✅ **Sequential operations with dependencies**
- ✅ **Testing and development scenarios**

#### When Async is Acceptable:
- ⚡ **High-throughput data insertion** (independent records)
- ⚡ **Fire-and-forget operations** (with proper error handling)

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

## Quick Reference

### Common Operations

| Operation | Method |
|-----------|--------|
| Deploy primitive stream | `client.deployStream(streamId, StreamType.Primitive)` |
| Deploy composed stream | `client.deployStream(streamId, StreamType.Composed)` |
| Insert records | `primitiveAction.insertRecord({stream, eventTime, value})` |
| Get stream data | `streamAction.getRecord({stream, from, to})` |
| Set stream taxonomy | `composedAction.setTaxonomy({stream, taxonomyItems, startDate})` |
| Get stream taxonomy | `composedAction.getTaxonomiesForStreams({streams, latestOnly})` |
| Request attestation | `attestationAction.requestAttestation({dataProvider, streamId, actionName, args, encryptSig, maxFee})` |
| Get signed attestation | `attestationAction.getSignedAttestation({requestTxId})` |
| Parse attestation payload | `parseAttestationPayload(canonicalPayload)` |
| List attestations | `attestationAction.listAttestations({requester, limit, offset, orderBy})` |
| Get transaction event | `transactionAction.getTransactionEvent({txId})` |
| List transaction fees | `transactionAction.listTransactionFees({wallet, mode, limit, offset})` |
| Destroy stream | `client.destroyStream(streamLocator)` |

**Safe Operation Pattern:**
```typescript
const result = await client.deployStream(streamId, StreamType.Primitive);
if (!result.data) throw new Error('Deploy failed');
await client.waitForTx(result.data.tx_hash); // Wait for confirmation
// Now safe to proceed with dependent operations
```

### Key Types

- `StreamType.Primitive` - Raw data streams
- `StreamType.Composed` - Aggregated streams with taxonomy
- `StreamLocator` - Stream identifier with data provider
- `TaxonomyQueryResult` - Taxonomy information with weights

## Further Resources & Next Steps

To continue learning and building with the TN SDK, explore the following resources:

- **Tutorials & Guides**:
  - [Getting Started Guide](./docs/getting-started.md): A detailed walkthrough for setting up and making your first interactions with the SDK.
  - [Core Concepts Explained](./docs/core-concepts.md): Understand the fundamental building blocks of the TRUF.NETWORK and the SDK.
- **Detailed Documentation**:
  - [API Reference](./docs/api-reference.md): Comprehensive details on all SDK classes, methods, types, and parameters including taxonomy operations.
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
