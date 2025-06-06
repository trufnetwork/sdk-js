# Using the SDK with Your Local Node

This section is for users who are running their own local TRUF.NETWORK node and want to interact with it using the SDK.

> **Note:**
> This guidance is intended for node operators who are running a local
> TRUF.NETWORK node that is fully synced with the network. If your node is not
> connected to the network, queries may return empty results because your local
> database will not contain any data. Always ensure your node is synchronized
> before using it as an SDK endpoint.

### Prerequisites

1.  **Node is Fully Synced:**
    Ensure your local TRUF.NETWORK node is fully synchronized with the network and has all necessary data. Refer to the [Node Operator Guide](https://github.com/trufnetwork/node/blob/main/docs/node-operator-guide.md#7-verify-node-synchronization) for instructions on checking sync status.
2.  **Local Endpoint:**
    Your node should be running and exposing its HTTP API, typically at `http://localhost:8484` (the default).

### Discovering Stream Details

Before fetching data, you need the stream's ID and its data provider address. The [TRUF.NETWORK Explorer](https://truf.network/explorer/0x4710a8d8f0d845da110086812a32de6d90d7ff5c/stai0000000000000000000000000000) is a valuable tool for this. For instance, to find details for the "AI Index" stream:
-   **Stream ID:** `stai0000000000000000000000000000`
-   **Data Provider:** `0x4710a8d8f0d845da110086812a32de6d90d7ff5c`
You can browse the [explorer](https://truf.network/explorer/) for other streams and their metadata.

### Example: Fetching Data from Your Local Node

This example demonstrates fetching records from the "AI Index" stream using your local node.

First, ensure you have the SDK and `ethers` installed:
```bash
npm install @trufnetwork/sdk-js ethers
# or
yarn add @trufnetwork/sdk-js ethers
# or
pnpm install @trufnetwork/sdk-js ethers
```

Then, use the following code:

```typescript
import {
  NodeTNClient,
  StreamLocator,
  EthereumAddress,
  StreamId
} from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// Replace with your actual private key or load from environment for security
const wallet = new Wallet("YOUR_PRIVATE_KEY");

const client = new NodeTNClient({
  endpoint: "http://localhost:8484",
  chainId: "", // Specify your local node's chainId if required
  signerInfo: {
    address: wallet.address,
    signer: wallet,
  },
});

// Define the stream locator for the AI Index stream
const streamLocator: StreamLocator = {
  streamId: StreamId.fromString("stai0000000000000000000000000000").unwrap(),
  dataProvider: EthereumAddress.fromString("0x4710a8d8f0d845da110086812a32de6d90d7ff5c").throw(),
};

// Load the primitive stream action client
const primitive = client.loadPrimitiveAction();

// Fetch records from the local node
const records = await primitive.getRecord({
  stream: streamLocator,
});

console.log(records);
```

> **Note:**
> Replace `YOUR_PRIVATE_KEY` in your `.env` file with an actual private key if you intend to perform write operations or if your local node requires signed read requests. The example attempts to proceed with a dummy key for read-only if one isn't provided, but this may not work in all local node configurations.
> The `chainId` might also need to be specified based on your local node's configuration.

### Troubleshooting Local Node Connection

-   If you receive empty results, ensure your node is fully synced and has the latest data.
If you cannot connect, verify your node is running and listening on http://localhost:8484.
-   If you cannot connect, verify your node is running and accessible at the specified endpoint (e.g., `http://localhost:8484`). Check firewall settings.

For more details on node setup and sync, refer to the [TRUF.NETWORK Node Operator Guide](https://github.com/trufnetwork/node/).

For client configuration options relevant to local nodes, see the [API Reference](./api-reference.md). 