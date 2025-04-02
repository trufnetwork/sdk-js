import { describe, expect } from "vitest";
import { EthereumAddress } from "../../src/util/EthereumAddress";
import { visibility } from "../../src/util/visibility";
import { StreamId } from "../../src/util/StreamId";
import { createTestContexts, waitForTxSuccess } from "./utils";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";

// Define roles and their private keys for permission tests
const PERMISSION_ROLES = {
  owner: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  reader: "0x1111111111111111111111111111111111111111111111111111111111111111",
} as const;

// Create permission-specific test context
const tnTest = createTestContexts(PERMISSION_ROLES);

describe.sequential("Permissions", { timeout: 90000 }, () => {
  // Skip in CI, because it needs a local node
  tnTest.skipIf(process.env.CI);

  tnTest(
    "should manage primitive stream permissions",
    async ({ ownerClient, readerClient, readerWallet }) => {
      // Generate a unique stream ID
      const streamId = await StreamId.generate("test-permissions-primitive");
      const streamLocator = ownerClient.ownStreamLocator(streamId);

      // Clean up after test
      try {
        // Deploy and initialize primitive stream with test data
        await ownerClient.deployStream(streamId, "primitive", true);
        const primitiveStream = ownerClient.loadPrimitiveStream(streamLocator);

        // tx is used to wait for tx success on each call
        let tx: GenericResponse<TxReceipt>;

        tx = await primitiveStream.initializeStream();
        await waitForTxSuccess(tx, ownerClient);

        // Insert test data
        tx = await primitiveStream.insertRecords([
          { eventTime: "2024-01-01", value: "100.000000000000000000" },
        ]);
        await waitForTxSuccess(tx, ownerClient);

        // Load stream for reader
        const readerPrimitiveStream =
          readerClient.loadPrimitiveStream(streamLocator);

        // Test public read access
        const publicRecords = await readerPrimitiveStream.getRecord({
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(publicRecords.length).toBe(1);
        expect(publicRecords[0].value).toBe("100.000000000000000000");

        // Set stream to private
        tx = await primitiveStream.setReadVisibility(visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify owner can still read
        const ownerRecords = await primitiveStream.getRecord({
          from: "2024-01-01",
          to: "2024-01-01",
        });
        expect(ownerRecords.length).toBe(1);

        // Verify reader cannot read when private
        await expect(
          readerPrimitiveStream.getRecord({
            from: "2024-01-01",
            to: "2024-01-01",
          }),
        ).rejects.toThrow();

        // Allow reader access
        const readerAddress = new EthereumAddress(readerWallet.address);
        tx = await primitiveStream.allowReadWallet(readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader can now read
        const allowedRecords = await readerPrimitiveStream.getRecord({
          from: "2024-01-01",
          to: "2024-01-01",
        });
        expect(allowedRecords.length).toBe(1);

        // Disable reader access
        tx = await primitiveStream.disableReadWallet(readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader cannot read after being disabled
        await expect(
          readerPrimitiveStream.getRecord({
            from: "2024-01-01",
            to: "2024-01-01",
          }),
        ).rejects.toThrow();
      } finally {
        await ownerClient.destroyStream(streamId, true).catch(() => {});
      }
    },
  );

  tnTest(
    "should manage composed stream permissions",
    async ({ ownerClient, readerClient, readerWallet }) => {
      // Generate stream IDs for both primitive and composed streams
      const primitiveStreamId = await StreamId.generate(
        "test-permissions-primitive-child",
      );
      const composedStreamId = await StreamId.generate(
        "test-permissions-composed",
      );

      try {
        // Deploy and initialize primitive stream with test data
        await ownerClient.deployStream(primitiveStreamId, "primitive", true);
        const primitiveStream = ownerClient.loadPrimitiveStream(
          ownerClient.ownStreamLocator(primitiveStreamId),
        );

        // tx is used to wait for tx success on each call
        let tx: GenericResponse<TxReceipt>;

        tx = await primitiveStream.initializeStream();
        await waitForTxSuccess(tx, ownerClient);
        tx = await primitiveStream.insertRecords([
          { eventTime: "2024-01-01", value: "100.000000000000000000" },
        ]);
        await waitForTxSuccess(tx, ownerClient);
        // Deploy and initialize composed stream
        await ownerClient.deployStream(composedStreamId, "composed", true);
        const composedStream = ownerClient.loadComposedStream(
          ownerClient.ownStreamLocator(composedStreamId),
        );
        tx = await composedStream.initializeStream();
        await waitForTxSuccess(tx, ownerClient);

        // Set taxonomy using primitive stream
        tx = await composedStream.setTaxonomy({
          taxonomyItems: [
            {
              childStream: ownerClient.ownStreamLocator(primitiveStreamId),
              weight: "1",
            },
          ],
          startDate: "2024-01-01",
        });
        await waitForTxSuccess(tx, ownerClient);

        // Load streams for reader
        const readerComposedStream = readerClient.loadComposedStream(
          ownerClient.ownStreamLocator(composedStreamId),
        );

        // Test public access
        const publicRecords = await readerComposedStream.getRecord({
          from: "2024-01-01",
          to: "2024-01-01",
        });
        expect(publicRecords.length).toBe(1);

        // Set primitive stream compose visibility to private
        tx = await primitiveStream.setComposeVisibility(visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify composed stream fails when child is private
        await expect(
          readerComposedStream.getRecord({
            from: "2024-01-01",
            to: "2024-01-01",
          }),
        ).rejects.toThrow();

        // Allow composed stream to read primitive stream
        tx = await primitiveStream.allowComposeStream(
          ownerClient.ownStreamLocator(composedStreamId),
        );
        await waitForTxSuccess(tx, ownerClient);

        // Verify composed stream works when allowed
        const allowedRecords = await readerComposedStream.getRecord({
          from: "2024-01-01",
          to: "2024-01-01",
        });
        expect(allowedRecords.length).toBe(1);

        // Set composed stream read visibility to private
        tx = await composedStream.setReadVisibility(visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader cannot access private composed stream
        await expect(
          readerComposedStream.getRecord({
            from: "2024-01-01",
            to: "2024-01-01",
          }),
        ).rejects.toThrow();

        // Allow reader to access composed stream
        const readerAddress = new EthereumAddress(readerWallet.address);
        tx = await composedStream.allowReadWallet(readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader can access when allowed
        const finalRecords = await readerComposedStream.getRecord({
          from: "2024-01-01",
          to: "2024-01-01",
        });
        expect(finalRecords.length).toBe(1);
      } finally {
        await ownerClient.destroyStream(primitiveStreamId, true).catch((e) => {
          console.log("Failed to destroy primitive stream", e);
        });
        await ownerClient.destroyStream(composedStreamId, true).catch((e) => {
          console.log("Failed to destroy composed stream", e);
        });
      }
    },
  );
});
