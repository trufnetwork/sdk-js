# TSN SDK JS

The TSN SDK provides developers with tools to interact with the Truflation Stream Network, a decentralized platform for publishing, composing, and consuming economic data streams.

## Quick Start

### Prerequisites
- Node.js 18 or later

### Installation
```bash
npm install @truflation/tsn-sdk-js
# or your preferred package manager
```

### Environment-specific Usage

```ts
// For Node.js applications
import { NodeTSNClient } from "@truflation/tsn-sdk-js";

// For browser applications
import { BrowserTSNClient } from "@truflation/tsn-sdk-js";
```

### Example Usage

```ts
import { NodeTSNClient, StreamId } from "@truflation/tsn-sdk-js";

// Initialize client
const client = new NodeTSNClient({
  endpoint: "https://staging.tsn.truflation.com",
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Any object that implements signMessage
  },
  chainId: "tsn-1", // or use NodeTSNClient.getDefaultChainId()
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
- Check our [TSN SDK Demo Repository](https://github.com/truflation/tsn-sdk-demo)
- Try the [Live Demo on CodeSandbox](https://codesandbox.io/p/devbox/m2r3tt?file=%2Fsrc%2Froutes%2F%2Bpage.svelte)
- Try reading from [a Truflation Stream on CodeSandbox with NodeJS](https://codesandbox.io/p/devbox/rtm7mn?file=%2Findex.ts%3A22%2C11)

## Stream Types

TSN supports two main types of streams:

- **Primitive Streams**: Direct data sources from providers
- **Composed Streams**: Aggregate data from multiple streams using weights

More information about TSN components can be found in the [Go TSN-SDK Documentation](https://github.com/truflation/tsn-sdk/blob/main/docs/readme.md).

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Core Concepts](./docs/core-concepts.md)
- [API Reference](./docs/api-reference.md)

## Staging Network

A staging network is available at https://staging.tsn.truflation.com for testing and experimentation.

## Support

For support, please [open an issue](https://github.com/truflation/tsn-sdk-js/issues).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE.md) for details.
