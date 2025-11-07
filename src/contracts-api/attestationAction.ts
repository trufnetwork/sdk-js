/**
 * Attestation action implementation
 *
 * This module provides methods for requesting, retrieving, and listing attestations.
 * Attestations are cryptographically signed proofs of query results that can be
 * consumed by smart contracts and external applications.
 */

import { Types, Utils } from '@trufnetwork/kwil-js';
import { Action } from './action';
import {
  RequestAttestationInput,
  RequestAttestationResult,
  GetSignedAttestationInput,
  SignedAttestationResult,
  ListAttestationsInput,
  AttestationMetadata,
  validateAttestationRequest,
  validateListAttestationsInput,
} from '../types/attestation';
import { encodeActionArgs } from '../util/AttestationEncoding';

/**
 * AttestationAction provides methods for working with data attestations
 *
 * Attestations enable validators to cryptographically sign query results,
 * providing verifiable proofs that can be used in smart contracts.
 *
 * @example
 * ```typescript
 * const client = new NodeTNClient({ ... });
 * const attestationAction = client.loadAttestationAction();
 *
 * // Request an attestation
 * const result = await attestationAction.requestAttestation({
 *   dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
 *   streamId: "stai0000000000000000000000000000",
 *   actionName: "get_record",
 *   args: [dataProvider, streamId, fromTime, toTime, null, false],
 *   encryptSig: false,
 *   maxFee: 1000000,
 * });
 *
 * // Wait for signing (1-2 blocks)
 * await new Promise(resolve => setTimeout(resolve, 10000));
 *
 * // Retrieve signed attestation
 * const signed = await attestationAction.getSignedAttestation({
 *   requestTxId: result.requestTxId,
 * });
 * ```
 */
export class AttestationAction extends Action {
  /**
   * Request a signed attestation of query results
   *
   * This submits a transaction requesting that validators execute a query
   * and sign the results. The leader validator will sign the attestation
   * asynchronously (typically 1-2 blocks later).
   *
   * @param input - Attestation request parameters
   * @returns Promise resolving to request result with transaction ID
   * @throws Error if validation fails or transaction fails
   *
   * @example
   * ```typescript
   * const result = await attestationAction.requestAttestation({
   *   dataProvider: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
   *   streamId: "stai0000000000000000000000000000",
   *   actionName: "get_record",
   *   args: [
   *     "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
   *     "stai0000000000000000000000000000",
   *     Math.floor(Date.now() / 1000) - 86400, // 1 day ago
   *     Math.floor(Date.now() / 1000),
   *     null,
   *     false,
   *   ],
   *   encryptSig: false,
   *   maxFee: 1000000,
   * });
   * console.log(`Request TX ID: ${result.requestTxId}`);
   * ```
   */
  async requestAttestation(
    input: RequestAttestationInput
  ): Promise<RequestAttestationResult> {
    // Validate input
    validateAttestationRequest(input);

    // Encode arguments
    const argsBytes = encodeActionArgs(input.args);

    // Prepare named parameters for request_attestation action
    // Note: maxFee must be passed as string for NUMERIC(78,0) type
    // Convert to string to ensure proper encoding
    const maxFeeValue = typeof input.maxFee === 'bigint'
      ? input.maxFee.toString()
      : typeof input.maxFee === 'string'
        ? input.maxFee
        : input.maxFee.toString();

    // Use executeWithActionBody to pass type information for NUMERIC(78, 0)
    const actionBody: Types.ActionBody = {
      namespace: "main",
      name: "request_attestation",
      inputs: [{
        $data_provider: input.dataProvider,
        $stream_id: input.streamId,
        $action_name: input.actionName,
        $args_bytes: argsBytes,
        $encrypt_sig: input.encryptSig,
        $max_fee: maxFeeValue,
      }],
      types: {
        $max_fee: Utils.DataType.Numeric(78, 0),
      },
      description: `TN SDK - Requesting attestation`,
    };

    // Execute request_attestation action with type information
    const result = await this.executeWithActionBody(actionBody);

    // Check for errors
    if (!result.data?.tx_hash) {
      throw new Error(
        'Failed to request attestation: no transaction hash returned'
      );
    }

    // Return the 64-char hex tx_hash
    return {
      requestTxId: result.data.tx_hash,
    };
  }

