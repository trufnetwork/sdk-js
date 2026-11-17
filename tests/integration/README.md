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

### 3. Kwil-free v1 API Tests (opt-in)

`v1Client.test.ts` reads the consolidated v1 API through the kwil-free `src/v1`
entry. It skips unless `TEST_V1_BASE_URL` names a deployment:

```bash
TEST_V1_BASE_URL=https://api.trufscan.io TEST_V1_NETWORK=mainnet \
  npx vitest run tests/integration/v1Client.test.ts
```

#### Credentials

Only `GET /capabilities` is readable anonymously (`accessOptional`). Every data
namespace is `accessRequired`, so the market reads need a bearer credential and
skip when none is configured. Provide one of:

```bash
# a token obtained elsewhere
TEST_V1_CREDENTIAL=<bearer token>

# or mint the public preset lazily; the same value is sent as Origin, which
# the mint requires
TEST_V1_ORIGIN=http://localhost:8090
```

A token minted for an origin is bound to it, so pair `TEST_V1_CREDENTIAL` with
`TEST_V1_ORIGIN` when the deployment mints origin-bound tokens.

#### Writes

The trade tests broadcast real transactions, so they need a second opt-in:

```bash
TEST_V1_WRITE=1   # only against a throwaway deployment or the mock
```

Without it, a live run stays read-only. `npm run test:v1:mock` sets it for you.
The suite signs with a real key so the mock can recover the signer. It falls
back to a public, well-known test key, which is fine against the mock; set
`TEST_V1_PRIVATE_KEY` before a live write run so the trades are not submitted
from an account anyone can sign for.

Two contract details the suite pins:

- `markets/{id}` takes the integer `query_id`. A non-numeric id is
  `400 invalid_argument` on `id`, **not** `not_found`, so the absent-market case
  uses an unused integer.
- The credential routes (`credentials`, `credentials/jwks`,
  `credentials/quote`, `credentials/redemptions`) are ungated. `CredentialsApi`
  therefore sends no bearer token on them; sending one would make the mint call
  re-enter the credential manager that triggered it.

#### Without a deployment

Run the same suite against an in-memory mock of the API (`mockV1Api.ts`, a
seeded dataset served over HTTP):

```bash
npm run test:v1:mock
```

The harness starts the mock, exports its URL as `TEST_V1_BASE_URL` and an
origin as `TEST_V1_ORIGIN`, sets `TEST_V1_WRITE=1` so the trade tests run, runs
the suite in a child process, and shuts the server down. The mock enforces the
same gate as the real router (401 without a credential, 409 for an unoffered
namespace, 400 for a non-numeric market id), encodes a `prepare` payload the
client can decode, and keeps `broadcast` receipts, so a full
prepare → verify → sign → broadcast → receipt trade is exercised without a
deployment. A missing credential fails rather than silently passing.

The mock also verifies the signature instead of only inspecting it. `prepare`
returns the real `concat` signature message (`txMsgToSignTmplV0`, rebuilt from
the body with its own copy of the template), and `broadcast` rebuilds that
message from the envelope body and recovers the signer with `ethers`, rejecting
a signature that does not belong to the declared sender. That is what makes the
mock a check on `sign` rather than on HTTP plumbing: a wrong signature type, a
wrong sender, or a stale `signature_message` fails here the way the node would
reject it.

#### Running against a local `indexer`

The v1 API needs Postgres and two required flags; it does not need a live node
for the routes these tests read (`capabilities` reads the registry and
`markets` reads Postgres):

```bash
# 1. Postgres, then the store migrations. `serve` does NOT create the schema;
#    `kwil-indexer run` (or store.InitStore) does. Without this every read is 500.
psql "$PG_DSN" -c 'select 1'   # sanity check

# 2. A registry and a credential policy, then serve.
go run . serve --networks networks.json --credentials credentials.json -l :8090

# 3. Mint an origin-bound token (ungated) and point the suite at it.
curl -X POST http://127.0.0.1:8090/<network>/v1/credentials \
  -H 'Origin: http://localhost:8090' -H 'Content-Type: application/json' \
  -d '{"preset":"public"}'

TEST_V1_BASE_URL=http://127.0.0.1:8090 TEST_V1_NETWORK=<network> \
  TEST_V1_ORIGIN=http://localhost:8090 \
  npx vitest run tests/integration/v1Client.test.ts
```

The registry's `gateway` is dialed at startup for a `user.health` call and its
`chain_id` must match `tn_chain_id`, so a stub that answers that one method is
enough for read-only work.

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