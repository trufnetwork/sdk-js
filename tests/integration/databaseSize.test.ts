import { describe, expect } from "vitest";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import { StreamId } from "../../src/util/StreamId";

describe.sequential("Get Database Size", { timeout: 360000 }, () => {
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

  testWithDefaultWallet(
    "should get database size",
    async ({ defaultClient }) => {
      const actions = defaultClient.loadAction()
      // deploy some streams to ensure the database size is greater than 0
      const streamId1 = await StreamId.generate("test-primitive-stream-1");
      const streamId2 = await StreamId.generate("test-primitive-stream-2");
      const streamId3 = await StreamId.generate("test-primitive-stream-3");
      await defaultClient.deployStream(streamId1, "primitive", true)
      await defaultClient.deployStream(streamId2, "primitive", true)
      await defaultClient.deployStream(streamId3, "primitive", true)
      const databaseSize = await actions.getDatabaseSize()

      expect(databaseSize).toBeGreaterThan(0n)
    }
  )

  testWithDefaultWallet(
    "should get database size in human-readable format",
    async ({ defaultClient }) => {
      const actions = defaultClient.loadAction()
      const databaseSizePretty = await actions.getDatabaseSizePretty()

      expect(databaseSizePretty).toBeTruthy()
      expect(typeof databaseSizePretty).toBe("string")
      // Should contain a number followed by a unit (e.g., "22 GB", "1.5 MB")
      expect(databaseSizePretty).toMatch(/\d+.*\s*(bytes|kB|MB|GB|TB)/i)
    }
  )
});