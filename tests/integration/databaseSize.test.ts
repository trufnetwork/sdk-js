import { describe, expect } from "vitest";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import { StreamId } from "../../src/util/StreamId";

describe.sequential("Get Database Size", { timeout: 90000 }, () => {
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
});