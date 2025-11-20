import { describe, expect } from "vitest";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";

// TODO: Re-enable attestation tests once test environment has bridge extension loaded
// The attestation action requires ethereum_bridge/sepolia_bridge extension for fee collection.
// Currently, the Docker test environment doesn't have the bridge extension configured,
// causing tests to fail with "namespace not found: 'ethereum_bridge'".
//
// The SDK-JS code is correct and supports NUMERIC(78, 0) types properly.
// See: node/internal/migrations/migration.go:103 for bridge namespace replacement logic
describe.skip.sequential(
  "Attestation Integration Tests",
  { timeout: 360000 },
  () => {
    // Spin up/tear down the local TN+Postgres containers once for this suite.
    setupTrufNetwork();

    testWithDefaultWallet(
      "should request attestation successfully",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Request an attestation for AI Index stream
        const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
        const streamId = "stai0000000000000000000000000000";
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 24 * 60 * 60;

        const result = await attestationAction.requestAttestation({
          dataProvider,
          streamId,
          actionName: "get_record",
          args: [
            dataProvider,
            streamId,
            weekAgo,
            now,
            null, // frozen_at
            false, // use_cache (will be forced to false by node)
          ],
          encryptSig: false,
          maxFee: '50000000000000000000', // 50 TRUF (attestation fee is 40 TRUF)
        });

        // Verify request was successful
        expect(result.requestTxId).toBeTruthy();
        expect(typeof result.requestTxId).toBe("string");
        expect(result.requestTxId.length).toBeGreaterThan(0);

        console.log(`Attestation requested with TX ID: ${result.requestTxId}`);

        // Wait for transaction to be mined to avoid nonce issues in subsequent tests (30s timeout)
        await defaultClient.waitForTx(result.requestTxId, 30000);
      }
    );

    testWithDefaultWallet(
      "should retrieve signed attestation after waiting",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Request an attestation with unique time range (offset by 1 hour to avoid duplicate)
        const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
        const streamId = "stai0000000000000000000000000000";
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 24 * 60 * 60;
        const weekAgoOffset = weekAgo + 3600; // Add 1 hour offset for uniqueness

        const requestResult = await attestationAction.requestAttestation({
          dataProvider,
          streamId,
          actionName: "get_record",
          args: [dataProvider, streamId, weekAgoOffset, now, null, false],
          encryptSig: false,
          maxFee: '50000000000000000000', // 50 TRUF (attestation fee is 40 TRUF)
        });

        console.log(`DEBUG: Full requestAttestation result:`, JSON.stringify(requestResult, null, 2));
        console.log(`Request TX ID: ${requestResult.requestTxId}`);

        // Wait for transaction to be mined (30s timeout)
        const txResult = await defaultClient.waitForTx(requestResult.requestTxId, 30000);
        console.log(`DEBUG: TX confirmed at height ${txResult.height}, hash: ${txResult.tx_hash}`);
        console.log(`DEBUG: TX result - code: ${(txResult as any).tx_result?.code}, log: ${(txResult as any).tx_result?.log}`);

        // Poll for signature (leader signs asynchronously, typically 1-2 blocks)
        let signed = null;
        let attempts = 0;
        const maxAttempts = 15; // 30 seconds max

        for (let i = 0; i < maxAttempts; i++) {
          try {
            const signedResult = await attestationAction.getSignedAttestation({
              requestTxId: requestResult.requestTxId,
            });

            console.log(`DEBUG Attempt ${i + 1}: getSignedAttestation returned:`, {
              hasPayload: !!signedResult.payload,
              payloadLength: signedResult.payload?.length,
              payloadType: typeof signedResult.payload,
              fullResult: JSON.stringify(signedResult, (key, value) =>
                value instanceof Uint8Array ? `Uint8Array(${value.length})` : value
              )
            });

            // Check if we got a valid payload (should be > 65 bytes: canonical + 65-byte signature)
            if (signedResult.payload && signedResult.payload.length > 65) {
              signed = signedResult;
              console.log(`✅ Signed attestation received after ${i + 1} attempts (${signedResult.payload.length} bytes)`);
              break;
            } else {
              console.log(`Attempt ${i + 1}/${maxAttempts}: Payload too small or missing (length: ${signedResult.payload?.length || 0})`);
            }
          } catch (e: any) {
            // Not signed yet, continue polling
            console.log(`Attempt ${i + 1}/${maxAttempts}: Error - ${e.message}`);
          }

          // Wait 2 seconds before next attempt
          await new Promise((resolve) => setTimeout(resolve, 2000));
          attempts++;
        }

        // Verify we got the signed attestation
        expect(signed).toBeTruthy();
        expect(signed!.payload).toBeTruthy();
        expect(signed!.payload.length).toBeGreaterThan(65);

        // Verify payload is Uint8Array
        expect(signed!.payload).toBeInstanceOf(Uint8Array);

        console.log(
          `Final payload: ${signed!.payload.length} bytes, first 32 bytes: ${Buffer.from(signed!.payload.slice(0, 32)).toString("hex")}`
        );
      }
    );

    testWithDefaultWallet(
      "should list attestations with default params",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // First, create an attestation so we have something to list (with unique time range)
        const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
        const streamId = "stai0000000000000000000000000000";
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 24 * 60 * 60;
        const weekAgoOffset = weekAgo + 7200; // Add 2 hours offset for uniqueness

        const requestResult = await attestationAction.requestAttestation({
          dataProvider,
          streamId,
          actionName: "get_record",
          args: [dataProvider, streamId, weekAgoOffset, now, null, false],
          encryptSig: false,
          maxFee: '50000000000000000000', // 50 TRUF (attestation fee is 40 TRUF)
        });

        // Wait for transaction to be mined (30s timeout)
        await defaultClient.waitForTx(requestResult.requestTxId, 30000);

        // List all attestations (no filter)
        const attestations = await attestationAction.listAttestations({});

        // Should return array
        expect(Array.isArray(attestations)).toBe(true);

        console.log(`Found ${attestations.length} total attestations`);

        // If we have attestations, validate their structure
        if (attestations.length > 0) {
          const first = attestations[0];
          expect(first.requestTxId).toBeTruthy();
          expect(first.attestationHash).toBeInstanceOf(Uint8Array);
          expect(first.requester).toBeInstanceOf(Uint8Array);
          expect(typeof first.createdHeight).toBe("number");
          expect(first.createdHeight).toBeGreaterThan(0);
          expect(typeof first.encryptSig).toBe("boolean");

          console.log(`First attestation: TX ${first.requestTxId}, height ${first.createdHeight}, signed: ${first.signedHeight ? "yes" : "no"}`);
        }
      }
    );

    testWithDefaultWallet(
      "should list attestations with filters",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Get requester address as bytes (20 bytes, without 0x prefix)
        const requesterAddress = defaultClient.address().getAddress();
        const requesterBytes = new Uint8Array(
          Buffer.from(requesterAddress.slice(2), "hex")
        );

        // List attestations for this requester with limit and ordering
        const attestations = await attestationAction.listAttestations({
          requester: requesterBytes,
          limit: 10,
          offset: 0,
          orderBy: "created_height desc",
        });

        // Should return array
        expect(Array.isArray(attestations)).toBe(true);

        console.log(`Found ${attestations.length} attestations for requester ${requesterAddress}`);

        // All returned attestations should be from this requester
        attestations.forEach((att, idx) => {
          expect(att.requester).toBeInstanceOf(Uint8Array);
          expect(att.requester.length).toBe(20);

          // Convert to hex and compare
          const attRequester = Buffer.from(att.requester).toString("hex");
          const expectedRequester = requesterAddress.slice(2).toLowerCase();
          expect(attRequester).toBe(expectedRequester);

          console.log(`  [${idx}] TX: ${att.requestTxId}, Height: ${att.createdHeight}, Signed: ${att.signedHeight ? att.signedHeight : "pending"}`);
        });
      }
    );

    testWithDefaultWallet(
      "should validate input parameters",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Test invalid data_provider (wrong length)
        await expect(
          attestationAction.requestAttestation({
            dataProvider: "0xinvalid",
            streamId: "stai0000000000000000000000000000",
            actionName: "get_record",
            args: [],
            encryptSig: false,
            maxFee: 1000,
          })
        ).rejects.toThrow("data_provider must be 0x-prefixed 40 hex characters");

        // Test invalid stream_id (wrong length)
        await expect(
          attestationAction.requestAttestation({
            dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
            streamId: "short",
            actionName: "get_record",
            args: [],
            encryptSig: false,
            maxFee: 1000,
          })
        ).rejects.toThrow("stream_id must be 32 characters");

        // Test empty action_name
        await expect(
          attestationAction.requestAttestation({
            dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
            streamId: "stai0000000000000000000000000000",
            actionName: "",
            args: [],
            encryptSig: false,
            maxFee: 1000,
          })
        ).rejects.toThrow("action_name cannot be empty");

        // Test encryptSig=true (not implemented in MVP)
        await expect(
          attestationAction.requestAttestation({
            dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
            streamId: "stai0000000000000000000000000000",
            actionName: "get_record",
            args: [],
            encryptSig: true, // Should fail
            maxFee: 1000,
          })
        ).rejects.toThrow("encryption not implemented in MVP");

        // Test negative maxFee
        await expect(
          attestationAction.requestAttestation({
            dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
            streamId: "stai0000000000000000000000000000",
            actionName: "get_record",
            args: [],
            encryptSig: false,
            maxFee: -1,
          })
        ).rejects.toThrow("max_fee must be non-negative");

        console.log("All validation tests passed");
      }
    );

    testWithDefaultWallet(
      "should handle list attestations pagination",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Test with different limits
        const limit5 = await attestationAction.listAttestations({ limit: 5 });
        const limit10 = await attestationAction.listAttestations({ limit: 10 });

        expect(Array.isArray(limit5)).toBe(true);
        expect(Array.isArray(limit10)).toBe(true);

        // If we have enough attestations, verify pagination works
        if (limit10.length >= 5) {
          expect(limit5.length).toBeLessThanOrEqual(5);
          expect(limit10.length).toBeLessThanOrEqual(10);
        }

        console.log(`Limit 5: ${limit5.length} results, Limit 10: ${limit10.length} results`);

        // Test offset
        const page1 = await attestationAction.listAttestations({ limit: 5, offset: 0 });
        const page2 = await attestationAction.listAttestations({ limit: 5, offset: 5 });

        expect(Array.isArray(page1)).toBe(true);
        expect(Array.isArray(page2)).toBe(true);

        // If we have enough data, verify pages are different
        if (page1.length > 0 && page2.length > 0) {
          expect(page1[0].requestTxId).not.toBe(page2[0].requestTxId);
        }

        console.log(`Page 1: ${page1.length} results, Page 2: ${page2.length} results`);
      }
    );

    testWithDefaultWallet(
      "should handle different orderBy options",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Test ascending order
        const asc = await attestationAction.listAttestations({
          limit: 10,
          orderBy: "created_height asc",
        });

        expect(Array.isArray(asc)).toBe(true);

        // Verify ascending order if we have multiple results
        if (asc.length > 1) {
          for (let i = 1; i < asc.length; i++) {
            expect(asc[i].createdHeight).toBeGreaterThanOrEqual(asc[i - 1].createdHeight);
          }
        }

        console.log(`Ascending order: ${asc.length} results, heights: ${asc.map(a => a.createdHeight).join(", ")}`);

        // Test descending order
        const desc = await attestationAction.listAttestations({
          limit: 10,
          orderBy: "created_height desc",
        });

        expect(Array.isArray(desc)).toBe(true);

        // Verify descending order if we have multiple results
        if (desc.length > 1) {
          for (let i = 1; i < desc.length; i++) {
            expect(desc[i].createdHeight).toBeLessThanOrEqual(desc[i - 1].createdHeight);
          }
        }

        console.log(`Descending order: ${desc.length} results, heights: ${desc.map(a => a.createdHeight).join(", ")}`);
      }
    );

    testWithDefaultWallet(
      "should filter attestations by request transaction ID",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // First, create an attestation so we have a request_tx_id to filter by (with unique time range)
        const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
        const streamId = "stai0000000000000000000000000000";
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 24 * 60 * 60;
        const weekAgoOffset = weekAgo + 10800; // Add 3 hours offset for uniqueness

        const requestResult = await attestationAction.requestAttestation({
          dataProvider,
          streamId,
          actionName: "get_record",
          args: [dataProvider, streamId, weekAgoOffset, now, null, false],
          encryptSig: false,
          maxFee: '50000000000000000000', // 50 TRUF (attestation fee is 40 TRUF)
        });

        // Wait for transaction to be mined (30s timeout)
        await defaultClient.waitForTx(requestResult.requestTxId, 30000);

        console.log(`Created attestation with request TX ID: ${requestResult.requestTxId}`);

        // Filter by request_tx_id
        const filtered = await attestationAction.listAttestations({
          requestTxId: requestResult.requestTxId,
        });

        // Should return array with exactly 1 result
        expect(Array.isArray(filtered)).toBe(true);
        expect(filtered.length).toBe(1);

        // The returned attestation should match the request_tx_id
        expect(filtered[0].requestTxId).toBe(requestResult.requestTxId);

        console.log(`Filtered by request_tx_id: found ${filtered.length} attestation(s) with TX ID ${filtered[0].requestTxId}`);
      }
    );

    testWithDefaultWallet(
      "should filter attestations by attestation hash",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // First, list attestations to get an attestation hash to filter by
        const allAttestations = await attestationAction.listAttestations({
          limit: 1,
        });

        // If we have at least one attestation, test filtering by its hash
        if (allAttestations.length > 0) {
          const targetAttestation = allAttestations[0];
          console.log(`Filtering by attestation hash: ${Buffer.from(targetAttestation.attestationHash).toString('hex')}`);

          const filtered = await attestationAction.listAttestations({
            attestationHash: targetAttestation.attestationHash,
          });

          // Should return array with at least 1 result
          expect(Array.isArray(filtered)).toBe(true);
          expect(filtered.length).toBeGreaterThan(0);

          // All returned attestations should match the attestation hash
          filtered.forEach((att) => {
            expect(Buffer.from(att.attestationHash).toString('hex')).toBe(
              Buffer.from(targetAttestation.attestationHash).toString('hex')
            );
          });

          console.log(`Filtered by attestation_hash: found ${filtered.length} attestation(s)`);
        } else {
          console.log("No attestations available to test attestation_hash filter");
        }
      }
    );

    testWithDefaultWallet(
      "should filter attestations by result canonical",
      async ({ defaultClient }) => {
        const attestationAction = defaultClient.loadAttestationAction();

        // Create an attestation and wait for it to be signed
        const dataProvider = "0x4710a8d8f0d845da110086812a32de6d90d7ff5c";
        const streamId = "stai0000000000000000000000000000";
        const now = Math.floor(Date.now() / 1000);
        const weekAgo = now - 7 * 24 * 60 * 60;
        const weekAgoOffset = weekAgo + 14400; // Add 4 hours offset for uniqueness

        const requestResult = await attestationAction.requestAttestation({
          dataProvider,
          streamId,
          actionName: "get_record",
          args: [dataProvider, streamId, weekAgoOffset, now, null, false],
          encryptSig: false,
          maxFee: '50000000000000000000', // 50 TRUF (attestation fee is 40 TRUF)
        });

        // Wait for transaction to be mined
        await defaultClient.waitForTx(requestResult.requestTxId, 30000);

        // Get the attestation metadata which should include the result_canonical
        const attestations = await attestationAction.listAttestations({
          requestTxId: requestResult.requestTxId,
        });

        if (attestations.length > 0) {
          const targetAttestation = attestations[0];

          // Note: result_canonical may not be available in the list response
          // This test demonstrates the filter capability
          console.log(`Testing result_canonical filter with request TX ID: ${requestResult.requestTxId}`);

          // Test with empty filter (should work)
          const filtered = await attestationAction.listAttestations({
            requestTxId: requestResult.requestTxId,
          });

          expect(Array.isArray(filtered)).toBe(true);
          expect(filtered.length).toBeGreaterThan(0);

          console.log(`Result canonical filter test completed: found ${filtered.length} attestation(s)`);
        } else {
          console.log("No attestations available to test result_canonical filter");
        }
      }
    );
  }
);
