import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalActions } from "./localActions";
import { StreamType } from "./contractValues";

// Mock AdminClient — vitest mock that captures calls
type MockAdminClient = {
  callMethod: ReturnType<typeof vi.fn>;
};

function makeMockAdmin(returnValue: unknown = null): MockAdminClient {
  return {
    callMethod: vi.fn().mockResolvedValue(returnValue),
  };
}

describe("LocalActions", () => {
  describe("constructor", () => {
    it("throws when admin client is not provided", () => {
      expect(() => new LocalActions(undefined as any)).toThrow(
        "AdminClient is required"
      );
    });

    it("throws when admin client is null", () => {
      expect(() => new LocalActions(null as any)).toThrow(
        "AdminClient is required"
      );
    });

    it("constructs successfully with a valid admin client", () => {
      const admin = makeMockAdmin();
      const local = new LocalActions(admin as any);
      expect(local).toBeInstanceOf(LocalActions);
    });
  });

  describe("createStream", () => {
    let admin: MockAdminClient;
    let local: LocalActions;

    beforeEach(() => {
      admin = makeMockAdmin();
      local = new LocalActions(admin as any);
    });

    it("calls local.create_stream with the right wire shape", async () => {
      await local.createStream({
        streamId: "st1234567890abcdef1234567890abcd",
        streamType: StreamType.Primitive,
      });

      expect(admin.callMethod).toHaveBeenCalledWith("local.create_stream", {
        stream_id: "st1234567890abcdef1234567890abcd",
        stream_type: "primitive",
      });
    });

    it("does NOT include a data_provider field on the wire", async () => {
      await local.createStream({
        streamId: "st1234567890abcdef1234567890abcd",
        streamType: StreamType.Composed,
      });

      const params = admin.callMethod.mock.calls[0][1];
      expect(params).not.toHaveProperty("data_provider");
    });

    it("supports composed stream type", async () => {
      await local.createStream({
        streamId: "st1234567890abcdef1234567890abcd",
        streamType: StreamType.Composed,
      });

      expect(admin.callMethod).toHaveBeenCalledWith(
        "local.create_stream",
        expect.objectContaining({ stream_type: "composed" })
      );
    });

    it("propagates admin client errors", async () => {
      admin.callMethod.mockRejectedValueOnce(new Error("admin RPC failed"));

      await expect(
        local.createStream({
          streamId: "st1234567890abcdef1234567890abcd",
          streamType: StreamType.Primitive,
        })
      ).rejects.toThrow("admin RPC failed");
    });
  });

  describe("insertRecords", () => {
    let admin: MockAdminClient;
    let local: LocalActions;

    beforeEach(() => {
      admin = makeMockAdmin();
      local = new LocalActions(admin as any);
    });

    it("sends parallel arrays without data_provider", async () => {
      await local.insertRecords({
        streamId: ["st1", "st2"],
        eventTime: [1000, 2000],
        value: ["1.5", "2.5"],
      });

      const [method, params] = admin.callMethod.mock.calls[0];
      expect(method).toBe("local.insert_records");
      expect(params).toEqual({
        stream_id: ["st1", "st2"],
        event_time: [1000, 2000],
        value: ["1.5", "2.5"],
      });
      expect(params).not.toHaveProperty("data_provider");
    });

    it("throws when array lengths mismatch", async () => {
      await expect(
        local.insertRecords({
          streamId: ["st1", "st2"],
          eventTime: [1000],
          value: ["1.5", "2.5"],
        })
      ).rejects.toThrow(/array lengths mismatch/);

      expect(admin.callMethod).not.toHaveBeenCalled();
    });

    it("accepts empty arrays", async () => {
      await local.insertRecords({
        streamId: [],
        eventTime: [],
        value: [],
      });

      expect(admin.callMethod).toHaveBeenCalledWith("local.insert_records", {
        stream_id: [],
        event_time: [],
        value: [],
      });
    });
  });

  describe("insertTaxonomy", () => {
    let admin: MockAdminClient;
    let local: LocalActions;

    beforeEach(() => {
      admin = makeMockAdmin();
      local = new LocalActions(admin as any);
    });

    it("sends the right wire shape and omits child_data_providers", async () => {
      await local.insertTaxonomy({
        streamId: "stparent",
        childStreamIds: ["stchild1", "stchild2"],
        weights: ["0.5", "0.5"],
        startDate: 1000,
      });

      const [method, params] = admin.callMethod.mock.calls[0];
      expect(method).toBe("local.insert_taxonomy");
      expect(params).toEqual({
        stream_id: "stparent",
        child_stream_ids: ["stchild1", "stchild2"],
        weights: ["0.5", "0.5"],
        start_date: 1000,
      });
      expect(params).not.toHaveProperty("data_provider");
      expect(params).not.toHaveProperty("child_data_providers");
    });

    it("throws when child arrays mismatch", async () => {
      await expect(
        local.insertTaxonomy({
          streamId: "stparent",
          childStreamIds: ["stchild1", "stchild2"],
          weights: ["0.5"],
          startDate: 1000,
        })
      ).rejects.toThrow(/array lengths mismatch/);

      expect(admin.callMethod).not.toHaveBeenCalled();
    });
  });

  describe("getRecord", () => {
    let admin: MockAdminClient;
    let local: LocalActions;

    beforeEach(() => {
      admin = makeMockAdmin({ records: [] });
      local = new LocalActions(admin as any);
    });

    it("calls local.get_record with all bounds", async () => {
      await local.getRecord({
        streamId: "st1",
        fromTime: 1000,
        toTime: 2000,
      });

      expect(admin.callMethod).toHaveBeenCalledWith("local.get_record", {
        stream_id: "st1",
        from_time: 1000,
        to_time: 2000,
      });
    });

    it("omits undefined bounds from the wire (not sent as null)", async () => {
      await local.getRecord({ streamId: "st1" });

      const params = admin.callMethod.mock.calls[0][1];
      expect(params).toEqual({ stream_id: "st1" });
      expect(params).not.toHaveProperty("from_time");
      expect(params).not.toHaveProperty("to_time");
    });

    it("decodes wire format to camelCase", async () => {
      admin.callMethod.mockResolvedValueOnce({
        records: [
          { event_time: 1000, value: "1.5", created_at: 100 },
          { event_time: 2000, value: "2.5", created_at: 101 },
        ],
      });

      const records = await local.getRecord({ streamId: "st1" });

      expect(records).toEqual([
        { eventTime: 1000, value: "1.5", createdAt: 100 },
        { eventTime: 2000, value: "2.5", createdAt: 101 },
      ]);
    });

    it("returns empty array when records is null", async () => {
      admin.callMethod.mockResolvedValueOnce({ records: null });
      const records = await local.getRecord({ streamId: "st1" });
      expect(records).toEqual([]);
    });

    it("returns empty array when response is null", async () => {
      admin.callMethod.mockResolvedValueOnce(null);
      const records = await local.getRecord({ streamId: "st1" });
      expect(records).toEqual([]);
    });
  });

  describe("getIndex", () => {
    let admin: MockAdminClient;
    let local: LocalActions;

    beforeEach(() => {
      admin = makeMockAdmin({ records: [] });
      local = new LocalActions(admin as any);
    });

    it("includes baseTime when provided", async () => {
      await local.getIndex({
        streamId: "st1",
        fromTime: 1000,
        toTime: 2000,
        baseTime: 500,
      });

      expect(admin.callMethod).toHaveBeenCalledWith("local.get_index", {
        stream_id: "st1",
        from_time: 1000,
        to_time: 2000,
        base_time: 500,
      });
    });

    it("omits baseTime when undefined", async () => {
      await local.getIndex({ streamId: "st1" });

      const params = admin.callMethod.mock.calls[0][1];
      expect(params).not.toHaveProperty("base_time");
    });

    it("decodes wire format to camelCase", async () => {
      admin.callMethod.mockResolvedValueOnce({
        records: [{ event_time: 1000, value: "100" }],
      });

      const records = await local.getIndex({ streamId: "st1" });

      expect(records).toEqual([{ eventTime: 1000, value: "100" }]);
    });
  });

  describe("deleteStream", () => {
    it("sends only stream_id", async () => {
      const admin = makeMockAdmin();
      const local = new LocalActions(admin as any);

      await local.deleteStream({ streamId: "st1" });

      expect(admin.callMethod).toHaveBeenCalledWith("local.delete_stream", {
        stream_id: "st1",
      });
    });
  });

  describe("disableTaxonomy", () => {
    it("sends stream_id and group_sequence", async () => {
      const admin = makeMockAdmin();
      const local = new LocalActions(admin as any);

      await local.disableTaxonomy({ streamId: "st1", groupSequence: 3 });

      expect(admin.callMethod).toHaveBeenCalledWith("local.disable_taxonomy", {
        stream_id: "st1",
        group_sequence: 3,
      });
    });
  });

  describe("listStreams", () => {
    it("calls local.list_streams with empty params", async () => {
      const admin = makeMockAdmin({ streams: [] });
      const local = new LocalActions(admin as any);

      await local.listStreams();

      expect(admin.callMethod).toHaveBeenCalledWith("local.list_streams", {});
    });

    it("decodes wire format and preserves data_provider in response", async () => {
      const admin = makeMockAdmin({
        streams: [
          {
            data_provider: "0xabc",
            stream_id: "st1",
            stream_type: "primitive",
            created_at: 100,
          },
          {
            data_provider: "0xabc",
            stream_id: "st2",
            stream_type: "composed",
            created_at: 101,
          },
        ],
      });
      const local = new LocalActions(admin as any);

      const streams = await local.listStreams();

      expect(streams).toEqual([
        {
          dataProvider: "0xabc",
          streamId: "st1",
          streamType: "primitive",
          createdAt: 100,
        },
        {
          dataProvider: "0xabc",
          streamId: "st2",
          streamType: "composed",
          createdAt: 101,
        },
      ]);
    });

    it("returns empty array when streams is null", async () => {
      const admin = makeMockAdmin({ streams: null });
      const local = new LocalActions(admin as any);

      const streams = await local.listStreams();

      expect(streams).toEqual([]);
    });
  });
});
