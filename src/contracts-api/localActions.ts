import { AdminClient } from "@trufnetwork/kwil-js";
import { StreamType } from "./contractValues";
import type {
  ILocalActions,
  LocalCreateStreamInput,
  LocalInsertRecordsInput,
  LocalInsertTaxonomyInput,
  LocalGetRecordInput,
  LocalGetIndexInput,
  LocalDeleteStreamInput,
  LocalDisableTaxonomyInput,
  LocalRecordOutput,
  LocalIndexOutput,
  LocalStreamInfo,
} from "../types/localActions";

// ═══════════════════════════════════════════════════════════════
// WIRE TYPES (mirror node/extensions/tn_local/types.go)
// ═══════════════════════════════════════════════════════════════
//
// Defined here instead of imported from the node repo to avoid a
// circular dependency. They are deliberately small and change
// together with the server types — any schema drift will fail
// the round-trip tests.

interface WireCreateStreamRequest {
  stream_id: string;
  stream_type: string;
}

interface WireInsertRecordsRequest {
  stream_id: string[];
  event_time: number[];
  value: string[];
}

interface WireInsertTaxonomyRequest {
  stream_id: string;
  child_stream_ids: string[];
  weights: string[];
  start_date: number;
}

interface WireGetRecordRequest {
  stream_id: string;
  from_time?: number;
  to_time?: number;
}

interface WireGetIndexRequest {
  stream_id: string;
  from_time?: number;
  to_time?: number;
  base_time?: number;
}

interface WireDeleteStreamRequest {
  stream_id: string;
}

interface WireDisableTaxonomyRequest {
  stream_id: string;
  group_sequence: number;
}

interface WireRecordOutput {
  event_time: number;
  value: string;
  created_at: number;
}

interface WireGetRecordResponse {
  records: WireRecordOutput[] | null;
}

interface WireIndexOutput {
  event_time: number;
  value: string;
}

interface WireGetIndexResponse {
  records: WireIndexOutput[] | null;
}

interface WireStreamInfo {
  data_provider: string;
  stream_id: string;
  stream_type: string;
  created_at: number;
}

interface WireListStreamsResponse {
  streams: WireStreamInfo[] | null;
}

// ═══════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * LocalActions calls the `local.*` JSON-RPC methods on the kwil-db admin
 * server via the generic AdminClient from @trufnetwork/kwil-js.
 *
 * This class does NOT extend the existing Action base class — local
 * operations use a different transport (admin port) and auth model
 * (no gateway, no KwilSigner needed).
 *
 * Construction: use the static `create()` factory method, or pass an
 * AdminClient instance directly to the constructor.
 */
export class LocalActions implements ILocalActions {
  private readonly admin: AdminClient;

  constructor(admin: AdminClient) {
    if (!admin) {
      throw new Error("AdminClient is required for LocalActions");
    }
    this.admin = admin;
  }

  async createStream(input: LocalCreateStreamInput): Promise<void> {
    const req: WireCreateStreamRequest = {
      stream_id: input.streamId,
      stream_type: input.streamType,
    };
    await this.admin.callMethod("local.create_stream", req);
  }

  async insertRecords(input: LocalInsertRecordsInput): Promise<void> {
    if (
      input.streamId.length !== input.eventTime.length ||
      input.streamId.length !== input.value.length
    ) {
      throw new Error(
        `local.insert_records: array lengths mismatch ` +
          `(streamId=${input.streamId.length}, eventTime=${input.eventTime.length}, value=${input.value.length})`
      );
    }
    const req: WireInsertRecordsRequest = {
      stream_id: input.streamId,
      event_time: input.eventTime,
      value: input.value,
    };
    await this.admin.callMethod("local.insert_records", req);
  }

  async insertTaxonomy(input: LocalInsertTaxonomyInput): Promise<void> {
    if (input.childStreamIds.length !== input.weights.length) {
      throw new Error(
        `local.insert_taxonomy: array lengths mismatch ` +
          `(childStreamIds=${input.childStreamIds.length}, weights=${input.weights.length})`
      );
    }
    const req: WireInsertTaxonomyRequest = {
      stream_id: input.streamId,
      child_stream_ids: input.childStreamIds,
      weights: input.weights,
      start_date: input.startDate,
    };
    await this.admin.callMethod("local.insert_taxonomy", req);
  }

  async getRecord(input: LocalGetRecordInput): Promise<LocalRecordOutput[]> {
    const req: WireGetRecordRequest = {
      stream_id: input.streamId,
      ...(input.fromTime !== undefined && { from_time: input.fromTime }),
      ...(input.toTime !== undefined && { to_time: input.toTime }),
    };
    const res = await this.admin.callMethod<WireGetRecordResponse>(
      "local.get_record",
      req
    );
    if (!res?.records) {
      return [];
    }
    return res.records.map((r) => ({
      eventTime: r.event_time,
      value: r.value,
      createdAt: r.created_at,
    }));
  }

  async getIndex(input: LocalGetIndexInput): Promise<LocalIndexOutput[]> {
    const req: WireGetIndexRequest = {
      stream_id: input.streamId,
      ...(input.fromTime !== undefined && { from_time: input.fromTime }),
      ...(input.toTime !== undefined && { to_time: input.toTime }),
      ...(input.baseTime !== undefined && { base_time: input.baseTime }),
    };
    const res = await this.admin.callMethod<WireGetIndexResponse>(
      "local.get_index",
      req
    );
    if (!res?.records) {
      return [];
    }
    return res.records.map((r) => ({
      eventTime: r.event_time,
      value: r.value,
    }));
  }

  async deleteStream(input: LocalDeleteStreamInput): Promise<void> {
    const req: WireDeleteStreamRequest = {
      stream_id: input.streamId,
    };
    await this.admin.callMethod("local.delete_stream", req);
  }

  async disableTaxonomy(input: LocalDisableTaxonomyInput): Promise<void> {
    const req: WireDisableTaxonomyRequest = {
      stream_id: input.streamId,
      group_sequence: input.groupSequence,
    };
    await this.admin.callMethod("local.disable_taxonomy", req);
  }

  async listStreams(): Promise<LocalStreamInfo[]> {
    const res = await this.admin.callMethod<WireListStreamsResponse>(
      "local.list_streams",
      {}
    );
    if (!res?.streams) {
      return [];
    }
    return res.streams.map((s) => ({
      dataProvider: s.data_provider,
      streamId: s.stream_id,
      streamType: s.stream_type as StreamType,
      createdAt: s.created_at,
    }));
  }
}
