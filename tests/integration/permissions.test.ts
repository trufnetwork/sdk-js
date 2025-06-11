import { describe, expect } from "vitest";
import { EthereumAddress } from "../../src/util/EthereumAddress";
import { visibility } from "../../src/util/visibility";
import { StreamId } from "../../src/util/StreamId";
import { createTestContexts, setupTrufNetwork, waitForTxSuccess } from "./utils";
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
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

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
        const primitiveStream = ownerClient.loadPrimitiveAction();

        // tx is used to wait for tx success on each call
        let tx: GenericResponse<TxReceipt>;

        // Insert test data
        tx = await primitiveStream.insertRecords([
          { stream: streamLocator, eventTime: new Date("2024-01-01").getTime() / 1000, value: "100.000000000000000000" },
        ]);
        await waitForTxSuccess(tx, ownerClient);

        // Load stream for reader
        const readerPrimitiveStream =
          readerClient.loadPrimitiveAction();

        // Test public read access
        const publicRecords = await readerPrimitiveStream.getRecord({
          stream: streamLocator,
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(publicRecords.length).toBe(1);
        expect(publicRecords[0].value).toBe("100.000000000000000000");

        // Set stream to private
        tx = await primitiveStream.setReadVisibility(streamLocator, visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify owner can still read
        const ownerRecords = await primitiveStream.getRecord({
          stream: streamLocator,
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(ownerRecords.length).toBe(1);

        // Verify reader gets empty array when stream is private
        const result = await readerPrimitiveStream.getRecord({
          stream: streamLocator,
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(result).toEqual([]);

        // Allow reader access
        const readerAddress = new EthereumAddress(readerWallet.address);
        tx = await primitiveStream.allowReadWallet(streamLocator, readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader can now read
        const allowedRecords = await readerPrimitiveStream.getRecord({
          stream: streamLocator,
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(allowedRecords.length).toBe(1);

        // Disable reader access
        tx = await primitiveStream.disableReadWallet(streamLocator, readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader gets empty array when access is disabled
        const disabledRecords = await readerPrimitiveStream.getRecord({
          stream: streamLocator,
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(disabledRecords).toEqual([]);
      } finally {
        await ownerClient.destroyStream({ streamId, dataProvider: ownerClient.address() }, true).catch((e) => {});
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
        const primitiveStream = ownerClient.loadPrimitiveAction();

        // tx is used to wait for tx success on each call
        let tx: GenericResponse<TxReceipt>;

        tx = await primitiveStream.insertRecords([
          { stream: ownerClient.ownStreamLocator(primitiveStreamId), eventTime: new Date("2024-01-01").getTime() / 1000, value: "100.000000000000000000" },
        ]);
        await waitForTxSuccess(tx, ownerClient);
        // Deploy and initialize composed stream
        await ownerClient.deployStream(composedStreamId, "composed", true);
        const composedStream = ownerClient.loadComposedAction();

        // Set taxonomy using primitive stream
        tx = await composedStream.setTaxonomy({
            stream: ownerClient.ownStreamLocator(composedStreamId),
          taxonomyItems: [
            {
              childStream: ownerClient.ownStreamLocator(primitiveStreamId),
              weight: "1",
            },
          ],
          startDate: new Date("2024-01-01").getTime() / 1000,
        });
        await waitForTxSuccess(tx, ownerClient);

        // Load streams for reader
        const readerComposedStream = readerClient.loadComposedAction();

        // Test public access
        const publicRecords = await readerComposedStream.getRecord({
          stream: ownerClient.ownStreamLocator(composedStreamId),
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(publicRecords.length).toBe(1);

        // Set primitive stream compose visibility to private
        tx = await primitiveStream.setComposeVisibility(ownerClient.ownStreamLocator(composedStreamId), visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify composed stream fails when child is private

        // TODO: a primitive stream that is private on compose_visibility should not be allowed to be composed by any other stream
        // unless that stream is allowed with allow_compose_stream
        // This test is broken now, probably the issue is on is_allowed_to_compose_all action
        // see https://github.com/trufnetwork/node/issues/872 for more details

        // await expect(
        //   readerComposedStream.getRecord({
        //     stream: ownerClient.ownStreamLocator(composedStreamId),
        //     from: new Date("2024-01-01").getTime() / 1000,
        //     to: new Date("2024-01-01").getTime() / 1000,
        //   }),
        // ).rejects.toThrow();

        // Allow composed stream to read primitive stream
        tx = await primitiveStream.allowComposeStream(
          ownerClient.ownStreamLocator(primitiveStreamId),
          ownerClient.ownStreamLocator(composedStreamId),
        );
        await waitForTxSuccess(tx, ownerClient);

        // Verify composed stream works when allowed
        const allowedRecords = await readerComposedStream.getRecord({
          stream: ownerClient.ownStreamLocator(composedStreamId),
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(allowedRecords.length).toBe(1);

        // Set composed stream read visibility to private
        tx = await composedStream.setReadVisibility(ownerClient.ownStreamLocator(composedStreamId), visibility.private);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader gets empty array when stream is private
        const result = await readerComposedStream.getRecord({
            stream: ownerClient.ownStreamLocator(composedStreamId),
            from: new Date("2024-01-01").getTime() / 1000,
            to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(result).toEqual([]);

        // Allow reader to access composed stream
        const readerAddress = new EthereumAddress(readerWallet.address);
        tx = await composedStream.allowReadWallet(ownerClient.ownStreamLocator(composedStreamId), readerAddress);
        await waitForTxSuccess(tx, ownerClient);

        // Verify reader can access when allowed
        const finalRecords = await readerComposedStream.getRecord({
          stream: ownerClient.ownStreamLocator(composedStreamId),
          from: new Date("2024-01-01").getTime() / 1000,
          to: new Date("2024-01-01").getTime() / 1000,
        });
        expect(finalRecords.length).toBe(1);
      } finally {
        await ownerClient.destroyStream({ streamId: primitiveStreamId, dataProvider: ownerClient.address() }, true).catch((e) => {
          console.log("Failed to destroy primitive stream", e);
        });
        await ownerClient.destroyStream({ streamId: composedStreamId, dataProvider: ownerClient.address() }, true).catch((e) => {
          console.log("Failed to destroy composed stream", e);
        });
      }
    },
  );
});
