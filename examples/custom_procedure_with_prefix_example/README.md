# Custom Index with Prefix Integration

## Overview

This example demonstrates the retrieval of custom indexes with prefix functionality from existing streams within the TRUF.NETWORK (TN) SDK framework.

> **Note:** Data provider partnership is required to integrate custom methods with prefix functionality into standard operations as shown in this implementation.

## Objectives

This implementation illustrates:
- Establishing connections to TN nodes (local or mainnet environments)
- Retrieving indexed data from predefined streams using standard methods enhanced with prefix capabilities

## Core Components

- TN client initialization and configuration
- Stream connection establishment
- Stream index retrieval operations
- Time-based index query

## System Requirements

- Node.js >= 18
- pnpm package manager
- TRUF.NETWORK JavaScript SDK
- Active TN node access (local or mainnet)
- Valid stream for data retrieval operations

## Running the example

From the project root:

```bash
# Install dependencies (if you haven't already)
pnpm add @trufnetwork/sdk-js@latest

# Execute the script
pnpm start
```

The script will output the procedure result to the console. 