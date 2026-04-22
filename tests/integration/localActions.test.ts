import { describe, expect } from "vitest";
import { AdminClient } from "@trufnetwork/kwil-js";

import { LocalActions } from "../../src/contracts-api/localActions";
import { StreamType } from "../../src/contracts-api/contractValues";
import { StreamId } from "../../src/util/StreamId";
import { setupTrufNetwork, TEST_ADMIN_URL } from "./trufnetwork.setup";
import { testWithDefaultWallet } from "./utils";

// The container starts with `--autogen`, which generates a fresh secp256k1
// node key on every run. tn_local derives the data_provider from that key,
// so we can only assert the wire format (lowercase 0x + 40 hex chars), not
// a specific address.
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

async function safeDelete(local: LocalActions, streamId: StreamId): Promise<void> {
  try {
    await local.deleteStream({ streamId: streamId.getId() });
  } catch {
    // best-effort cleanup
  }
}

describe.sequential(
  "LocalActions Integration Tests",
  { timeout: 360000 },
  () => {
    setupTrufNetwork();

    testWithDefaultWallet(
      "creates a primitive stream, lists it, and cleans up",
      async ({ defaultClient }) => {
        const local = defaultClient.loadLocalActions({
          adminProvider: TEST_ADMIN_URL,
        });
        const streamId = await StreamId.generate("local-create-list-primitive");

        try {
          await local.createStream({
            streamId: streamId.getId(),
            streamType: StreamType.Primitive,
          });

          const streams = await local.listStreams();
          const found = streams.find((s) => s.streamId === streamId.getId());
          expect(found).toBeDefined();
          expect(found?.streamType).toBe(StreamType.Primitive);
          // data_provider is server-derived (lowercased ethereum address from
          // the node's secp256k1 key) — assert format only.
          expect(found?.dataProvider).toMatch(ETH_ADDRESS_RE);
          expect(found?.createdAt).toBeGreaterThan(0);
        } finally {
          await safeDelete(local, streamId);
        }

        const after = await local.listStreams();
        expect(after.find((s) => s.streamId === streamId.getId())).toBeUndefined();
      },
    );

    testWithDefaultWallet(
      "inserts records and reads them back via get_record / get_index",
      async ({ defaultClient }) => {
        const local = defaultClient.loadLocalActions({
          adminProvider: TEST_ADMIN_URL,
        });
        const streamId = await StreamId.generate("local-insert-and-query");

        try {
          await local.createStream({
            streamId: streamId.getId(),
            streamType: StreamType.Primitive,
          });

          const eventTimes = [1700000000, 1700086400, 1700172800];
          const values = ["10.5", "11.0", "12.25"];

          await local.insertRecords({
            streamId: eventTimes.map(() => streamId.getId()),
            eventTime: eventTimes,
            value: values,
          });

          const records = await local.getRecord({
            streamId: streamId.getId(),
            fromTime: eventTimes[0],
            toTime: eventTimes[2],
          });

          expect(records.length).toBe(3);
          expect(records.map((r) => r.eventTime)).toEqual(eventTimes);
          // tn_local stores values as NUMERIC(36,18); compare numerically.
          expect(records.map((r) => Number(r.value))).toEqual(values.map(Number));
          // NOTE: get_record does not populate createdAt today (see
          // tn_local/db_query.go::resultSetToRecords — only EventTime/Value
          // are read). list_streams does populate it; assert there instead.

          // Index uses the earliest event_time as base when baseTime is omitted,
          // so the first index value must be 100.
          const index = await local.getIndex({
            streamId: streamId.getId(),
            fromTime: eventTimes[0],
            toTime: eventTimes[2],
          });

          expect(index.length).toBe(3);
          expect(Number(index[0].value)).toBeCloseTo(100, 5);
          expect(Number(index[2].value)).toBeGreaterThan(100);
        } finally {
          await safeDelete(local, streamId);
        }
      },
    );

    testWithDefaultWallet(
      "creates composed stream with taxonomy and disables it",
      async ({ defaultClient }) => {
        const local = defaultClient.loadLocalActions({
          adminProvider: TEST_ADMIN_URL,
        });
        const childA = await StreamId.generate("local-tax-child-a");
        const childB = await StreamId.generate("local-tax-child-b");
        const parent = await StreamId.generate("local-tax-parent");

        try {
          await local.createStream({
            streamId: childA.getId(),
            streamType: StreamType.Primitive,
          });
          await local.createStream({
            streamId: childB.getId(),
            streamType: StreamType.Primitive,
          });
          await local.createStream({
            streamId: parent.getId(),
            streamType: StreamType.Composed,
          });

          // Each child gets one record so the composed query has data.
          const t = 1700000000;
          await local.insertRecords({
            streamId: [childA.getId(), childB.getId()],
            eventTime: [t, t],
            value: ["100", "200"],
          });

          await local.insertTaxonomy({
            streamId: parent.getId(),
            childStreamIds: [childA.getId(), childB.getId()],
            weights: ["1", "1"],
            startDate: t,
          });

          // Composed read should now return one weighted-average record.
          const composedRecords = await local.getRecord({
            streamId: parent.getId(),
            fromTime: t,
            toTime: t,
          });
          expect(composedRecords.length).toBe(1);
          // Equal weights → average of 100 and 200 = 150.
          expect(Number(composedRecords[0].value)).toBeCloseTo(150, 5);

          // Disable the only taxonomy group (group_sequence=1 because it's
          // the first taxonomy ever inserted for this parent).
          await local.disableTaxonomy({
            streamId: parent.getId(),
            groupSequence: 1,
          });

          // After disabling, the composed read should be empty for the same range.
          const afterDisable = await local.getRecord({
            streamId: parent.getId(),
            fromTime: t,
            toTime: t,
          });
          expect(afterDisable.length).toBe(0);
        } finally {
          await safeDelete(local, parent);
          await safeDelete(local, childA);
          await safeDelete(local, childB);
        }
      },
    );

    testWithDefaultWallet(
      "delete_stream removes the stream from list_streams",
      async ({ defaultClient }) => {
        const local = defaultClient.loadLocalActions({
          adminProvider: TEST_ADMIN_URL,
        });
        const streamId = await StreamId.generate("local-delete-target");

        await local.createStream({
          streamId: streamId.getId(),
          streamType: StreamType.Primitive,
        });

        const before = await local.listStreams();
        expect(before.find((s) => s.streamId === streamId.getId())).toBeDefined();

        await local.deleteStream({ streamId: streamId.getId() });

        const after = await local.listStreams();
        expect(after.find((s) => s.streamId === streamId.getId())).toBeUndefined();
      },
    );

    testWithDefaultWallet(
      "standalone LocalActions (no TNClient) works against the admin server",
      async () => {
        // Verifies that consumers without a gateway signer can still use
        // LocalActions by constructing it directly.
        const admin = new AdminClient({ adminProvider: TEST_ADMIN_URL });
        const local = new LocalActions(admin);
        const streamId = await StreamId.generate("local-standalone-client");

        try {
          await local.createStream({
            streamId: streamId.getId(),
            streamType: StreamType.Primitive,
          });
          const streams = await local.listStreams();
          expect(
            streams.find((s) => s.streamId === streamId.getId()),
          ).toBeDefined();
        } finally {
          await safeDelete(local, streamId);
        }
      },
    );
  },
);
