import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { testWithDefaultWallet } from "./utils";

describe.sequential(
  "PrimitiveStream Integration Tests",
  { timeout: 30000 },
  () => {
    // Skip in CI, because it needs a local node
    testWithDefaultWallet.skipIf(process.env.CI);

    testWithDefaultWallet(
      "should deploy, initialize, write to, and read from a primitive stream",
      async ({ defaultClient }) => {
        // Generate a unique stream ID
        const streamId = await StreamId.generate("test-primitive-stream");

        try {
          // Deploy a primitive stream
          const deployReceipt = await defaultClient.deployStream(
            streamId,
            "primitive",
            true,
          );
          expect(deployReceipt.status).toBe(200);

          // Load the deployed stream
          const primitiveStream = defaultClient.loadPrimitiveStream({
            streamId,
            dataProvider: defaultClient.address(),
          });

          // Initialize the stream
          const initTx = await primitiveStream.initializeStream();
          if (!initTx.data?.tx_hash) {
            throw new Error("Init tx hash not found");
          }
          await defaultClient.waitForTx(initTx.data.tx_hash);

          // Insert a record
          const insertTx = await primitiveStream.insertRecords([
            { dateValue: "2020-01-01", value: "1" },
          ]);
          if (!insertTx.data?.tx_hash) {
            throw new Error("Insert tx hash not found");
          }
          await defaultClient.waitForTx(insertTx.data.tx_hash);

          // Query records
          const records = await primitiveStream.getRecord({
            dateFrom: "2020-01-01",
            dateTo: "2021-01-01",
          });

          // Verify record content
          expect(records.length).toBe(1);
          expect(records[0].value).toBe("1.000000000000000000");
          expect(records[0].dateValue).toBe("2020-01-01");

          // Query index
          const index = await primitiveStream.getIndex({
            dateFrom: "2020-01-01",
            dateTo: "2021-01-01",
          });

          // Verify index content
          expect(index.length).toBe(1);
          expect(index[0].value).toBe("100.000000000000000000");
          expect(index[0].dateValue).toBe("2020-01-01");

          // Query first record
          const firstRecord = await primitiveStream.getFirstRecord({});
          expect(firstRecord).not.toBeNull();
          expect(firstRecord?.value).toBe("1.000000000000000000");
          expect(firstRecord?.dateValue).toBe("2020-01-01");
        } finally {
          // Cleanup: destroy the stream after test
          await defaultClient.destroyStream(streamId, true);
        }
      },
    );
  },
);
