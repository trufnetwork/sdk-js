import { StreamType } from "../contracts-api/contractValues";

// ═══════════════════════════════════════════════════════════════
// LOCAL STREAM ACTIONS (tn_local extension, admin port)
// ═══════════════════════════════════════════════════════════════
//
// Local streams are stored off-chain on a single node — they do not
// participate in consensus and incur no transaction fees.
//
// Ownership: every local stream is implicitly owned by the node operator.
// Input types never contain a data_provider field — the server derives it
// from the node's secp256k1 key. Output types keep data_provider where
// the mirrored consensus action returns one (e.g. list_streams).
//
// Transport: LocalActions talks to the kwil-db admin JSON-RPC server
// (port 8485) via the AdminClient from @trufnetwork/kwil-js, not through
// the gateway.

// ═══════════════════════════════════════════════════════════════
// INPUT TYPES (no data_provider — server-derived from node key)
// ═══════════════════════════════════════════════════════════════

export interface LocalCreateStreamInput {
  streamId: string;
  streamType: StreamType;
}

/**
 * Parallel arrays — each index (streamId[i], eventTime[i], value[i])
 * describes one record. Different records may target different streams.
 */
export interface LocalInsertRecordsInput {
  streamId: string[];
  eventTime: number[];
  /** Decimal string values, NUMERIC(36,18) */
  value: string[];
}

/**
 * Parallel arrays for (childStreamIds[i], weights[i]).
 * Children are always local to the same node.
 */
export interface LocalInsertTaxonomyInput {
  streamId: string;
  childStreamIds: string[];
  /** Decimal string weights, NUMERIC(36,18) */
  weights: string[];
  startDate: number;
}

/**
 * Both fromTime and toTime undefined returns the latest record.
 */
export interface LocalGetRecordInput {
  streamId: string;
  fromTime?: number;
  toTime?: number;
}

/**
 * BaseTime defaults to the earliest event_time in the stream when omitted.
 */
export interface LocalGetIndexInput {
  streamId: string;
  fromTime?: number;
  toTime?: number;
  baseTime?: number;
}

export interface LocalDeleteStreamInput {
  streamId: string;
}

export interface LocalDisableTaxonomyInput {
  streamId: string;
  groupSequence: number;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT TYPES (mirror consensus action shapes)
// ═══════════════════════════════════════════════════════════════

export interface LocalRecordOutput {
  eventTime: number;
  value: string;
  createdAt: number;
}

export interface LocalIndexOutput {
  eventTime: number;
  value: string;
}

/**
 * DataProvider is always the node's own address — kept for parity with
 * the consensus list_streams action so callers can swap local/on-chain
 * code without reshaping records.
 */
export interface LocalStreamInfo {
  dataProvider: string;
  streamId: string;
  streamType: StreamType;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface ILocalActions {
  createStream(input: LocalCreateStreamInput): Promise<void>;
  insertRecords(input: LocalInsertRecordsInput): Promise<void>;
  insertTaxonomy(input: LocalInsertTaxonomyInput): Promise<void>;
  getRecord(input: LocalGetRecordInput): Promise<LocalRecordOutput[]>;
  getIndex(input: LocalGetIndexInput): Promise<LocalIndexOutput[]>;
  deleteStream(input: LocalDeleteStreamInput): Promise<void>;
  disableTaxonomy(input: LocalDisableTaxonomyInput): Promise<void>;
  listStreams(): Promise<LocalStreamInfo[]>;
}
