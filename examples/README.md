# Truf Network SDK Examples

This directory contains example code demonstrating how to use the Truf Network SDK.

## Setup

1. Navigate to the examples directory:
```bash
cd examples
```

2. Install dependencies:
```bash
pnpm install
```

## Examples

### Basic AI Index Record Retrieval (TypeScript)

The `index.ts` file demonstrates how to:
- Connect to the Truf Network
- Retrieve records from the AI Index stream

To run:
```bash
pnpm start
```

Example output:
```
AI Index records: [ { eventTime: '1748908800', value: '102.407712690100000000' } ]
```
Note: The actual values will vary as the AI Index is updated regularly.

## Notes

- The example uses a test wallet for demonstration purposes
- For production use, always use proper wallet management and security practices

## Requirements

- Node.js >= 18
- pnpm package manager 