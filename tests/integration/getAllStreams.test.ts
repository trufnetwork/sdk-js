import { describe, expect } from "vitest";
import { StreamId } from "../../src/util/StreamId";
import { StreamType } from "../../src/contracts-api/contractValues";
import { testWithDefaultWallet, waitForTxSuccess } from "./utils";
import NodeTSNClient from "../../src/client/nodeClient";

describe.sequential("Get All Streams", { timeout: 90000 }, () => {
  testWithDefaultWallet.skipIf(process.env.CI)(
    "should list all streams",
    async ({ defaultClient }) => {
      await using disposables = new AsyncDisposableStack();

      // Create unique stream IDs
      const primitiveStreamId = await StreamId.generate("test-list-primitive");
      const composedStreamId = await StreamId.generate("test-list-composed");

      // Deploy streams and add them to the disposable stack
      disposables.defer(async () => {
        await defaultClient
          .destroyStream(primitiveStreamId, true)
          .catch((e) => {
            console.error(e);
          });
        await defaultClient.destroyStream(composedStreamId, true).catch((e) => {
          console.error(e);
        });
      });
      await createAndInitStream(
        defaultClient,
        primitiveStreamId,
        StreamType.Primitive,
      );
      await createAndInitStream(
        defaultClient,
        composedStreamId,
        StreamType.Composed,
      );

      // Get all streams
      const streams = await defaultClient.getAllStreams();

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
          .loadStream(foundPrimitive)
          .getType();
        expect(primitiveType).toBe(StreamType.Primitive);
      }

      if (foundComposed) {
        const composedType = await defaultClient
          .loadStream(foundComposed)
          .getType();
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
        await defaultClient.destroyStream(streamId, true);
      });
      await createAndInitStream(defaultClient, streamId, StreamType.Primitive);

      // Get streams for owner
      const streams = await defaultClient.getAllStreams(
        defaultClient.address(),
      );

      // Verify our test stream is in the list
      const found = streams.find(
        (s) => s.streamId.getId() === streamId.getId(),
      );
      expect(found).toBeDefined();

      // Verify stream belongs to owner
      if (found) {
        expect(found.dataProvider.getAddress()).toBe(
          defaultClient.address().getAddress(),
        );
      }
    },
  );
});

// Helper function to create and initialize a stream
async function createAndInitStream(
  client: NodeTSNClient,
  streamId: StreamId,
  type: StreamType,
) {
  await client.deployStream(streamId, type, true);
  const stream = client.loadStream({
    streamId,
    dataProvider: client.address(),
  });
  const tx = await stream.initializeStream();
  await waitForTxSuccess(tx, client);
  return stream;
}
