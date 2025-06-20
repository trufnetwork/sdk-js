# Complex Stream Example

## Overview

This example demonstrates the complete lifecycle of stream management in the TRUF.NETWORK SDK, including:
- Creating primitive streams
- Creating a composed stream
- Setting up stream taxonomy
- Inserting records into streams
- Reading stream data
- Removing streams

## Prerequisites

- Node.js 18+
- pnpm (recommended)
- Local TRUF.NETWORK node or mainnet access

## Setup

```bash
# Install dependencies (if you haven't already)
pnpm add @trufnetwork/sdk-js@latest
pnpm install

# Execute the script
pnpm start
```

## What This Example Does

The script performs the following steps:

1. Initialize a TRUF.NETWORK client with a demonstration private key
2. Generate unique stream IDs for:
   - Two primitive streams
   - One composed stream
3. Deploy primitive streams
4. Deploy a composed stream
5. Insert records into primitive streams
6. Set up stream taxonomy for the composed stream
7. Read and display stream data:
   - Retrieve records from primitive streams
   - Describe the composed stream's taxonomy
8. Clean up by destroying all created streams

## Key Concepts Demonstrated

- Stream generation
- Stream deployment
- Record insertion
- Taxonomy creation
- Transaction waiting and confirmation
- Stream lifecycle management

## Important Notes

- **WARNING**: This example uses a hardcoded private key for demonstration purposes.
- **NEVER** use hardcoded private keys in production environments.
- Always keep your private keys secure and use environment variables or secure key management in real applications.
- The example is configured to use a local node (`http://localhost:8484`). Adjust the endpoint as needed.

## Customization

To adapt this example to your use case:
- Replace the hardcoded private key with your own
- Modify stream generation, record insertion, and taxonomy setup as needed
- Change the endpoint to your preferred TRUF.NETWORK node

## Troubleshooting

- Ensure you have a stable internet connection
- Verify you have sufficient funds for transaction fees
- Check network connectivity to the TRUF.NETWORK gateway
- Confirm local node is running if using `localhost`

## Transaction Handling

The example uses `waitForTx()` to ensure each transaction is confirmed before proceeding, demonstrating robust transaction management.

## License

Apache 2.0 