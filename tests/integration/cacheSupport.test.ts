import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import { InsertRecordInput, StreamRecord, StreamLocator } from "../../src";
import { NodeTNClient } from "../../src/client/nodeClient";
import { PrimitiveAction } from "../../src/contracts-api/primitiveAction";
import { CacheAwareResponse } from "../../src/types/cache";

describe.sequential(
  "Cache Support E2E Tests",
  { timeout: 60000 },
  () => {
    // Spin up/tear down the local TN+Postgres containers once for this suite.
    setupTrufNetwork();

    // Helper: Deploy stream and return cleanup function
    async function setupTestStream(
      client: NodeTNClient, 
      prefix: string
    ): Promise<{ streamId: StreamId; locator: StreamLocator; cleanup: () => Promise<void> }> {
      const streamId = await StreamId.generate(`test-cache-${prefix}`);
      await client.deployStream(streamId, "primitive", true);
      
      const locator: StreamLocator = {
        streamId,
        dataProvider: client.address()
      };
      
      const cleanup = async () => {
        await client.destroyStream(locator, true);
      };
      
      return { streamId, locator, cleanup };
    }

    // Helper: Insert test data
    async function insertTestRecords(
      client: NodeTNClient,
      primitiveStream: PrimitiveAction,
      locator: StreamLocator,
      data: Array<{ date: string; value: string }>
    ): Promise<void> {
      const records: InsertRecordInput[] = data.map(({ date, value }) => ({
        stream: locator,
        eventTime: new Date(date).getTime() / 1000,
        value
      }));
      
      const tx = await primitiveStream.insertRecords(records, true);
      await client.waitForTx(tx.data!.tx_hash!);
    }

    // Helper: Validate cache response structure
    function expectCacheResponse<T>(response: CacheAwareResponse<T>) {
      expect(response).toHaveProperty('data');
      expect(response).toHaveProperty('cache');
      expect(response).toHaveProperty('logs');
      
      if (response.cache) {
        expect(response.cache).toHaveProperty('hit');
        // at these tests, we won't have a cache hit as we don't set the cache, but here we're prepared for it
        if (response.cache.hit) {
          expect(response.cache).toHaveProperty('height');
          expect(response.cache.height).toBeGreaterThan(0);
        } else {
          expect(response.cache.height).toBeUndefined();
        }
      } else {
        // If cache is undefined, perhaps expect it for certain tests, but for now, allow it
      }
    }

    // Helper: Create time range options
    function timeRange(fromDate: string, toDate: string) {
      return {
        from: new Date(fromDate).getTime() / 1000,
        to: new Date(toDate).getTime() / 1000
      };
    }

    // Test scenarios for different cache-aware methods
    const methodTests = [
      {
        name: "getRecord",
        test: async (client: NodeTNClient, locator: StreamLocator) => {
          const primitiveStream = client.loadPrimitiveAction();
          await insertTestRecords(client, primitiveStream, locator, [
            { date: "2023-01-01", value: "100" },
            { date: "2023-06-01", value: "200" }
          ]);

          const result = await primitiveStream.getRecord(locator, {
            ...timeRange("2023-01-01", "2023-12-31"),
            useCache: true
          });

          expectCacheResponse(result);
          expect(result.data).toHaveLength(2);
          expect(result.data[0].value).toBe("100.000000000000000000");
          expect(result.data[1].value).toBe("200.000000000000000000");
        }
      },
      {
        name: "getIndex",
        test: async (client: NodeTNClient, locator: StreamLocator) => {
          const primitiveStream = client.loadPrimitiveAction();
          await insertTestRecords(client, primitiveStream, locator, [
            { date: "2023-03-15", value: "150" }
          ]);

          const result = await primitiveStream.getIndex(locator, {
            ...timeRange("2023-01-01", "2023-12-31"),
            baseTime: new Date("2023-01-01").getTime() / 1000,
            useCache: true
          });

          expectCacheResponse(result);
          expect(result.data).toHaveLength(1);
          expect(result.data[0].value).toBe("100.000000000000000000");
        }
      },
      {
        name: "getFirstRecord",
        test: async (client: NodeTNClient, locator: StreamLocator) => {
          const primitiveStream = client.loadPrimitiveAction();
          await insertTestRecords(client, primitiveStream, locator, [
            { date: "2023-02-01", value: "50" },
            { date: "2023-04-01", value: "75" }
          ]);

          const result = await primitiveStream.getFirstRecord(locator, {
            after: new Date("2023-01-01").getTime() / 1000,
            useCache: true
          });

          expectCacheResponse(result);
          expect(result.data).not.toBeNull();
          expect(result.data?.value).toBe("50.000000000000000000");
        }
      },
      {
        name: "getIndexChange",
        test: async (client: NodeTNClient, locator: StreamLocator) => {
          const primitiveStream = client.loadPrimitiveAction();
          await insertTestRecords(client, primitiveStream, locator, [
            { date: "2022-01-15", value: "100" },
            { date: "2022-07-15", value: "110" },
            { date: "2023-01-15", value: "120" },
            { date: "2023-07-15", value: "135" }
          ]);

          const result = await primitiveStream.getIndexChange(locator, {
            ...timeRange("2023-01-01", "2023-12-31"),
            timeInterval: 365 * 24 * 60 * 60,
            baseTime: new Date("2022-01-01").getTime() / 1000,
            useCache: true
          });

          expectCacheResponse(result);
          expect(result.data).toHaveLength(2);
          expect(parseFloat(result.data[0].value)).toBeCloseTo(20, 0);
          expect(parseFloat(result.data[1].value)).toBeCloseTo(22.73, 0);
        }
      }
    ];

    // Run all method tests
    methodTests.forEach(({ name, test }) => {
      testWithDefaultWallet(
        `should use cache-aware ${name}`,
        async ({ defaultClient }) => {
          const { locator, cleanup } = await setupTestStream(defaultClient, name);
          try {
            const primitiveStream = defaultClient.loadPrimitiveAction();
            await test(defaultClient, locator);
          } finally {
            await cleanup();
          }
        }
      );
    });

    // Validation error tests
    const validationTests = [
      {
        name: "invalid time range",
        options: { 
          from: new Date("2023-12-31").getTime() / 1000,
          to: new Date("2023-01-01").getTime() / 1000,
          useCache: true 
        },
        method: "getRecord",
        expectedError: "Invalid time range"
      },
      {
        name: "invalid cache parameter type",
        options: { useCache: "true" as any },
        method: "getRecord",
        expectedError: "Invalid useCache parameter"
      },
      {
        name: "missing timeInterval",
        options: {
          from: new Date("2023-01-01").getTime() / 1000,
          to: new Date("2023-12-31").getTime() / 1000,
          useCache: true
        } as any,
        method: "getIndexChange",
        expectedError: "Invalid timeInterval parameter"
      }
    ];

    testWithDefaultWallet(
      "should validate cache parameters",
      async ({ defaultClient }) => {
        const { locator, cleanup } = await setupTestStream(defaultClient, "validation");
        try {
          const primitiveStream = defaultClient.loadPrimitiveAction();
          
          for (const { name, options, method, expectedError } of validationTests) {
            await expect(
              (primitiveStream as any)[method](locator, options)
            ).rejects.toThrow(expectedError);
          }
        } finally {
          await cleanup();
        }
      }
    );

    testWithDefaultWallet(
      "should test cache hit/miss behavior",
      async ({ defaultClient }) => {
        const { locator, cleanup } = await setupTestStream(defaultClient, "hit-miss");
        try {
          const primitiveStream = defaultClient.loadPrimitiveAction();
          await insertTestRecords(defaultClient, primitiveStream, locator, [
            { date: "2023-05-15", value: "42" }
          ]);

          const options = {
            ...timeRange("2023-01-01", "2023-12-31"),
            useCache: true
          };

          // First call - potential cache miss
          const result1 = await primitiveStream.getRecord(locator, options);
          expectCacheResponse(result1);

          // Second call - potential cache hit
          const result2 = await primitiveStream.getRecord(locator, options);
          expectCacheResponse(result2);

          // Data should be identical
          expect(result2.data).toEqual(result1.data);

          // Test with cache disabled
          const result3 = await primitiveStream.getRecord(locator, {
            ...options,
            useCache: false
          });
          expectCacheResponse(result3);
          expect(result3.cache).toBeUndefined();
        } finally {
          await cleanup();
        }
      }
    );

    testWithDefaultWallet(
      "should maintain backward compatibility",
      async ({ defaultClient }) => {
        const { locator, cleanup } = await setupTestStream(defaultClient, "legacy");
        try {
          const primitiveStream = defaultClient.loadPrimitiveAction();
          await insertTestRecords(defaultClient, primitiveStream, locator, [
            { date: "2023-05-15", value: "42" }
          ]);

          const queryOptions = timeRange("2023-01-01", "2023-12-31");

          // Legacy API call
          const legacyRecords: StreamRecord[] = await primitiveStream.getRecord({
            stream: locator,
            ...queryOptions
          });

          // New cache-aware API call
          const cacheAwareResult = await primitiveStream.getRecord(locator, {
            ...queryOptions,
            useCache: false
          });

          // Both should return the same data
          expect(legacyRecords).toEqual(cacheAwareResult.data);
          expect(legacyRecords).toHaveLength(1);
          expect(legacyRecords[0].value).toBe("42.000000000000000000");

        } finally {
          await cleanup();
        }
      }
    );
  }
);