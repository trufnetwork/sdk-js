import { describe, expect } from "vitest";
import NodeTNClient from "../../src/client/nodeClient";
import { StreamId } from "../../src/util/StreamId";
import { testWithDefaultWallet } from "./utils";
import {InsertRecordInput} from "../../src";

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

        // Drop the stream if it already exists
        for (const streamId of allStreamIds) {
          await defaultClient.destroyStream(
              { streamId, dataProvider: defaultClient.address() }
              , true).catch(() => {});
        }

        try {
          // Deploy child streams with initial data
          // Child A: [2020-01-01: 1, 2020-01-02: 2, 2020-01-30: 3, 2020-02-01: 4, 2020-02-02: 5]
          await deployPrimitiveStreamWithData(defaultClient, childAStreamId, [
            { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-01").getTime() / 1000, value: "1.000000000000000000" },
            { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-02").getTime() / 1000, value: "2.000000000000000000" },
            { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-30").getTime() / 1000, value: "3.000000000000000000" },
            { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-02-01").getTime() / 1000, value: "4.000000000000000000" },
            { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-02-02").getTime() / 1000, value: "5.000000000000000000" },
          ]);

          // Child B: [2020-01-01: 3, 2020-01-02: 4, 2020-01-30: 5, 2020-02-01: 6, 2020-02-02: 7]
          await deployPrimitiveStreamWithData(defaultClient, childBStreamId, [
            { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-01").getTime() / 1000, value: "3.000000000000000000" },
            { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-02").getTime() / 1000, value: "4.000000000000000000" },
            { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-01-30").getTime() / 1000, value: "5.000000000000000000" },
            { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-02-01").getTime() / 1000, value: "6.000000000000000000" },
            { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: new Date("2020-02-02").getTime() / 1000, value: "7.000000000000000000" },
          ]);

          // Deploy composed stream
          const deployReceipt = await defaultClient.deployStream(
            composedStreamId,
            "composed",
            true,
          );
          expect(deployReceipt.status).toBe(200);

          // Load the composed stream
          const composedStream = defaultClient.loadComposedAction();

          // Set taxonomy with weights
          // Child A weight: 1, Child B weight: 2
          const setTaxonomyTx = await composedStream.setTaxonomy({
            stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
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
            startDate: new Date("2020-01-30").getTime() / 1000,
          });
          if (!setTaxonomyTx.data?.tx_hash) {
            throw new Error("Set taxonomy tx hash not found");
          }
          await defaultClient.waitForTx(setTaxonomyTx.data.tx_hash);

          // Verify taxonomies
          const taxonomies = await composedStream.describeTaxonomies({
            stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
            latestGroupSequence: true,
          });
          expect(taxonomies.length).toBe(1);
            expect(taxonomies[0].startDate).toBe(new Date("2020-01-30").getTime() / 1000);
          expect(taxonomies[0].taxonomyItems.length).toBe(2);

          // Query records after the taxonomy start date
          const records = await composedStream.getRecord({
            stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
            from: new Date("2020-02-01").getTime() / 1000,
            to: new Date("2020-02-02").getTime() / 1000,
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
            stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
            from: new Date("2020-01-30").getTime() / 1000,
            to: new Date("2020-02-01").getTime() / 1000,
            baseTime: new Date("2020-01-30").getTime() / 1000,
          });

          // Verify index values
          expect(index.length).toBe(2);
          expect(parseFloat(index[0].value)).toBe(100); // Base date is always 100
          expect(parseFloat(index[1].value)).toBeCloseTo(124.444444, 5); // Percentage change from base date

          // TODO: get first record is broken
          // Need to change the logic of get_first_record_composed in the node repository
          // Currently it tries to fetch with get_record_composed that have from and to lower than the "champion" of earliest event time

          return;

          // Query first record
          const firstRecord = await composedStream.getFirstRecord({
            stream: { streamId: composedStreamId, dataProvider: defaultClient.address()}
          })
          expect(firstRecord).not.toBeNull();
          expect(parseFloat(firstRecord!.value)).toBeCloseTo(2.333333, 5);
          expect(Number(firstRecord!.eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);
        } finally {
          // Cleanup: destroy all streams
          for (const streamId of allStreamIds) {
            await defaultClient.destroyStream({ streamId, dataProvider: defaultClient.address() }, true).catch(() => {});
          }
        }
      },
    );

    testWithDefaultWallet(
        "should deploy, initialize and use a composed stream with contract version 2",
        async ({ defaultClient }) => {
          // Generate unique stream IDs for composed and child streams
          const composedStreamId = await StreamId.generate(
              "test-composed-stream-v2",
          );
          const childAStreamId = await StreamId.generate(
              "test-composed-stream-child-a-v2",
          );
          const childBStreamId = await StreamId.generate(
              "test-composed-stream-child-b-v2",
          );

          const allStreamIds = [composedStreamId, childAStreamId, childBStreamId];

          // Drop the stream if it already exists
          for (const streamId of allStreamIds) {
              await defaultClient.destroyStream({ streamId, dataProvider: defaultClient.address() }, true).catch(() => {});
          }

          try {
            // Deploy child streams with initial data
            // Child A: [1: 1, 2: 2, 3: 3, 4: 4, 5: 5]
            await deployPrimitiveStreamWithData(defaultClient, childAStreamId, [
              { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: 1, value: "1.000000000000000000" },
              { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: 2, value: "2.000000000000000000" },
              { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: 3, value: "3.000000000000000000" },
              { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: 4, value: "4.000000000000000000" },
              { stream: {streamId: childAStreamId, dataProvider: defaultClient.address()}, eventTime: 5, value: "5.000000000000000000" },
            ]);

            // Child B: [1: 3, 2: 4, 3: 5, 4: 6, 5: 7]
            await deployPrimitiveStreamWithData(defaultClient, childBStreamId, [
              { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: 1, value: "3.000000000000000000" },
              { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: 2, value: "4.000000000000000000" },
              { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: 3, value: "5.000000000000000000" },
              { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: 4, value: "6.000000000000000000" },
              { stream: {streamId: childBStreamId, dataProvider: defaultClient.address()}, eventTime: 5, value: "7.000000000000000000" },
            ]);

            // Deploy composed stream
            const deployReceipt = await defaultClient.deployStream(
                composedStreamId,
                "composed",
                true,
            );
            expect(deployReceipt.status).toBe(200);

            // Load the composed stream
            const composedStream = defaultClient.loadComposedAction();

            // Set taxonomy with weights
            // Child A weight: 1, Child B weight: 2
            const setTaxonomyTx = await composedStream.setTaxonomy({
              stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
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
              startDate: 3,
            });
            if (!setTaxonomyTx.data?.tx_hash) {
              throw new Error("Set taxonomy tx hash not found");
            }
            await defaultClient.waitForTx(setTaxonomyTx.data.tx_hash);

            // Verify taxonomies
            const taxonomies = await composedStream.describeTaxonomies({
              stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
              latestGroupSequence: true,
            });
            expect(taxonomies.length).toBe(1);
            expect(taxonomies[0].startDate).toBe(3);
            expect(taxonomies[0].taxonomyItems.length).toBe(2);

            // Query records after the taxonomy start date
            const records = await composedStream.getRecord({
              stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
              from: 4,
              to: 5,
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
              stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
              from: 3,
              to: 4,
              baseTime: 3,
            });

            // Verify index values
            expect(index.length).toBe(2);
            expect(parseFloat(index[0].value)).toBe(100); // Base date is always 100
            expect(parseFloat(index[1].value)).toBeCloseTo(124.444444, 5); // Percentage change from base date

            // TODO: get first record is broken
            // Need to change the logic of get_first_record_composed in the node repository
            // Currently it tries to fetch with get_record_composed that have from and to lower than the "champion" of earliest event time
            return;

            // Query first record
            const firstRecord = await composedStream.getFirstRecord({
                stream: { streamId: composedStreamId, dataProvider: defaultClient.address() },
            });
            expect(firstRecord).not.toBeNull();
            expect(parseFloat(firstRecord!.value)).toBeCloseTo(2.333333, 5);
            expect(firstRecord!.eventTime).toBe(1);
          } finally {
            // Cleanup: destroy all streams
            for (const streamId of allStreamIds) {
              await defaultClient.destroyStream({ streamId, dataProvider: defaultClient.address() }, true).catch(() => {});
            }
          }
        },
    );
  },
);

// Helper function to deploy and initialize a primitive stream with data
async function deployPrimitiveStreamWithData(
  client: NodeTNClient,
  streamId: StreamId,
  data: InsertRecordInput[],
) {
  // Deploy primitive stream
  const deployReceipt = await client.deployStream(streamId, "primitive", true);
  expect(deployReceipt.status).toBe(200);

  // Load the stream
  const primitiveStream = client.loadPrimitiveAction();

  // Insert records
  const insertTx = await primitiveStream.insertRecords(data, true)
  if (!insertTx.data?.tx_hash) {
    throw new Error("Insert tx hash not found");
  }
  await client.waitForTx(insertTx.data.tx_hash);
}
