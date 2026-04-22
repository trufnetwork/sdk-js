import { AdminClient } from "@trufnetwork/kwil-js";
import { keccak256, sha256, SigningKey, toUtf8Bytes } from "ethers";
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
// AUTH ENVELOPE AND SIGNING
// ═══════════════════════════════════════════════════════════════
//
// Mirrors node/extensions/tn_local/auth.go and sdk-go/core/contractsapi/
// local_actions.go. All three must produce byte-identical canonical JSON
// and the same keccak256 digest for cross-language signatures to verify.

const LOCAL_AUTH_VERSION = "tn_local.auth.v1";

interface AuthEnvelope {
  sig: string; // 0x-prefixed 65-byte hex (r || s || v, v = 27/28)
  ts: number; // unix ms
  ver: string; // "tn_local.auth.v1"
}

/**
 * Recursively sort object keys and re-serialize without whitespace. Mirrors
 * the verifier's canonical-JSON output: no HTML escaping (JSON.stringify is
 * already non-escaping by default), sorted keys at every level, integer
 * precision preserved up to 2^53 (sufficient for event_time unix seconds
 * and the ts field).
 */
function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortKeysDeep);
  }
  if (v === null || typeof v !== "object") {
    return v;
  }
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).sort()) {
    out[k] = sortKeysDeep(src[k]);
  }
  return out;
}

/**
 * Normalize a secp256k1 private key to a 0x-prefixed 64-hex-char string
 * suitable for ethers' SigningKey. Accepts bare or 0x-prefixed input so
 * operator keys extracted from the node's nodekey.json (bare hex) and
 * operator keys passed via ethers conventions (0x-prefixed) both work.
 */
function normalizePrivateKey(raw: string): string {
  const stripped = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new Error(
      "invalid operator private key: expected 64 hex characters (with or without 0x prefix)"
    );
  }
  return "0x" + stripped.toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
// IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Optional construction-time options for LocalActions.
 */
export interface LocalActionsOptions {
  /**
   * Operator secp256k1 private key (hex, with or without the 0x prefix).
   * When set, every request carries a `_auth` envelope recoverable to the
   * signing address; the server rejects calls that don't match its
   * operator address. Required only when the node has
   * [extensions.tn_local] require_signature = true.
   */
  signer?: string;
}

/**
 * LocalActions calls the `local.*` JSON-RPC methods on the kwil-db admin
 * server via the generic AdminClient from @trufnetwork/kwil-js.
 *
 * This class does NOT extend the existing Action base class — local
 * operations use a different transport (admin port) and auth model
 * (no gateway, no KwilSigner needed).
 *
 * Construction: pass an AdminClient instance and, optionally, an operator
 * private key. When the operator key is set, every call carries a
 * server-recoverable `_auth` envelope, enabling use against nodes that
 * have `require_signature = true`.
 */
export class LocalActions implements ILocalActions {
  private readonly admin: AdminClient;
  private readonly signingKey: SigningKey | null;

  constructor(admin: AdminClient, options?: LocalActionsOptions) {
    if (!admin) {
      throw new Error("AdminClient is required for LocalActions");
    }
    this.admin = admin;
    this.signingKey =
      options?.signer !== undefined && options.signer !== ""
        ? new SigningKey(normalizePrivateKey(options.signer))
        : null;
  }

  /**
   * Produce the `_auth` envelope for a request. When no signer is
   * configured the method returns null and the caller omits `_auth`
   * from the wire — the server then rejects (if its flag is on) or
   * accepts (if off). Mirrors sdk-go's LocalActions.attachAuth.
   */
  private makeAuth(method: string, req: unknown): AuthEnvelope | null {
    if (this.signingKey === null) {
      return null;
    }
    const paramsCanonical = canonicalJSON(req);
    // ethers sha256 returns a 0x-prefixed hex string; strip the prefix to
    // match the node-side canonical payload (bare hex with no 0x).
    const paramsSha = sha256(toUtf8Bytes(paramsCanonical)).slice(2);
    const ts = Date.now();
    const payload = `${LOCAL_AUTH_VERSION}\n${method}\n${paramsSha}\n${ts}`;
    const digest = keccak256(toUtf8Bytes(payload));
    // ethers v6 SigningKey.sign returns a Signature with r, s, v normalized
    // to {27, 28} via `.serialized` — exactly the shape the server expects.
    const signature = this.signingKey.sign(digest);
    return {
      sig: signature.serialized,
      ts,
      ver: LOCAL_AUTH_VERSION,
    };
  }

  private async call<T = unknown>(method: string, req: object): Promise<T> {
    const auth = this.makeAuth(method, req);
    const wire = auth !== null ? { ...(req as Record<string, unknown>), _auth: auth } : req;
    return this.admin.callMethod<T>(method, wire);
  }

  async createStream(input: LocalCreateStreamInput): Promise<void> {
    const req: WireCreateStreamRequest = {
      stream_id: input.streamId,
      stream_type: input.streamType,
    };
    await this.call("local.create_stream", req);
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
    await this.call("local.insert_records", req);
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
    await this.call("local.insert_taxonomy", req);
  }

  async getRecord(input: LocalGetRecordInput): Promise<LocalRecordOutput[]> {
    const req: WireGetRecordRequest = {
      stream_id: input.streamId,
      ...(input.fromTime !== undefined && { from_time: input.fromTime }),
      ...(input.toTime !== undefined && { to_time: input.toTime }),
    };
    const res = await this.call<WireGetRecordResponse>("local.get_record", req);
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
    const res = await this.call<WireGetIndexResponse>("local.get_index", req);
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
    await this.call("local.delete_stream", req);
  }

  async disableTaxonomy(input: LocalDisableTaxonomyInput): Promise<void> {
    const req: WireDisableTaxonomyRequest = {
      stream_id: input.streamId,
      group_sequence: input.groupSequence,
    };
    await this.call("local.disable_taxonomy", req);
  }

  async listStreams(): Promise<LocalStreamInfo[]> {
    const res = await this.call<WireListStreamsResponse>("local.list_streams", {});
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
