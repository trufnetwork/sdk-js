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
- (Optional) A wallet with TRUF tokens if you want to request new attestations
- (Optional) Private key - defaults to test key if not provided

## Setup

1. **Install Dependencies**:
   ```bash
   # From the sdk-js root directory
   npm install
   ```

2. **Set Environment Variables**:
   ```bash
   export PRIVATE_KEY="0x..."  # Your wallet's private key
   export ENDPOINT="https://gateway.mainnet.truf.network"  # Optional
   export CHAIN_ID="tn-v2.1"  # Optional
   ```

   **Note**: If `PRIVATE_KEY` is not set, the example will use a default test private key (`0x000...001`). This is useful for testing but the wallet may not have sufficient balance on mainnet.

## Running the Example

### Quick Start (No Configuration)

```bash
# From the sdk-js root directory, navigate to the example
cd examples/attestation

# Run with default test key
npm start
```

### With Your Own Wallet

If you want to use your own private key instead of the test key:

```bash
# From the sdk-js root directory, navigate to the example
cd examples/attestation

# Set your private key (replace with your actual private key)
export PRIVATE_KEY="0x1234567890abcdef..."

# Run the example
npm start
```

**Note**: Replace `0x1234567890abcdef...` with your actual 64-character hexadecimal private key.

## Expected Output

```
Setting up TN client...

Connected to: https://gateway.mainnet.truf.network
Wallet address: 0x...

===== Requesting Attestation =====
Data Provider: 0x4710a8d8f0d845da110086812a32de6d90d7ff5c
Stream ID: stai0000000000000000000000000000
Time Range: ...

===== Listing Recent Attestations =====

Found ... attestations for 0x...:

[1] Request TX: ...
    Created at block: ...
    Signed at block: ...
    Attestation hash: ...
    Encrypted: No

...

===== Retrieving Signed Attestation Payload =====
Found ... signed attestation(s), retrieving the first one...

✅ Retrieved signed attestation for TX: ...
   Payload size: ... bytes
   First 64 bytes (hex): ...
   Last 65 bytes (signature): ...
   Full payload (hex): ...

===== Extracting Validator Information =====
✅ Validator Address: 0x...
   This is the address you should use in your EVM smart contract's verify() function

   💡 How to use this payload:
   1. Send this hex payload to your EVM smart contract
   2. The contract can verify the signature using ecrecover
   3. Parse the payload to extract the attested query results
   4. Use the verified data in your on-chain logic

===== Attempting to Request New Attestation =====
⚠️  NOTE: This requires at least 40 TRUF balance for attestation fee

✅ Attestation requested!
Request TX ID: ...

Waiting for transaction confirmation...
✅ Transaction confirmed!

===== Waiting for Validator Signature =====
The leader validator will sign the attestation asynchronously (typically 1-2 blocks)...

✅ Signed attestation received after ... attempts!

Payload size: ... bytes
First 64 bytes (hex): ...
Last 65 bytes (signature): ...
Full payload (hex): ...

===== Summary =====
✅ Successfully requested and retrieved a signed attestation!

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
import { sha256, recoverAddress } from "ethers";

// Extract signature from payload (last 65 bytes)
const payload = signedPayload.payload;
const signatureOffset = payload.length - 65;
const canonicalPayload = payload.slice(0, signatureOffset);
const signature = payload.slice(signatureOffset);

// Hash the canonical payload with SHA256
const digest = sha256(canonicalPayload);

// Recover validator address from signature
// The signature format is [R || S || V] where V is {27,28}
const r = "0x" + Buffer.from(signature.slice(0, 32)).toString("hex");
const s = "0x" + Buffer.from(signature.slice(32, 64)).toString("hex");
const v = signature[64];

const validatorAddress = recoverAddress(digest, { r, s, v });

console.log(`Validator Address: ${validatorAddress}`);
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

### Insufficient Balance or Fee Error
Ensure your wallet has enough TRUF tokens for the attestation fee (40 TRUF).

**Note**: Set an appropriate `maxFee` value based on expected transaction costs.

### Invalid Private Key
Ensure your private key is correctly formatted:
- Should start with "0x"
- Should be 66 characters long (including "0x")
- Should be a valid hexadecimal string

## API Reference

### requestAttestation()

```typescript
interface RequestAttestationInput {
  dataProvider: string;         // 0x-prefixed address (42 chars)
  streamId: string;            // 32 characters
  actionName: string;          // Action to attest
  args: any[];                // Action arguments
  encryptSig: boolean;        // Must be false (MVP)
  maxFee: number | string | bigint;  // Maximum fee willing to pay (in wei)
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
- [TRUF.NETWORK Documentation](https://docs.truf.network)
- [EVM Attestation Contracts](https://github.com/trufnetwork/evm-contracts/tree/main/contracts/attestation)

## Support

For issues or questions:
- GitHub Issues: https://github.com/trufnetwork/sdk-js/issues
- Discord: https://discord.gg/trufnetwork
