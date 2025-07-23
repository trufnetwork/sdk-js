import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import { InsertRecordInput, StreamRecord } from "../../src";

/**
 * Deprecated API Tests
 * 
 * This file tests the backward compatibility of the deprecated method signatures.
 * These tests ensure that existing code using the old API continues to work.
 * 
 * DEPRECATED: The methods tested here use the old object-based parameter format.
 * New code should use the cache-aware API demonstrated in other test files.
 */
describe.sequential(
  "Deprecated API Backward Compatibility Tests",
  { timeout: 60000 },
  () => {
    // Spin up/tear down the local TN+Postgres containers once for this suite.
    setupTrufNetwork();

    testWithDefaultWallet(
      "should support deprecated getRecord API",
      async ({ defaultClient }) => {
        const streamId = await StreamId.generate("test-deprecated-get-record");

        try {
          // Deploy and initialize stream
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert test data
          const insertTx = await primitiveStream.insertRecord({
            stream: { streamId, dataProvider: defaultClient.address() },
            eventTime: new Date("2023-06-01").getTime() / 1000,
            value: "42"
          });
          await defaultClient.waitForTx(insertTx.data!.tx_hash!);

          // Test deprecated API - returns StreamRecord[] directly
          const records: StreamRecord[] = await primitiveStream.getRecord({
            stream: {
              streamId,
              dataProvider: defaultClient.address(),
            },
            from: new Date("2023-01-01").getTime() / 1000,
            to: new Date("2023-12-31").getTime() / 1000,
          });

          // Verify it works
          expect(records).toBeInstanceOf(Array);
          expect(records.length).toBe(1);
          expect(records[0].value).toBe("42.000000000000000000");
          expect(Number(records[0].eventTime)).toBe(new Date("2023-06-01").getTime() / 1000);

        } finally {
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }
    );

    testWithDefaultWallet(
      "should support deprecated getIndex API",
      async ({ defaultClient }) => {
        const streamId = await StreamId.generate("test-deprecated-get-index");

        try {
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert test data
          const insertTx = await primitiveStream.insertRecord({
            stream: { streamId, dataProvider: defaultClient.address() },
            eventTime: new Date("2023-06-01").getTime() / 1000,
            value: "150"
          });
          await defaultClient.waitForTx(insertTx.data!.tx_hash!);

          // Test deprecated API
          const index: StreamRecord[] = await primitiveStream.getIndex({
            stream: {
              streamId,
              dataProvider: defaultClient.address(),
            },
            from: new Date("2023-01-01").getTime() / 1000,
            to: new Date("2023-12-31").getTime() / 1000,
            baseTime: new Date("2023-01-01").getTime() / 1000,
          });

          // Verify it works
          expect(index).toBeInstanceOf(Array);
          expect(index.length).toBe(1);
          expect(index[0].value).toBe("100.000000000000000000"); // Index value

        } finally {
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }
    );

    testWithDefaultWallet(
      "should support deprecated getFirstRecord API",
      async ({ defaultClient }) => {
        const streamId = await StreamId.generate("test-deprecated-get-first");

        try {
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert multiple records
          const records: InsertRecordInput[] = [
            { 
              stream: { streamId, dataProvider: defaultClient.address() }, 
              eventTime: new Date("2023-03-01").getTime() / 1000, 
              value: "10" 
            },
            { 
              stream: { streamId, dataProvider: defaultClient.address() }, 
              eventTime: new Date("2023-05-01").getTime() / 1000, 
              value: "20" 
            },
          ];
          const insertTx = await primitiveStream.insertRecords(records, true);
          await defaultClient.waitForTx(insertTx.data!.tx_hash!);

          // Test deprecated API
          const firstRecord: StreamRecord | null = await primitiveStream.getFirstRecord({
            stream: {
              streamId,
              dataProvider: defaultClient.address(),
            },
            after: new Date("2023-01-01").getTime() / 1000,
          });

          // Verify it works
          expect(firstRecord).not.toBeNull();
          expect(firstRecord!.value).toBe("10.000000000000000000");
          expect(Number(firstRecord!.eventTime)).toBe(new Date("2023-03-01").getTime() / 1000);

        } finally {
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }
    );

    testWithDefaultWallet(
      "should support deprecated getIndexChange API",
      async ({ defaultClient }) => {
        const streamId = await StreamId.generate("test-deprecated-index-change");

        try {
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert historical and current data
          const allRecords: InsertRecordInput[] = [
            // 2022 data
            { 
              stream: { streamId, dataProvider: defaultClient.address() }, 
              eventTime: new Date("2022-06-01").getTime() / 1000, 
              value: "100" 
            },
            // 2023 data
            { 
              stream: { streamId, dataProvider: defaultClient.address() }, 
              eventTime: new Date("2023-06-01").getTime() / 1000, 
              value: "125" 
            },
          ];
          const insertTx = await primitiveStream.insertRecords(allRecords, true);
          await defaultClient.waitForTx(insertTx.data!.tx_hash!);

          // Test deprecated API
          const changes: StreamRecord[] = await primitiveStream.getIndexChange({
            stream: {
              streamId,
              dataProvider: defaultClient.address(),
            },
            from: new Date("2023-01-01").getTime() / 1000,
            to: new Date("2023-12-31").getTime() / 1000,
            timeInterval: 365 * 24 * 60 * 60, // 1 year
            baseTime: new Date("2022-01-01").getTime() / 1000,
          });

          // Verify it works
          expect(changes).toBeInstanceOf(Array);
          expect(changes.length).toBe(1);
          // ((125 - 100) / 100) * 100 = 25%
          expect(parseFloat(changes[0].value)).toBe(25);

        } finally {
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }
    );

    testWithDefaultWallet(
      "should verify type differences between old and new APIs",
      async ({ defaultClient }) => {
        const streamId = await StreamId.generate("test-api-comparison");

        try {
          await defaultClient.deployStream(streamId, "primitive", true);
          const primitiveStream = defaultClient.loadPrimitiveAction();

          // Insert test data
          const insertTx = await primitiveStream.insertRecord({
            stream: { streamId, dataProvider: defaultClient.address() },
            eventTime: new Date("2023-06-01").getTime() / 1000,
            value: "100"
          });
          await defaultClient.waitForTx(insertTx.data!.tx_hash!);

          const queryParams = {
            from: new Date("2023-01-01").getTime() / 1000,
            to: new Date("2023-12-31").getTime() / 1000,
          };

          // Old API - returns StreamRecord[] directly
          const oldApiResult = await primitiveStream.getRecord({
            stream: { streamId, dataProvider: defaultClient.address() },
            ...queryParams
          });

          // New API - returns CacheAwareResponse<StreamRecord[]>
          const newApiResult = await primitiveStream.getRecord(
            { streamId, dataProvider: defaultClient.address() },
            queryParams
          );

          // Verify old API returns array directly
          expect(oldApiResult).toBeInstanceOf(Array);
          expect(oldApiResult[0]).toHaveProperty('eventTime');
          expect(oldApiResult[0]).toHaveProperty('value');

          // Verify new API returns wrapped response
          expect(newApiResult).toHaveProperty('data');
          expect(newApiResult).toHaveProperty('cache');
          expect(newApiResult).toHaveProperty('logs');
          expect(newApiResult.data).toBeInstanceOf(Array);

          // Both should have the same data
          expect(oldApiResult).toEqual(newApiResult.data);

        } finally {
          await defaultClient.destroyStream({
            streamId,
            dataProvider: defaultClient.address(),
          }, true);
        }
      }
    );
  }
);