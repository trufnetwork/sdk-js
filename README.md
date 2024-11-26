# TN SDK JS

The TN SDK provides developers with tools to interact with the Truf Network, a decentralized platform for publishing, composing, and consuming economic data streams.

## Quick Start

### Prerequisites
- Node.js 18 or later

### Installation
```bash
npm install @trufnetwork/sdk-js
# or your preferred package manager
```

### Environment-specific Usage

```ts
// For Node.js applications
import { NodeTNClient } from "@trufnetwork/sdk-js";

// For browser applications
import { BrowserTNClient } from "@trufnetwork/sdk-js";
```

### Example Usage

```ts
import { NodeTNClient, StreamId } from "@trufnetwork/sdk-js";

// Initialize client
const client = new NodeTNClient({
  endpoint: "https://staging.tsn.truflation.com",
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Any object that implements signMessage
  },
  chainId: "tsn-1", // or use NodeTNClient.getDefaultChainId()
});

// Deploy and initialize a stream
const streamId = await StreamId.generate("my-data-stream");
await client.deployStream(streamId, "primitive", true);

const stream = client.loadPrimitiveStream({
  streamId,
  dataProvider: client.address(),
});

// here simplified, you might need to wait for the tx using client.waitForTx
await stream.initializeStream();

// Insert data, simplified
await stream.insertRecords([
  { dateValue: "2024-01-01", value: "100.5" }
]);

// Read data
const data = await stream.getRecord({
  dateFrom: "2024-01-01",
  dateTo: "2024-01-01",
});
```

For a complete working example:
- Check our [TN SDK Demo Repository](https://github.com/truflation/tsn-sdk-demo)
- Try the [Live Demo on CodeSandbox](https://codesandbox.io/p/devbox/m2r3tt?file=%2Fsrc%2Froutes%2F%2Bpage.svelte)
- Try reading from [a Truflation Stream on CodeSandbox with NodeJS](https://codesandbox.io/p/devbox/rtm7mn?file=%2Findex.ts%3A22%2C11)

## Stream Types

TN supports two main types of streams:

- **Primitive Streams**: Direct data sources from providers
- **Composed Streams**: Aggregate data from multiple streams using weights

More information about TN components can be found in the [Js TN-SDK Documentation](https://github.com/trufnetwork/sdk-js/blob/main/docs/api-reference.md).

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Core Concepts](./docs/core-concepts.md)
- [API Reference](./docs/api-reference.md)

## Staging Network

A staging network is available at https://staging.tsn.truflation.com for testing and experimentation.

## Support

For support, please [open an issue](https://github.com/trufnetwork/sdk-js/issues).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE.md) for details.
