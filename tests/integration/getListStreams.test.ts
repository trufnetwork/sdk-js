import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { StreamType } from "../../src/contracts-api/contractValues";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";

describe.sequential("Get List Streams", { timeout: 90000 }, () => {
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

  testWithDefaultWallet.skipIf(process.env.CI)(
    "should list all streams",
    async ({ defaultClient }) => {
      await using disposables = new AsyncDisposableStack();

      // Create unique stream IDs
      const primitiveStreamId = await StreamId.generate("test-list-primitive");
      const composedStreamId = await StreamId.generate("test-list-composed");

      // Deploy streams and add them to the disposable stack
      disposables.defer(async () => {
        await defaultClient.destroyStream({ streamId: primitiveStreamId, dataProvider: defaultClient.address() }, true).catch((e) => {
            console.error(e);
          });
          await defaultClient.destroyStream({ streamId: composedStreamId, dataProvider: defaultClient.address() }, true).catch((e) => {
          console.error(e);
        });
      });
      await defaultClient.deployStream(primitiveStreamId, StreamType.Primitive, true);
      await defaultClient.deployStream(composedStreamId, StreamType.Composed, true);

      // Get all streams
      const streams = await defaultClient.getListStreams({ blockHeight: 0 });

      // Verify streams are listed
      expect(streams.length).toBeGreaterThan(1);

      // Find our test streams in the list
      const foundPrimitive = streams.find(
        (s) => s.streamId.getId() === primitiveStreamId.getId(),
      );
      const foundComposed = streams.find(
        (s) => s.streamId.getId() === composedStreamId.getId(),
      );

      expect(foundPrimitive).toBeDefined();
      expect(foundComposed).toBeDefined();

      // Verify stream types
      if (foundPrimitive) {
        const primitiveType = await defaultClient
          .loadAction()
          .getType(foundPrimitive);
        expect(primitiveType).toBe(StreamType.Primitive);
      }

      if (foundComposed) {
        const composedType = await defaultClient
          .loadAction()
          .getType(foundComposed);
        expect(composedType).toBe(StreamType.Composed);
      }
    },
  );

  testWithDefaultWallet.skipIf(process.env.CI)(
    "should list streams for specific owner",
    async ({ defaultClient }) => {
      await using disposables = new AsyncDisposableStack();

      const streamId = await StreamId.generate("test-list-owner");
      disposables.defer(async () => {
        await defaultClient.destroyStream({ streamId, dataProvider: defaultClient.address() }, true);
      });
      await defaultClient.deployStream(streamId, StreamType.Primitive, true);

      // Get streams for owner
      const streams = await defaultClient.getListStreams(
          { dataProvider: defaultClient.address().getAddress(), blockHeight: 0 },
      );

      // Verify our test stream is in the list
      const found = streams.find(
        (s) => s.streamId.getId() === streamId.getId(),
      );
      expect(found).toBeDefined();

      // Verify stream belongs to owner
      if (found) {
        expect(found.dataProvider.getAddress().toLowerCase()).toBe(
          defaultClient.address().getAddress().toLowerCase(),
        );
      }
    },
  );
});