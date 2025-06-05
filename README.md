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
import { NodeTNClient, StreamId } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Create a wallet.
const wallet = new Wallet("YOUR_PRIVATE_KEY");

// Initialize client for Node.js
const client = new NodeTNClient({
  endpoint: "https://gateway.mainnet.truf.network",
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
For detailed configuration options for both clients, please see our [API Reference](./docs/api-reference.md). //TODO

## Usage Examples

Here are some common use cases for the SDK. For a wider range of examples and advanced scenarios, please explore the [example scripts in this repository](./examples) and our [detailed API Reference](./docs/api-reference.md). //TODO

### Deploying and Managing Your Own Stream

Assuming you have initialized `client` (an instance of `NodeTNClient`) and `wallet` (an instance of `ethers.Wallet`) as shown in the [Basic Client Initialization](#basic-client-initialization) section, here's how you can deploy a stream, insert data, and read it back.

```ts
import { NodeTNClient, StreamId, StreamType } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// 1. Generate or define a stream ID
const streamId = await StreamId.generate("my-data-stream");

// 2. Deploy a primitive stream
const deployResponse = await client.deployStream(streamId, StreamType.Primitive, true);
deployResponse.throw();
const deployReceipt = deployResponse.unwrap();
await client.waitForTx(deployReceipt.txHash);

// 3. Load the action client
const streamAction = client.loadPrimitiveAction(); //You can use loadAction() too

// 4. Insert Data
const insertResponse = await streamAction.insertRecords([
  {
    stream: client.ownStreamLocator(streamId),
    eventTime: Math.floor(new Date("2024-03-10T10:00:00Z").getTime() / 1000),
    value: "123.45"
  }
]);
// For streams deployed by the client's wallet (like this one), client.ownStreamLocator(streamId) can be used.
// For other streams, you'd explicitly define the stream locator with the streamId and the dataProvider's Ethereum address.

// 5. Read data
const data = await streamAction.getRecord({
  stream: client.ownStreamLocator(streamId),
  from: Math.floor(new Date("2024-03-10").getTime() / 1000),
  to: Math.floor(new Date("2024-03-11").getTime() / 1000)
});
```

### Reading from an Existing Index (e.g., Truflation AI Index)

Assuming you have an initialized `client` (an instance of `NodeTNClient`) as shown in [Basic Client Initialization](#basic-client-initialization) section, you can read from existing public streams. 
```ts
import { StreamId, EthereumAddress } from "@trufnetwork/sdk-js";

// Create a stream locator for the AI Index
const aiIndexLocator = {
  streamId: StreamId.fromString("st527bf3897aa3d6f5ae15a0af846db6").throw(),
  dataProvider: EthereumAddress.fromString("0x4710a8d8f0d845da110086812a32de6d90d7ff5c").throw(),
};

// Load the action client
const streamAction = client.loadAction();

// Get the latest records
const records = await streamAction.getRecord({
  stream: aiIndexLocator,
});
```

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
For more details on specific methods related to Explorer interactions, consult the [API Reference](./docs/api-reference.md). //TODO

### Using the SDK with Your Local Node
If you are running your own TRUF.NETWORK node, you can configure the SDK to interact with your local instance. This is useful for development, testing, or when operating within a private network.
For detailed instructions, prerequisites, and examples, please see our [Using the SDK with Your Local Node Guide](./docs/local-node-guide.md).

## Deployment Considerations

### Running with Deno

This package works with Deno when using the `--allow-net` permission flag:

```ts
import { ... } from "npm:@trufnetwork/sdk-js"
```

#### Deno Environment Permissions

By default, some dependencies require environment permissions. If you need to run without environment permissions, please see [this GitHub issue](https://github.com/denoland/deno/issues/20898#issuecomment-2500396620) for workarounds.

## Serverless Deployment Notes

### Handling Crypto Hashing in Serverless Environments

When deploying to some serverless environments, Node.js modules like `crypto-hash` may encounter compatibility issues. To resolve this, you can create a shim for the 
`crypto-hash` module and use
Webpack's `NormalModuleReplacementPlugin` to replace it during the build process.

##### 1. Create a Shim File

Add a new file named `crypto-hash-sync.js` to your project:

```javascript
import { createHash } from 'crypto';

export const sha1 = (input) => createHash('sha1').update(input).digest('hex');
export const sha256 = (input) => createHash('sha256').update(input).digest('hex');
export const sha384 = (input) => createHash('sha384').update(input).digest('hex');
export const sha512 = (input) => createHash('sha512').update(input).digest('hex');
```

##### 2. Update Your Bundler Configuration (Example: Webpack)

If you are using Webpack (common in Next.js or custom serverless setups), modify your configuration (e.g., `next.config.js` or `webpack.config.js`):

```javascript
const path = require('path');

module.exports = {
    // ... other configurations
    webpack: (config, {isServer, webpack}) => {
        // Add shim for crypto-hash
        config.plugins.push(
            new webpack.NormalModuleReplacementPlugin(
                /crypto-hash/,
                path.resolve(__dirname, 'crypto-hash-sync.js')
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
    - [Core Concepts Explained](./docs/core-concepts.md): Understand the fundamental building blocks of the Truf Network and the SDK.
- **Detailed Documentation**:
    - [API Reference](./docs/api-reference.md): Comprehensive details on all SDK classes, methods, types, and parameters.
- **Examples & Demos**:
    - [TN SDK Demo Repository](https://github.com/truflation/tsn-sdk-demo)
    - [Live Demo on CodeSandbox](https://codesandbox.io/p/devbox/m2r3tt?file=%2Fsrc%2Froutes%2F%2Bpage.svelte)
    - [Reading a Truflation Stream (Node.js on CodeSandbox)](https://codesandbox.io/p/devbox/rtm7mn?file=%2Findex.ts%3A22%2C11)
    - [Local Examples Directory](./examples) (Contains examples for stream deployment, data insertion, retrieval, and destruction).
- **Whitepaper**:
    - [Truflation Whitepaper](https://whitepaper.truflation.com)

## Mainnet Network

The mainnet network is available at: `https://gateway.mainnet.truf.network`

## Support

For support, please [open an issue](https://github.com/trufnetwork/sdk-js/issues) on our GitHub repository.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for details.