  /**
   * Retrieve a complete signed attestation payload
   *
   * This fetches the signed attestation payload for a given request transaction ID.
   * The attestation must have been signed by the leader validator first.
   *
   * If the attestation is not yet signed, this will throw an error. Clients should
   * poll with exponential backoff or wait for 1-2 blocks after requesting.
   *
   * @param input - Request transaction ID
   * @returns Promise resolving to signed attestation payload
   * @throws Error if attestation not found or not yet signed
   *
   * @example
   * ```typescript
   * // Poll for signature
   * for (let i = 0; i < 15; i++) {
   *   try {
   *     const signed = await attestationAction.getSignedAttestation({
   *       requestTxId: "0x123...",
   *     });
   *     console.log(`Payload: ${Buffer.from(signed.payload).toString('hex')}`);
   *     break;
   *   } catch (e) {
   *     await new Promise(resolve => setTimeout(resolve, 2000));
   *   }
   * }
   * ```
   */
  async getSignedAttestation(
    input: GetSignedAttestationInput
  ): Promise<SignedAttestationResult> {
    // Validate and normalize input
    const trimmed = input.requestTxId?.trim() || '';
    if (trimmed === '') {
      throw new Error('request_tx_id is required');
    }

    // Strip optional "0x" prefix and lowercase for normalization
    const normalizedRequestTxId = trimmed.startsWith('0x')
      ? trimmed.slice(2).toLowerCase()
      : trimmed.toLowerCase();

    // Call get_signed_attestation view action
    const result = await this.call<Array<{ payload: string | Uint8Array }>>(
      'get_signed_attestation',
      { $request_tx_id: normalizedRequestTxId }
    );

    // Extract the right value from Either, or throw if Left
    const data = result.throw();

    // The action returns an array of rows - extract the first row
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('No attestation found for request_tx_id - may not exist or is not yet signed');
    }

    const row = data[0];
    if (!row || !row.payload) {
      throw new Error('No payload in attestation row');
    }

    // Decode base64 to bytes
    let payloadBytes: Uint8Array;
    const payloadValue = row.payload;

    if (typeof payloadValue === 'string') {
      // Node.js environment
      if (typeof Buffer !== 'undefined') {
        payloadBytes = new Uint8Array(Buffer.from(payloadValue, 'base64'));
      } else {
        // Browser environment
        const binaryString = atob(payloadValue);
        payloadBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          payloadBytes[i] = binaryString.charCodeAt(i);
        }
      }
    } else if (payloadValue instanceof Uint8Array) {
      // Already decoded
      payloadBytes = payloadValue;
    } else {
      throw new Error(`Unexpected payload type: ${typeof payloadValue}`);
    }

    return {
      payload: payloadBytes,
    };
  }

  /**
   * List attestation metadata with optional filtering
   *
   * This returns metadata for attestations, optionally filtered by requester address.
   * Supports pagination and sorting.
   *
   * @param input - Filter and pagination parameters
   * @returns Promise resolving to array of attestation metadata
   * @throws Error if parameters are invalid
   *
   * @example
   * ```typescript
   * // List my recent attestations
   * const myAddress = new Uint8Array(Buffer.from(wallet.address.slice(2), 'hex'));
   * const attestations = await attestationAction.listAttestations({
   *   requester: myAddress,
   *   limit: 10,
   *   offset: 0,
   *   orderBy: "created_height desc",
   * });
   *
   * attestations.forEach(att => {
   *   console.log(`TX: ${att.requestTxId}, Height: ${att.createdHeight}`);
   * });
   * ```
   */
  async listAttestations(
    input: ListAttestationsInput
  ): Promise<AttestationMetadata[]> {
    // Validate input
    validateListAttestationsInput(input);

    // Set defaults
    const limit = input.limit ?? 5000;
    const offset = input.offset ?? 0;

    // Prepare parameters for list_attestations view action
    const params: Types.NamedParams = {
      $requester: input.requester ?? null,
      $limit: limit,
      $offset: offset,
      $order_by: input.orderBy ?? null,
    };

    // Call list_attestations view action
    const result = await this.call<any[]>('list_attestations', params);

    // Check for errors
    if (result.isLeft()) {
      throw new Error(
        `Failed to list attestations: HTTP status ${result.value}`
      );
    }

    // Extract the right value from Either
    const rows = result.value as unknown as any[];

    // If no rows, return empty array
    if (!rows || rows.length === 0) {
      return [];
    }

    // Parse rows into AttestationMetadata
    return rows.map((row: any, idx: number) => parseAttestationRow(row, idx));
  }
}

/**
 * Parse a single row from list_attestations result into AttestationMetadata
 *
 * Expected columns (in order):
 * 0. request_tx_id (TEXT)
 * 1. attestation_hash (BYTEA)
 * 2. requester (BYTEA)
 * 3. created_height (INT8)
 * 4. signed_height (INT8, nullable)
 * 5. encrypt_sig (BOOLEAN)
 */
