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

          // TODO: complete the test.
          return;

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
          await defaultClient.waitForTx(initTx.data?.tx_hash!);

          // Insert a record
          const insertTx = await primitiveStream.insertRecords([
            { dateValue: "2020-01-01", value: "1" },
          ]);
          if (!insertTx.data?.tx_hash) {
            throw new Error("Insert tx hash not found");
          }
          await defaultClient.waitForTx(insertTx.data?.tx_hash!);

          // Query records
          const records = await primitiveStream.getRecord({
            dateFrom: "2020-01-01",
            dateTo: "2021-01-01",
          });

          // Verify record content
          expect(records.length).toBe(1);
          expect(records[0].value).toBe("1.000000000000000000");
          expect(records[0].dateValue).toBe("2020-01-01");

          // Use Custom Procedure with the same name "get_record"
          const customRecords = await primitiveStream.customGetProcedure(
            "get_record",
            {
              dateFrom: "2020-01-01",
              dateTo: "2021-01-01",
            },
          );

          // Verify record content from the custom procedure
          expect(customRecords.length).toBe(1);
          expect(customRecords[0].value).toBe("1.000000000000000000");
          expect(customRecords[0].dateValue).toBe("2020-01-01");

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

          // Query using custom procedure with args with the same name "get_record"
          const customRecordsWithArgs = await primitiveStream.customProcedureWithArgs(
              "get_record",
              {
                $date_from: "2020-01-01",
                $date_to: "2021-01-01",
                $frozen_at: null,
              },
          );
          // Verify record content from the custom procedure
          expect(customRecordsWithArgs.length).toBe(1);
          expect(customRecordsWithArgs[0].value).toBe("1.000000000000000000");
          expect(customRecordsWithArgs[0].dateValue).toBe("2020-01-01");
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
        // TODO: complete the test.
        return;

        // Generate a unique stream ID
        const streamId = await StreamId.generate("test-primitive-stream");

        try {
          // Deploy and initialize stream
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveStream({
            streamId,
            dataProvider: defaultClient.address(),
          });
          const initTx = await primitiveStream.initializeStream();
          await defaultClient.waitForTx(initTx.data!.tx_hash!);

          // Insert historical records (2022)
          const historicalRecords = [
            { dateValue: "2022-01-01", value: "100" },
            { dateValue: "2022-06-01", value: "120" },
            { dateValue: "2022-12-01", value: "150" },
          ];
          const historicalTx =
            await primitiveStream.insertRecords(historicalRecords);
          await defaultClient.waitForTx(historicalTx.data!.tx_hash!);

          // Insert current records (2023)
          const currentRecords = [
            { dateValue: "2023-01-01", value: "200" },
            { dateValue: "2023-06-01", value: "180" },
            { dateValue: "2023-12-01", value: "240" },
          ];
          const currentTx = await primitiveStream.insertRecords(currentRecords);
          await defaultClient.waitForTx(currentTx.data!.tx_hash!);

          // Calculate year-over-year changes
          const changes = await primitiveStream.getIndexChange({
            dateFrom: "2023-01-01",
            dateTo: "2023-12-31",
            daysInterval: 365,
            baseDate: "2022-01-01",
          });

          // Verify the changes
          expect(changes.length).toBe(3);

          // 2023-01-01 vs 2022-01-01: ((200 - 100) / 100) * 100 = 100%
          expect(changes[0].dateValue).toBe("2023-01-01");
          expect(parseFloat(changes[0].value)).toBeCloseTo(100);

          // 2023-06-01 vs 2022-06-01: ((180 - 120) / 120) * 100 = 50%
          expect(changes[1].dateValue).toBe("2023-06-01");
          expect(parseFloat(changes[1].value)).toBeCloseTo(50);

          // 2023-12-01 vs 2022-12-01: ((240 - 150) / 150) * 100 = 60%
          expect(changes[2].dateValue).toBe("2023-12-01");
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
          // TODO: complete the test.
          return;

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
            const primitiveStream = defaultClient.loadPrimitiveStream({
              streamId,
              dataProvider: defaultClient.address(),
            });

            // Initialize the stream
            const initTx = await primitiveStream.initializeStream();
            if (!initTx.data?.tx_hash) {
              throw new Error("Init tx hash not found");
            }
            await defaultClient.waitForTx(initTx.data?.tx_hash!);

            // Insert a record
            const insertTx = await primitiveStream.insertRecords([
              { dateValue: 1, value: "1" },
            ]);
            if (!insertTx.data?.tx_hash) {
              throw new Error("Insert tx hash not found");
            }
            await defaultClient.waitForTx(insertTx.data?.tx_hash!);

            // Query records
            const records = await primitiveStream.getRecord({
              dateFrom: 1,
              dateTo: 1,
            });

            // Verify record content
            expect(records.length).toBe(1);
            expect(records[0].value).toBe("1.000000000000000000");
            expect(records[0].dateValue).toBe(1);

            // Use Custom Procedure with the same name "get_record"
            const customRecords = await primitiveStream.customGetProcedure(
                "get_record",
                {
                  dateFrom: 1,
                  dateTo: 1,
                },
            );

            // Verify record content from the custom procedure
            expect(customRecords.length).toBe(1);
            expect(customRecords[0].value).toBe("1.000000000000000000");
            expect(customRecords[0].dateValue).toBe(1);

            // Query index
            const index = await primitiveStream.getIndex({
              dateFrom: 1,
              dateTo: 1,
            });

            // Verify index content
            expect(index.length).toBe(1);
            expect(index[0].value).toBe("100.000000000000000000");
            expect(index[0].dateValue).toBe(1);

            // Query first record
            const firstRecord = await primitiveStream.getFirstRecord({});
            expect(firstRecord).not.toBeNull();
            expect(firstRecord?.value).toBe("1.000000000000000000");
            expect(firstRecord?.dateValue).toBe(1);
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
