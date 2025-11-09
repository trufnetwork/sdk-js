/**
 * Attestation Example
 *
 * This example demonstrates how to:
 * 1. Request a signed attestation of query results
 * 2. Wait for the validator to sign the attestation
 * 3. Retrieve the complete signed attestation payload
 * 4. List your recent attestations
 *
 * Prerequisites:
 * - Set PRIVATE_KEY environment variable with your wallet's private key
 * - Ensure you have enough balance on TRUF.NETWORK for transaction fees
 */

import { NodeTNClient } from "../../src";
import { Wallet, sha256, recoverAddress } from "ethers";

async function main() {
  // ===== 1. Setup Client =====
  console.log("Setting up TN client...\n");

  // Use default test private key if PRIVATE_KEY not set
  const privateKey = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";
  const wallet = new Wallet(privateKey);

  if (!process.env.PRIVATE_KEY) {
    console.log(`⚠️  WARNING: No PRIVATE_KEY environment variable provided, using hardcoded private key (wallet address: ${wallet.address})`);
    console.log(`   Attestation requests may fail if this is a test key or wallet without sufficient TRUF balance\n`);
  }
  const client = new NodeTNClient({
    endpoint: process.env.ENDPOINT || "https://gateway.mainnet.truf.network",
    signerInfo: {
      address: wallet.address,
      signer: wallet,
    },
    chainId: process.env.CHAIN_ID || "tn-v2.1",
  });

  console.log(`Connected to: ${process.env.ENDPOINT || "https://gateway.mainnet.truf.network"}`);
  console.log(`Wallet address: ${wallet.address}\n`);

  // ===== 2. Load Attestation Action =====
  const attestationAction = client.loadAttestationAction();

  // ===== Request Attestation Metadata =====
  console.log("===== Requesting Attestation =====");

  const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c"; // AI Index data provider
  const streamId = "stai0000000000000000000000000000"; // AI Index stream

  // Query last 7 days of data
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 24 * 60 * 60;

  console.log(`Data Provider: ${dataProvider}`);
  console.log(`Stream ID: ${streamId}`);
  console.log(`Time Range: ${new Date(weekAgo * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}\n`);

  // ===== 3. List My Recent Attestations =====
  console.log("===== Listing Recent Attestations =====\n");

  // Get requester address as bytes
  const myAddress = wallet.address;
  const myAddressBytes = new Uint8Array(Buffer.from(myAddress.slice(2), "hex"));

  const attestations = await attestationAction.listAttestations({
    requester: myAddressBytes,
    limit: 3,
    offset: 0,
    orderBy: "created_height desc",
  });

  console.log(`Found ${attestations.length} attestations for ${myAddress}:\n`);

  attestations.forEach((att, idx) => {
    console.log(`[${idx + 1}] Request TX: ${att.requestTxId}`);
    console.log(`    Created at block: ${att.createdHeight}`);
    console.log(`    Signed at block: ${att.signedHeight ? att.signedHeight : "Not yet signed"}`);
    console.log(`    Attestation hash: ${Buffer.from(att.attestationHash).toString("hex")}`);
    console.log(`    Encrypted: ${att.encryptSig ? "Yes" : "No"}`);
    console.log("");
  });

  // ===== Demonstrate get_signed_attestation if we have a signed attestation =====
  const signedAtts = attestations.filter(att => att.signedHeight !== null);
  if (signedAtts.length > 0) {
    console.log("===== Retrieving Signed Attestation Payload =====");
    console.log(`Found ${signedAtts.length} signed attestation(s), retrieving the first one...\n`);

    const firstSigned = signedAtts[0];
    try {
      const signedPayload = await attestationAction.getSignedAttestation({
        requestTxId: firstSigned.requestTxId,
      });

      console.log(`✅ Retrieved signed attestation for TX: ${firstSigned.requestTxId}`);

      const payload = signedPayload.payload;
      console.log(`   Payload size: ${payload.length} bytes`);
      console.log(`   First 64 bytes (hex): ${Buffer.from(payload.slice(0, 64)).toString("hex")}`);
      console.log(`   Last 65 bytes (signature): ${Buffer.from(payload.slice(-65)).toString("hex")}`);
      console.log(`   Full payload (hex): ${Buffer.from(payload).toString("hex")}`);

      // ===== Extract Validator Public Key from Payload =====
      console.log(`\n===== Extracting Validator Information =====`);

      // Validate payload has minimum length (at least 1 byte data + 65 bytes signature)
      if (payload.length < 66) {
        console.log(`⚠️  Payload too short (${payload.length} bytes), expected at least 66 bytes\n`);
        throw new Error(`Invalid payload format: too short (${payload.length} bytes)`);
      }

      const signatureOffset = payload.length - 65;
      const canonicalPayload = payload.slice(0, signatureOffset);
      const signature = payload.slice(signatureOffset);

      // Hash the canonical payload with SHA256 (as per attestation spec)
      const digest = sha256(canonicalPayload);

      // Recover validator address from signature
      // The signature format is [R || S || V] where V is {27,28}
      // ethers expects this format: { r, s, v }
      const r = "0x" + Buffer.from(signature.slice(0, 32)).toString("hex");
      const s = "0x" + Buffer.from(signature.slice(32, 64)).toString("hex");
      const v = signature[64];

      const validatorAddress = recoverAddress(digest, { r, s, v });

      console.log(`✅ Validator Address: ${validatorAddress}`);
      console.log(`   This is the address you should use in your EVM smart contract's verify() function\n`);

      console.log(`   💡 How to use this payload:`);
      console.log(`   1. Send this hex payload to your EVM smart contract`);
      console.log(`   2. The contract can verify the signature using ecrecover`);
      console.log(`   3. Parse the payload to extract the attested query results`);
      console.log(`   4. Use the verified data in your on-chain logic (e.g., settle bets, trigger payments)`);
    } catch (err: any) {
      console.log(`⚠️  Could not retrieve signed attestation: ${err.message}\n`);
    }
  }

  // ===== 4. Attempt to Request New Attestation (may fail if insufficient balance) =====
  console.log("\n===== Attempting to Request New Attestation =====");
  console.log("⚠️  NOTE: This requires at least 40 TRUF balance for attestation fee\n");

  let requestResult;
  let signedAttestation = null;

  try {
    requestResult = await attestationAction.requestAttestation({
      dataProvider,
      streamId,
      actionName: "get_record", // Attest the get_record query
      args: [
        dataProvider,
        streamId,
        weekAgo,
        now,
        null, // frozen_at (not used)
        false, // use_cache (will be forced to false for determinism)
      ],
      encryptSig: false, // Encryption not implemented in MVP
      maxFee: "40000000000000000000", // Maximum fee in wei (1 TRUF = 1e18 wei)
    });

    console.log(`✅ Attestation requested!`);
    console.log(`Request TX ID: ${requestResult.requestTxId}\n`);

    // Wait for Transaction Confirmation
    console.log("Waiting for transaction confirmation...");
    await client.waitForTx(requestResult.requestTxId, 30000); // 30 second timeout
    console.log("✅ Transaction confirmed!\n");

    // ===== Wait for Validator Signature =====
    console.log("===== Waiting for Validator Signature =====");
    console.log("The leader validator will sign the attestation asynchronously (typically 1-2 blocks)...\n");

    const maxAttempts = 15; // 30 seconds max (2 seconds per attempt)

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await attestationAction.getSignedAttestation({
          requestTxId: requestResult.requestTxId,
        });

        // Check if we got a valid payload (canonical + signature)
        if (result.payload && result.payload.length > 65) {
          signedAttestation = result;
          console.log(`✅ Signed attestation received after ${i + 1} attempts!`);
          break;
        }
      } catch (err: any) {
        // Not signed yet, continue polling
        // Log unexpected errors for debugging (skip expected "not found" or "not signed" errors)
        if (err.message && !err.message.toLowerCase().includes("not found") && !err.message.toLowerCase().includes("not signed")) {
          console.log(`   ⚠️  Warning: Unexpected error during polling: ${err.message}`);
        }
      }

      // Progress indicator
      process.stdout.write(`Attempt ${i + 1}/${maxAttempts}...`);
      if (i < maxAttempts - 1) {
        process.stdout.write("\r");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        process.stdout.write("\n");
      }
    }

    if (!signedAttestation) {
      console.error("\n❌ Attestation not signed within timeout period");
      console.log("The attestation may still be signed later. Try polling manually.");
    } else {
      console.log(`\nPayload size: ${signedAttestation.payload.length} bytes`);
      console.log(`First 64 bytes (hex): ${Buffer.from(signedAttestation.payload.slice(0, 64)).toString("hex")}`);
      console.log(`Last 65 bytes (signature): ${Buffer.from(signedAttestation.payload.slice(-65)).toString("hex")}`);
      console.log(`Full payload (hex): ${Buffer.from(signedAttestation.payload).toString("hex")}\n`);
    }
  } catch (err: any) {
    // Check if it's an insufficient balance error
    if (err.message && err.message.includes("Insufficient balance")) {
      console.log("\n⚠️  WARNING: Insufficient balance for attestation (requires 40 TRUF)");
      console.log("   This is expected for test keys or wallets without sufficient TRUF balance");
      console.log("   The listing functionality above still works and demonstrates the SDK capabilities\n");
    } else {
      // Re-throw other errors
      console.error("\n❌ Unexpected error during attestation request:", err.message);
      throw err;
    }
  }

  // ===== Summary =====
  console.log("===== Summary =====");
  if (signedAttestation) {
    console.log("✅ Successfully requested and retrieved a signed attestation!");
  } else {
    console.log("✅ Successfully demonstrated attestation listing functionality!");
    console.log("⚠️  Attestation request skipped due to insufficient balance (expected for test wallets)");
  }
  console.log("\nNext steps:");
  console.log("- Use the payload in EVM smart contracts for verification");
  console.log("- Implement signature verification using ecrecover");
  console.log("- Parse the canonical payload to extract query results");
  console.log("\nThe signed attestation payload contains:");
  console.log("1. Version (1 byte)");
  console.log("2. Algorithm (1 byte, 0 = secp256k1)");
  console.log("3. Block height (8 bytes)");
  console.log("4. Data provider (20 bytes, length-prefixed)");
  console.log("5. Stream ID (32 bytes, length-prefixed)");
  console.log("6. Action ID (2 bytes)");
  console.log("7. Arguments (variable, length-prefixed)");
  console.log("8. Result (variable, length-prefixed)");
  console.log("9. Signature (65 bytes, secp256k1)");
}

// Run the example
main()
  .then(() => {
    console.log("\n✨ Example completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