function parseAttestationRow(row: any, idx: number): AttestationMetadata {
  // kwil-js returns rows as objects with column names as keys
  // or as arrays depending on the query format
  let requestTxId: string;
  let attestationHash: Uint8Array;
  let requester: Uint8Array;
  let createdHeight: number;
  let signedHeight: number | null;
  let encryptSig: boolean;

  // Handle both array and object formats
  if (Array.isArray(row)) {
    // Array format: [col0, col1, col2, ...]
    if (row.length < 6) {
      throw new Error(
        `Row ${idx}: expected 6 columns, got ${row.length}`
      );
    }

    requestTxId = row[0];
    attestationHash = decodeBytea(row[1], idx, 'attestation_hash');
    requester = decodeBytea(row[2], idx, 'requester');
    createdHeight = parseInt(row[3], 10);
    signedHeight = row[4] !== null ? parseInt(row[4], 10) : null;
    encryptSig = row[5];
  } else {
    // Object format: { request_tx_id: ..., attestation_hash: ..., ... }
    requestTxId = row.request_tx_id;
    attestationHash = decodeBytea(row.attestation_hash, idx, 'attestation_hash');
    requester = decodeBytea(row.requester, idx, 'requester');
    createdHeight = parseInt(row.created_height, 10);
    signedHeight = row.signed_height !== null ? parseInt(row.signed_height, 10) : null;
    encryptSig = row.encrypt_sig;
  }

  return {
    requestTxId,
    attestationHash,
    requester,
    createdHeight,
    signedHeight,
    encryptSig,
  };
}

/**
 * Decode a BYTEA column from base64
 */
function decodeBytea(value: any, rowIdx: number, colName: string): Uint8Array {
  if (value === null || value === undefined) {
    throw new Error(`Row ${rowIdx}: ${colName} is null or undefined`);
  }

  // If already Uint8Array, return as-is
  if (value instanceof Uint8Array) {
    return value;
  }

  // If string, decode from base64
  if (typeof value === 'string') {
    try {
      // Node.js environment
      if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(value, 'base64'));
      } else {
        // Browser environment
        const binaryString = atob(value);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
      }
    } catch (err) {
      throw new Error(
        `Row ${rowIdx}: failed to decode ${colName} as base64: ${err}`
      );
    }
  }

  throw new Error(
    `Row ${rowIdx}: expected ${colName} to be string or Uint8Array, got ${typeof value}`
  );
}

// Inline unit tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('decodeBytea', () => {
    it('should decode base64 string', () => {
      const base64 = Buffer.from([1, 2, 3, 4]).toString('base64');
      const decoded = decodeBytea(base64, 0, 'test');
      expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
    });

    it('should return Uint8Array as-is', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const decoded = decodeBytea(bytes, 0, 'test');
      expect(decoded).toBe(bytes);
    });

    it('should throw on null', () => {
      expect(() => decodeBytea(null, 0, 'test')).toThrow('null or undefined');
    });

    it('should throw on invalid type', () => {
      expect(() => decodeBytea(123, 0, 'test')).toThrow('expected test to be string or Uint8Array');
    });
  });

  describe('parseAttestationRow', () => {
    it('should parse array format row', () => {
      const row = [
        'tx123',
        Buffer.from([1, 2, 3]).toString('base64'),
        Buffer.from([4, 5, 6]).toString('base64'),
        '100',
        '200',
        true,
      ];

      const metadata = parseAttestationRow(row, 0);

      expect(metadata.requestTxId).toBe('tx123');
      expect(Array.from(metadata.attestationHash)).toEqual([1, 2, 3]);
      expect(Array.from(metadata.requester)).toEqual([4, 5, 6]);
      expect(metadata.createdHeight).toBe(100);
      expect(metadata.signedHeight).toBe(200);
      expect(metadata.encryptSig).toBe(true);
    });

    it('should parse object format row', () => {
      const row = {
        request_tx_id: 'tx456',
        attestation_hash: Buffer.from([7, 8, 9]).toString('base64'),
        requester: Buffer.from([10, 11, 12]).toString('base64'),
        created_height: '300',
        signed_height: null,
        encrypt_sig: false,
      };

      const metadata = parseAttestationRow(row, 0);

      expect(metadata.requestTxId).toBe('tx456');
      expect(Array.from(metadata.attestationHash)).toEqual([7, 8, 9]);
      expect(Array.from(metadata.requester)).toEqual([10, 11, 12]);
      expect(metadata.createdHeight).toBe(300);
      expect(metadata.signedHeight).toBe(null);
      expect(metadata.encryptSig).toBe(false);
    });
  });
}
