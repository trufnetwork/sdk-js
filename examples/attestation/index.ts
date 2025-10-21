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
import { Wallet } from "ethers";

async function main() {
  // ===== 1. Setup Client =====
  console.log("Setting up TN client...\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  const wallet = new Wallet(privateKey);
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

  // ===== 3. Request Attestation =====
  console.log("===== Requesting Attestation =====");

  const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c"; // AI Index data provider
  const streamId = "stai0000000000000000000000000000"; // AI Index stream

  // Query last 7 days of data
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 24 * 60 * 60;

  console.log(`Data Provider: ${dataProvider}`);
  console.log(`Stream ID: ${streamId}`);
  console.log(`Time Range: ${new Date(weekAgo * 1000).toISOString()} to ${new Date(now * 1000).toISOString()}\n`);

  const requestResult = await attestationAction.requestAttestation({
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
    maxFee: 1000000, // Maximum fee willing to pay
  });

  console.log(`✅ Attestation requested!`);
  console.log(`Request TX ID: ${requestResult.requestTxId}\n`);

  // ===== 4. Wait for Transaction Confirmation =====
  console.log("Waiting for transaction confirmation...");

  try {
    await client.waitForTx(requestResult.requestTxId, 30000); // 30 second timeout
    console.log("✅ Transaction confirmed!\n");
  } catch (err) {
    console.error("❌ Transaction failed or timed out:", err);
    process.exit(1);
  }

  // ===== 5. Wait for Validator Signature =====
  console.log("===== Waiting for Validator Signature =====");
  console.log("The leader validator will sign the attestation asynchronously (typically 1-2 blocks)...\n");

  let signedAttestation = null;
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
    } catch (err) {
      // Not signed yet, continue polling
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
    process.exit(1);
  }

  console.log(`\nPayload size: ${signedAttestation.payload.length} bytes`);
  console.log(`First 64 bytes (hex): ${Buffer.from(signedAttestation.payload.slice(0, 64)).toString("hex")}`);
  console.log(`Last 65 bytes (signature): ${Buffer.from(signedAttestation.payload.slice(-65)).toString("hex")}\n`);

  // ===== 6. List My Recent Attestations =====
  console.log("===== Listing Recent Attestations =====\n");

  // Get requester address as bytes
  const myAddress = wallet.address;
  const myAddressBytes = new Uint8Array(Buffer.from(myAddress.slice(2), "hex"));

  const attestations = await attestationAction.listAttestations({
    requester: myAddressBytes,
    limit: 10,
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

  // ===== 7. Summary =====
  console.log("===== Summary =====");
  console.log("✅ Successfully requested and retrieved a signed attestation!");
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
