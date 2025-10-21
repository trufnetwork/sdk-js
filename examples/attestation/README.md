# Attestation Example

This example demonstrates how to request, wait for, and retrieve signed data attestations from TRUF.NETWORK.

## Overview

Attestations enable validators to cryptographically sign query results, providing verifiable proofs that can be consumed by smart contracts and external applications.

## What This Example Does

1. **Request Attestation**: Submits a transaction requesting a signed attestation of query results
2. **Wait for Confirmation**: Waits for the transaction to be included in a block
3. **Poll for Signature**: Waits for the leader validator to sign the attestation (typically 1-2 blocks)
4. **Retrieve Payload**: Gets the complete signed attestation payload
5. **List Attestations**: Shows recent attestations for the wallet

## Prerequisites

- Node.js >= 18
- A wallet with TRUF tokens for transaction fees
- Private key with access to TRUF.NETWORK

## Setup

1. **Install Dependencies**:
   ```bash
   cd /home/micbun/trufnetwork/sdk-js
   npm install
   ```

2. **Set Environment Variables**:
   ```bash
   export PRIVATE_KEY="0x..."  # Your wallet's private key
   export ENDPOINT="https://gateway.mainnet.truf.network"  # Optional
   export CHAIN_ID="tn-v2.1"  # Optional
   ```

## Running the Example

### Option 1: Direct Execution

```bash
npm run build
node dist/esm/examples/attestation/index.mjs
```

### Option 2: Using ts-node

```bash
npx ts-node examples/attestation/index.ts
```

### Option 3: Add to package.json scripts

Add to `package.json`:
```json
{
  "scripts": {
    "example:attestation": "ts-node examples/attestation/index.ts"
  }
}
```

Then run:
```bash
npm run example:attestation
```

## Expected Output

```
Setting up TN client...

Connected to: https://gateway.mainnet.truf.network
Wallet address: 0x...

===== Requesting Attestation =====
Data Provider: 0x4710a8d8f0d845da110086812a32de6d90d7ff5c
Stream ID: stai0000000000000000000000000000
Time Range: 2025-10-14T... to 2025-10-21T...

✅ Attestation requested!
Request TX ID: 0x...

Waiting for transaction confirmation...
✅ Transaction confirmed!

===== Waiting for Validator Signature =====
The leader validator will sign the attestation asynchronously (typically 1-2 blocks)...

✅ Signed attestation received after 3 attempts!

Payload size: 450 bytes
First 64 bytes (hex): 010000...
Last 65 bytes (signature): a7b3c2...

===== Listing Recent Attestations =====

Found 5 attestations for 0x...:

[1] Request TX: 0x...
    Created at block: 12345
    Signed at block: 12347
    Attestation hash: abc123...
    Encrypted: No

...

===== Summary =====
✅ Successfully requested and retrieved a signed attestation!

Next steps:
- Use the payload in EVM smart contracts for verification
- Implement signature verification using ecrecover
- Parse the canonical payload to extract query results

The signed attestation payload contains:
1. Version (1 byte)
2. Algorithm (1 byte, 0 = secp256k1)
3. Block height (8 bytes)
4. Data provider (20 bytes, length-prefixed)
5. Stream ID (32 bytes, length-prefixed)
6. Action ID (2 bytes)
7. Arguments (variable, length-prefixed)
8. Result (variable, length-prefixed)
9. Signature (65 bytes, secp256k1)

✨ Example completed successfully!
```

## Understanding the Output

### Attestation Request
- **Request TX ID**: The transaction hash for your attestation request
- **Data Provider**: The address of the entity providing the data
- **Stream ID**: The identifier of the data stream
- **Time Range**: The time period for which data is being attested

### Signed Attestation Payload
The payload is a binary blob containing:
1. **Version** (1 byte): Protocol version (currently 1)
2. **Algorithm** (1 byte): Signature algorithm (0 = secp256k1)
3. **Block Height** (8 bytes): Block when attestation was created
4. **Data Provider** (20 bytes + 4-byte prefix): Ethereum address
5. **Stream ID** (32 bytes + 4-byte prefix): Stream identifier
6. **Action ID** (2 bytes): Identifier for the action being attested
7. **Arguments** (variable + 4-byte prefix): Encoded action arguments
8. **Result** (variable + 4-byte prefix): Encoded query results
9. **Signature** (65 bytes): Secp256k1 signature (R, S, V)

This payload can be passed to EVM smart contracts for on-chain verification.

## Next Steps

### Use in Smart Contracts

The signed attestation can be verified in Solidity:

```solidity
// Parse and verify the attestation
function verifyAttestation(bytes memory payload, address expectedValidator) public view returns (bool) {
    // 1. Parse the payload to extract fields
    // 2. Reconstruct the message hash from canonical fields
    // 3. Use ecrecover to verify the signature
    // 4. Check that the recovered address matches expectedValidator
    return true; // if valid
}
```

### Signature Verification

The signature can be verified using `ecrecover`:

```typescript
import { ethers } from "ethers";

// Extract signature from payload (last 65 bytes)
const signature = payload.slice(-65);
const r = signature.slice(0, 32);
const s = signature.slice(32, 64);
const v = signature[64];

// Reconstruct message hash (SHA256 of canonical payload without signature)
const canonical = payload.slice(0, -65);
const messageHash = ethers.utils.sha256(canonical);

// Recover signer
const recoveredAddress = ethers.utils.recoverAddress(messageHash, {
    r: ethers.utils.hexlify(r),
    s: ethers.utils.hexlify(s),
    v: v
});

console.log(`Signer: ${recoveredAddress}`);
```

## Troubleshooting

### Transaction Timeout
If the transaction times out, increase the timeout:
```typescript
await client.waitForTx(requestResult.requestTxId, 60000); // 60 seconds
```

### Signature Polling Timeout
If the signature polling times out, you can:
1. Increase `maxAttempts` in the example code
2. Check if the node is functioning correctly
3. Manually poll later using `getSignedAttestation()`

### Insufficient Balance
Ensure your wallet has enough TRUF tokens:
```bash
# Check balance using kwil-cli or similar tool
```

### Invalid Private Key
Ensure your private key is correctly formatted:
- Should start with "0x"
- Should be 66 characters long (including "0x")
- Should be a valid hexadecimal string

## API Reference

### requestAttestation()

```typescript
interface RequestAttestationInput {
  dataProvider: string;  // 0x-prefixed address (42 chars)
  streamId: string;      // 32 characters
  actionName: string;    // Action to attest
  args: any[];          // Action arguments
  encryptSig: boolean;  // Must be false (MVP)
  maxFee: number;       // Maximum fee willing to pay
}
```

### getSignedAttestation()

```typescript
interface GetSignedAttestationInput {
  requestTxId: string;  // Transaction ID from request
}
```

### listAttestations()

```typescript
interface ListAttestationsInput {
  requester?: Uint8Array;  // Filter by requester (20 bytes)
  limit?: number;         // Max results (1-5000)
  offset?: number;        // Pagination offset
  orderBy?: string;       // Sort order
}
```

## Related Documentation

- [SDK-JS Documentation](../../README.md)
- [Attestation Implementation Plan](../../../DataAttestation/SDK_JS_Attestation_Implementation_Plan.md)
- [TRUF.NETWORK Documentation](https://docs.truf.network)

## Support

For issues or questions:
- GitHub Issues: https://github.com/trufnetwork/sdk-js/issues
- Discord: https://discord.gg/trufnetwork
