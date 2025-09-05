# Integration Tests

This directory contains integration tests for the TRUF Network SDK.

## Test Types

### 1. Node-Dependent Tests (Require Local Setup)
Most integration tests use `setupTrufNetwork()` and require:
- @node repository available locally
- Docker containers for PostgreSQL and TN-DB
- Complete local node deployment with migrations

**Examples:**
- `primitiveStream.test.ts`
- `composedStream.test.ts`
- `roleManagement.test.ts`

**Setup Required:**
```bash
# Set NODE_REPO_DIR in .env
NODE_REPO_DIR=/path/to/trufnetwork/node

# Run tests
npm run test:integration
```

### 2. Network-Independent Tests (Standalone)
Some tests work directly against any TRUF Network endpoint without local setup.

**Examples:**
- `taxonomyQuerying.test.ts` ✨ (New)

**Benefits:**
- No @node repository dependency
- No Docker containers needed
- Can test against mainnet or any endpoint
- Faster to set up and run

## Environment Configuration

Use `.env` or environment variables to customize test behavior:

```bash
# Default: Uses mainnet
TEST_ENDPOINT=https://gateway.mainnet.truf.network
TEST_CHAIN_ID=tn-v2.1

# Or use local node
TEST_ENDPOINT=http://localhost:8484
TEST_CHAIN_ID=your-chain-id
```

## Running Tests

### All Integration Tests (Requires Local Setup)
```bash
npm run test:integration
```

### Specific Test Files
```bash
# Node-independent taxonomy tests
npx vitest run tests/integration/taxonomyQuerying.test.ts

# With custom endpoint
TEST_ENDPOINT=https://gateway.mainnet.truf.network \
npx vitest run tests/integration/taxonomyQuerying.test.ts
```

### Individual Test Cases
```bash
npx vitest run -t "listTaxonomiesByHeight returns expected structure"
```

## Writing New Integration Tests

### For New Functionality That Requires Node Setup
Follow the existing pattern:
```typescript
import { setupTrufNetwork } from './utils'

describe('My New Feature Tests', () => {
  setupTrufNetwork(); // Handles Docker containers and node setup
  
  // Your tests here
});
```

### For Query-Only Functionality
Use the standalone pattern (recommended when possible):
```typescript
import { Wallet } from 'ethers'
import { NodeTNClient } from '../../src/client/nodeClient'

describe('My Query Tests', () => {
  let client: NodeTNClient;

  beforeEach(async () => {
    const wallet = new Wallet("0x...");
    const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
    const chainId = process.env.TEST_CHAIN_ID || "tn-v2";

    client = new NodeTNClient({
      endpoint,
      signerInfo: { address: wallet.address, signer: wallet },
      chainId,
      timeout: 30000,
    });
  });

  // Your tests here
});
```

## Troubleshooting

### "No actions found for namespace 'main'" Error
This typically means:
1. The node doesn't have the required actions deployed
2. The node is not fully initialized
3. Network connectivity issues

### "Transaction failed: Caller is not the owner or member of manager role" Error  
This means:
1. The test wallet doesn't have required permissions (expected for read-only tests)
2. You're testing against a network where the wallet doesn't have roles

### Tests Timeout or Fail to Connect
1. Check `TEST_ENDPOINT` is accessible
2. Verify network connectivity
3. Try with a different endpoint
4. Check if the endpoint supports the required actions

## Best Practices

1. **Use environment variables** for configuration instead of hardcoding endpoints
2. **Make tests resilient** to different data sets (mainnet vs local vs testnet)
3. **Handle serialization differences** (string vs number types from different networks)
4. **Test with realistic data** when possible rather than just mocked data
5. **Keep tests independent** - don't rely on specific existing data when possible
6. **Add appropriate timeouts** for network calls (30+ seconds for integration tests)