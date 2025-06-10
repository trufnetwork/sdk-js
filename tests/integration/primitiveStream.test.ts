import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import {InsertRecordInput} from "../../src";

describe.sequential(
  "PrimitiveStream Integration Tests",
  { timeout: 30000 },
  () => {
    // Spin up/tear down the local TN+Postgres containers once for this suite.
    setupTrufNetwork();

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
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert a record
          const insertTx = await primitiveStream.insertRecord({
                stream: {
                  streamId,
                  dataProvider: defaultClient.address(),
                },
                eventTime: new Date("2020-01-01").getTime() / 1000,
                value: "1"
              },
          );
          if (!insertTx.data?.tx_hash) {
            throw new Error("Insert tx hash not found");
          }
          await defaultClient.waitForTx(insertTx.data?.tx_hash!);

          // Query records
          const records = await primitiveStream.getRecord({
              stream: {
                  streamId,
                  dataProvider: defaultClient.address(),
              },
              from: new Date("2020-01-01").getTime() / 1000,
              to: new Date("2021-01-01").getTime() / 1000,
          });

          // Verify record content
          expect(records.length).toBe(1);
          expect(records[0].value).toBe("1.000000000000000000");
          expect(Number(records[0].eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);

          // Use Custom Procedure with the same name "get_record"
          const customRecords = await primitiveStream.customGetProcedure(
            "get_record",
            {
                stream: {
                    streamId,
                    dataProvider: defaultClient.address(),
                },
                from: new Date("2020-01-01").getTime() / 1000,
                to: new Date("2021-01-01").getTime() / 1000,
            },
          );

          // Verify record content from the custom procedure
          expect(customRecords.length).toBe(1);
          expect(customRecords[0].value).toBe("1.000000000000000000");
          expect(Number(customRecords[0].eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);

          // Query index
          const index = await primitiveStream.getIndex({
              stream: {
                streamId,
                dataProvider: defaultClient.address(),
            },
              from: new Date("2020-01-01").getTime() / 1000,
              to: new Date("2021-01-01").getTime() / 1000,
          });

          // Verify index content
          expect(index.length).toBe(1);
          expect(index[0].value).toBe("100.000000000000000000");
          expect(Number(index[0].eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);

          // Query first record
          const firstRecord = await primitiveStream.getFirstRecord({
            stream: {
              streamId,
              dataProvider: defaultClient.address(),
            },
          });
          expect(firstRecord).not.toBeNull();
          expect(firstRecord?.value).toBe("1.000000000000000000");
          expect(Number(firstRecord?.eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);

          // Query using custom procedure with args with the same name "get_record"
          const customRecordsWithArgs = await primitiveStream.customProcedureWithArgs(
              "get_record",
              {
                  $data_provider: defaultClient.address().getAddress(),
                  $stream_id: streamId.getId(),
                  $from: new Date("2020-01-01").getTime() / 1000,
                  $to: new Date("2021-01-01").getTime() / 1000,
                  $frozen_at: null,
              },
          );
          // Verify record content from the custom procedure
          expect(customRecordsWithArgs.length).toBe(1);
          expect(customRecordsWithArgs[0].value).toBe("1.000000000000000000");
          expect(Number(customRecordsWithArgs[0].eventTime)).toBe(new Date("2020-01-01").getTime() / 1000);
        } finally {
          // Cleanup: destroy the stream after test
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }, 60000,
    );

    testWithDefaultWallet(
      "should calculate index changes correctly",
      async ({ defaultClient }) => {
        // Generate a unique stream ID
        const streamId = await StreamId.generate("test-primitive-stream");

        try {
          // Deploy and initialize stream
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert historical records (2022)
          const historicalRecords: InsertRecordInput[] = [
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2022-01-01").getTime() / 1000, value: "100" },
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2022-06-01").getTime() / 1000, value: "120" },
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2022-12-01").getTime() / 1000, value: "150" },
          ];
          const historicalTx =
            await primitiveStream.insertRecords(historicalRecords, true);
          await defaultClient.waitForTx(historicalTx.data!.tx_hash!);

          // Insert current records (2023)
          const currentRecords: InsertRecordInput[] = [
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2023-01-01").getTime() / 1000, value: "200" },
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2023-06-01").getTime() / 1000, value: "180" },
            { stream: { streamId, dataProvider: defaultClient.address() }, eventTime: new Date("2023-12-01").getTime() / 1000, value: "240" },
          ];
          const currentTx = await primitiveStream.insertRecords(currentRecords, true);
          await defaultClient.waitForTx(currentTx.data!.tx_hash!);

          // Calculate year-over-year changes
          const changes = await primitiveStream.getIndexChange({
              stream: {
                  streamId,
                  dataProvider: defaultClient.address(),
              },
              from: new Date("2023-01-01").getTime() / 1000,
              to: new Date("2023-12-31").getTime() / 1000,
              timeInterval: 365 * 24 * 60 * 60,
              baseTime: new Date("2022-01-01").getTime() / 1000,
          });

          // Verify the changes
          expect(changes.length).toBe(3);

          // 2023-01-01 vs 2022-01-01: ((200 - 100) / 100) * 100 = 100%
          expect(Number(changes[0].eventTime)).toBe(new Date("2023-01-01").getTime() / 1000);
          expect(parseFloat(changes[0].value)).toBeCloseTo(100);

          // 2023-06-01 vs 2022-06-01: ((180 - 120) / 120) * 100 = 50%
          expect(Number(changes[1].eventTime)).toBe(new Date("2023-06-01").getTime() / 1000);
          expect(parseFloat(changes[1].value)).toBeCloseTo(50);

          // 2023-12-01 vs 2022-12-01: ((240 - 150) / 150) * 100 = 60%
          expect(Number(changes[2].eventTime)).toBe(new Date("2023-12-01").getTime() / 1000);
          expect(parseFloat(changes[2].value)).toBeCloseTo(60);
        } finally {
          // Cleanup
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }, 60000,
    );

    testWithDefaultWallet(
        "should deploy, initialize, write to, and read from a primitive stream version 2",
        async ({ defaultClient }) => {
          // Generate a unique stream ID
          const streamId = await StreamId.generate("test-primitive-stream-v2");

          // Destroy the stream if it already exists
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true).catch(() => {});

          try {
            // Deploy a primitive stream
            const deployReceipt = await defaultClient.deployStream(
                streamId,
                "primitive",
                true,
            );
            expect(deployReceipt.status).toBe(200);

            // Load the deployed stream
            const primitiveStream = defaultClient.loadPrimitiveAction();

            // Insert a record
            const insertTx = await primitiveStream.insertRecord(
                { stream: {streamId, dataProvider: defaultClient.address()}, eventTime: 1, value: "1"},
            );
            if (!insertTx.data?.tx_hash) {
              throw new Error("Insert tx hash not found");
            }
            await defaultClient.waitForTx(insertTx.data?.tx_hash!);

            // Query records
            const records = await primitiveStream.getRecord({
              stream: {
                  streamId,
                  dataProvider: defaultClient.address(),
              },
              from: 1,
              to: 1,
            });

            // Verify record content
            expect(records.length).toBe(1);
            expect(records[0].value).toBe("1.000000000000000000");
            expect(Number(records[0].eventTime)).toBe(1);

            // Use Custom Procedure with the same name "get_record"
            const customRecords = await primitiveStream.customGetProcedure(
                "get_record",
                {
                    stream: {
                        streamId,
                        dataProvider: defaultClient.address(),
                    },
                    from: 1,
                    to: 1,
                },
            );

            // Verify record content from the custom procedure
            expect(customRecords.length).toBe(1);
            expect(customRecords[0].value).toBe("1.000000000000000000");
            expect(Number(customRecords[0].eventTime)).toBe(1);

            // Query index
            const index = await primitiveStream.getIndex({
              stream: {
                  streamId,
                  dataProvider: defaultClient.address(),
              },
              from: 1,
              to: 1,
            });

            // Verify index content
            expect(index.length).toBe(1);
            expect(index[0].value).toBe("100.000000000000000000");
            expect(Number(index[0].eventTime)).toBe(1);

            // Query first record
            const firstRecord = await primitiveStream.getFirstRecord({
                stream: {
                    streamId,
                    dataProvider: defaultClient.address(),
                }
            });
            expect(firstRecord).not.toBeNull();
            expect(firstRecord?.value).toBe("1.000000000000000000");
            expect(Number(firstRecord?.eventTime)).toBe(1);
          } finally {
            // Cleanup: destroy the stream after test
            await defaultClient.destroyStream({
              streamId,
              dataProvider: defaultClient.address(),
            }, true);
          }
        }, 60000,
    );
  },
);
