import { describe, expect } from "vitest";
import NodeTSNClient from "../../src/client/nodeClient";
import { StreamId } from "../../src/util/StreamId";
import { testWithDefaultWallet } from "./utils";

describe.sequential(
  "ComposedStream Integration Tests",
  { timeout: 90000 },
  () => {
    // Skip in CI, because it needs a local node
    testWithDefaultWallet.skipIf(process.env.CI);

    testWithDefaultWallet(
      "should deploy, initialize and use a composed stream",
      async ({ defaultClient }) => {
        // Generate unique stream IDs for composed and child streams
        const composedStreamId = await StreamId.generate(
          "test-composed-stream",
        );
        const childAStreamId = await StreamId.generate(
          "test-composed-stream-child-a",
        );
        const childBStreamId = await StreamId.generate(
          "test-composed-stream-child-b",
        );

        const allStreamIds = [composedStreamId, childAStreamId, childBStreamId];

        try {
          // Deploy child streams with initial data
          // Child A: [2020-01-01: 1, 2020-01-02: 2, 2020-01-30: 3, 2020-02-01: 4, 2020-02-02: 5]
          await deployPrimitiveStreamWithData(defaultClient, childAStreamId, [
            { dateValue: "2020-01-01", value: "1" },
            { dateValue: "2020-01-02", value: "2" },
            { dateValue: "2020-01-30", value: "3" },
            { dateValue: "2020-02-01", value: "4" },
            { dateValue: "2020-02-02", value: "5" },
          ]);

          // Child B: [2020-01-01: 3, 2020-01-02: 4, 2020-01-30: 5, 2020-02-01: 6, 2020-02-02: 7]
          await deployPrimitiveStreamWithData(defaultClient, childBStreamId, [
            { dateValue: "2020-01-01", value: "3" },
            { dateValue: "2020-01-02", value: "4" },
            { dateValue: "2020-01-30", value: "5" },
            { dateValue: "2020-02-01", value: "6" },
            { dateValue: "2020-02-02", value: "7" },
          ]);

          // Deploy composed stream
          const deployReceipt = await defaultClient.deployStream(
            composedStreamId,
            "composed",
            true,
          );
          expect(deployReceipt.status).toBe(200);

          // Load the composed stream
          const composedStream = defaultClient.loadComposedStream({
            streamId: composedStreamId,
            dataProvider: defaultClient.address(),
          });

          // Initialize the composed stream
          const initTx = await composedStream.initializeStream();
          if (!initTx.data?.tx_hash) {
            throw new Error("Init tx hash not found");
          }
          await defaultClient.waitForTx(initTx.data.tx_hash);

          // Set taxonomy with weights
          // Child A weight: 1, Child B weight: 2
          const setTaxonomyTx = await composedStream.setTaxonomy({
            taxonomyItems: [
              {
                childStream: {
                  streamId: childAStreamId,
                  dataProvider: defaultClient.address(),
                },
                weight: "1",
              },
              {
                childStream: {
                  streamId: childBStreamId,
                  dataProvider: defaultClient.address(),
                },
                weight: "2",
              },
            ],
            startDate: "2020-01-30",
          });
          if (!setTaxonomyTx.data?.tx_hash) {
            throw new Error("Set taxonomy tx hash not found");
          }
          await defaultClient.waitForTx(setTaxonomyTx.data.tx_hash);

          // Verify taxonomies
          const taxonomies = await composedStream.describeTaxonomies({
            latestVersion: true,
          });
          expect(taxonomies.length).toBe(1);
          expect(taxonomies[0].startDate).toBe("2020-01-30");
          expect(taxonomies[0].taxonomyItems.length).toBe(2);

          // Query records after the taxonomy start date
          const records = await composedStream.getRecord({
            dateFrom: "2020-02-01",
            dateTo: "2020-02-02",
          });

          // Verify records
          // Formula: (value_A * weight_A + value_B * weight_B) / (weight_A + weight_B)
          // 2020-02-01: (4 * 1 + 6 * 2) / (1 + 2) = 5.333...
          // 2020-02-02: (5 * 1 + 7 * 2) / (1 + 2) = 6.333...
          expect(records.length).toBe(2);
          expect(parseFloat(records[0].value)).toBeCloseTo(5.333333, 5);
          expect(parseFloat(records[1].value)).toBeCloseTo(6.333333, 5);

          // Query index values
          const index = await composedStream.getIndex({
            dateFrom: "2020-01-30",
            dateTo: "2020-02-01",
            baseDate: "2020-01-30",
          });

          // Verify index values
          expect(index.length).toBe(2);
          expect(parseFloat(index[0].value)).toBe(100); // Base date is always 100
          expect(parseFloat(index[1].value)).toBeCloseTo(124.444444, 5); // Percentage change from base date

          // Query first record
          const firstRecord = await composedStream.getFirstRecord({});
          expect(firstRecord).not.toBeNull();
          expect(parseFloat(firstRecord!.value)).toBeCloseTo(2.333333, 5);
          expect(firstRecord!.dateValue).toBe("2020-01-01");
        } finally {
          // Cleanup: destroy all streams
          await Promise.allSettled(
            allStreamIds.map((streamId) =>
              defaultClient.destroyStream(streamId, true).catch(() => {}),
            ),
          );
        }
      },
    );
  },
);

// Helper function to deploy and initialize a primitive stream with data
async function deployPrimitiveStreamWithData(
  client: NodeTSNClient,
  streamId: StreamId,
  data: { dateValue: string; value: string }[],
) {
  // Deploy primitive stream
  const deployReceipt = await client.deployStream(streamId, "primitive", true);
  expect(deployReceipt.status).toBe(200);

  // Load and initialize the stream
  const primitiveStream = client.loadPrimitiveStream({
    streamId,
    dataProvider: client.address(),
  });

  const initTx = await primitiveStream.initializeStream();
  if (!initTx.data?.tx_hash) {
    throw new Error("Init tx hash not found");
  }
  await client.waitForTx(initTx.data.tx_hash);

  // Insert records
  const insertTx = await primitiveStream.insertRecords(data);
  if (!insertTx.data?.tx_hash) {
    throw new Error("Insert tx hash not found");
  }
  await client.waitForTx(insertTx.data.tx_hash);
}
