# TN SDK JS

The TN SDK provides developers with tools to interact with the TRUF.NETWORK, a decentralized platform for publishing, composing, and consuming economic data streams.

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

Here's a quick example of how to initialize the client:

```ts
import { NodeTNClient, StreamId } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Create a wallet
const wallet = new Wallet("YOUR_PRIVATE_KEY");

// Initialize client
const client = new NodeTNClient({
  endpoint: "https://gateway.mainnet.truf.network",
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Any object that implements signMessage
  },
  chainId: "tn-v2", // or use NodeTNClient.getDefaultChainId(endpoint)
});

// You are now ready to interact with TRUF.Network!
// See Usage Examples for more detailed operations.
```
> **Note:** Replace `YOUR_PRIVATE_KEY` with your actual private key (hex string). The
> wallet is required for signing and authenticating requests.

const stream = client.loadPrimitiveAction();

// Insert data, simplified
await stream.insertRecords([
  { stream: client.ownStreamLocator(streamId), eventTime: new Date("2024-01-01").getTime() / 1000, value: "100.5" }
]);

// Read data
const data = await stream.getRecord({
  stream: client.ownStreamLocator(streamId),
  from: new Date("2024-01-01").getTime() / 1000,
  to: new Date("2024-01-02").getTime() / 1000,
});
```

### Reading from Truflation AI Index

You can easily read data from existing indexes like the Truflation AI Index:

```ts
import { NodeTNClient, StreamId, EthereumAddress } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

const wallet = new Wallet("0000000000000000000000000000000000000000000000000000000000000001");

const client = new NodeTNClient({
  endpoint: "https://gateway.mainnet.truf.network",
  signerInfo: {
    address: wallet.address,
    signer: wallet,
  },
  chainId: "tn-v2",
});

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

### Explorer Interaction

To enable Explorer-related features, you need to set the `neonConnectionString` in the `NodeTNClient` constructor.
You can request the explorer write-only connection string by contacting us.

```ts
const client = new NodeTNClient({     
    endpoint: "https://gateway.mainnet.truf.network",
    signerInfo: {
        address: wallet.address,
        signer: wallet,
    },
    chainId: "tn-v2",
    neonConnectionString: yourNeonConnectionString,
});
```

For a complete working example:
- Check our [TN SDK Demo Repository](https://github.com/truflation/tsn-sdk-demo)
- Try the [Live Demo on CodeSandbox](https://codesandbox.io/p/devbox/m2r3tt?file=%2Fsrc%2Froutes%2F%2Bpage.svelte)
- Try reading from [a Truflation Stream on CodeSandbox with NodeJS](https://codesandbox.io/p/devbox/rtm7mn?file=%2Findex.ts%3A22%2C11)
- Check out the [TN SDK JS Example Directory](./examples). It contains examples for stream deployment, data insertion, data retrieval, and stream destruction.

## Stream Types

TN supports two main types of streams:

- **Primitive Streams**: Direct data sources from providers
- **Composed Streams**: Aggregate data from multiple streams using weights

More information about TN components can be found in the [Js SDK Documentation](https://github.com/trufnetwork/sdk-js/blob/main/docs/api-reference.md).

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Core Concepts](./docs/core-concepts.md)
- [API Reference](./docs/api-reference.md)

## Mainnet Network

The mainnet network is available at https://gateway.mainnet.truf.network

## Running with Deno

This package works with Deno when using the `--allow-net` permission flag:

```ts
import { ... } from "npm:@trufnetwork/sdk-js"
```

### Deno Environment Permissions

By default, some dependencies require environment permissions. If you need to run without environment permissions, please see [this GitHub issue](https://github.com/denoland/deno/issues/20898#issuecomment-2500396620) for workarounds.

## Serverless Deployment Notes

### Handling Crypto Hashing in Serverless Environments

When deploying to serverless environments, some Node.js modules like `crypto-hash` may not work as expected due to
compatibility issues. To resolve this, you can create a shim for the `crypto-hash` module and use
Webpack's `NormalModuleReplacementPlugin` to replace it during the build process.

#### 1. Create a Shim File

Add a new file named `crypto-hash-sync.js` to your project:

```js
import { createHash } from 'crypto';

export const sha1 = (input) => createHash('sha1').update(input).digest('hex');
export const sha256 = (input) => createHash('sha256').update(input).digest('hex');
export const sha384 = (input) => createHash('sha384').update(input).digest('hex');
export const sha512 = (input) => createHash('sha512').update(input).digest('hex');
```

#### 2. Update Your Webpack Configuration

Modify your `next.config.js` (or equivalent Webpack configuration file) to include the following:

```js
const path = require('path');

module.exports = {
    webpack: (config, {isServer, webpack}) => {
        // Add shim for crypto-hash
        config.plugins.push(
            new webpack.NormalModuleReplacementPlugin(
                /crypto-hash/,
                path.resolve(__dirname, 'crypto-hash-sync.js')
            )
        );
        return config;
    }
};
```

## Further Resources & Next Steps

To continue learning and building with the TN SDK, explore the following resources:

- **Tutorials & Guides**:
    - [Getting Started Guide](./docs/getting-started.md): A detailed walkthrough for setting up and making your first interactions with the SDK.
    - [Core Concepts Explained](./docs/core-concepts.md): Understand the fundamental building blocks of the Truf Network and the SDK.
- **Detailed Documentation**:
    - [API Reference](./docs/api-reference.md): Comprehensive details on all SDK classes, methods, types, and parameters.
- **Examples & Demos**:
    - [Live Demo on CodeSandbox](https://codesandbox.io/p/devbox/m2r3tt?file=%2Fsrc%2Froutes%2F%2Bpage.svelte) TODO: Update
    - [Reading a Truflation Stream (Node.js on CodeSandbox)](https://codesandbox.io/p/devbox/rtm7mn?file=%2Findex.ts%3A22%2C11) //TODO: update
    - [Local Examples Directory](./examples) (Contains examples for stream deployment, data insertion, retrieval, and destruction).
- **Whitepaper**:
    - [Truflation Whitepaper](https://whitepaper.truflation.com)

## Mainnet Network

The mainnet network is available at: `https://gateway.mainnet.truf.network`

## Support

For support, please [open an issue](https://github.com/trufnetwork/sdk-js/issues) on our GitHub repository.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for details.
