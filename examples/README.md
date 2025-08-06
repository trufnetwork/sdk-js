# Truf Network SDK Examples

This directory contains example code demonstrating how to use the Truf Network SDK.

## Setup

1. Navigate to the examples directory:
```bash
cd examples
```

2. Install dependencies:
```bash
pnpm add @trufnetwork/sdk-js@latest
pnpm install
```

## Examples

### Basic AI Index Record Retrieval (TypeScript)

The `index.ts` file demonstrates how to:
- Connect to the Truf Network
- Retrieve records from the AI Index stream
- Query taxonomies using new height-based querying methods
- Perform batch processing for multiple streams
- Use incremental synchronization patterns

To run:
```bash
pnpm start
```

Example output:
```
AI Index records: [ { eventTime: '1748908800', value: '102.407712690100000000' } ]

=== Taxonomy Querying Examples ===
Found 3 recent taxonomies:
1. Stream: st123abc
   Child: st456def
   Weight: 0.75
   Block Height: 1500
```
Note: The actual values will vary as the AI Index is updated regularly.

### Taxonomy Querying Example

The `taxonomy_querying_example/` directory contains a comprehensive example demonstrating:
- Height-based taxonomy querying for incremental synchronization
- Batch processing for multiple streams
- Pagination handling for large datasets
- Latest-only filtering
- Real-world use cases for explorer synchronization

To run:
```bash
cd taxonomy_querying_example
PRIVATE_KEY=your_private_key npm start
```

This example is particularly useful for:
- Building blockchain explorers that need to sync taxonomy changes
- Analytics systems that track stream composition over time
- Monitoring tools that detect taxonomy updates

## Notes

- The example uses a test wallet for demonstration purposes
- For production use, always use proper wallet management and security practices

## Requirements

- Node.js >= 18
- pnpm package manager 