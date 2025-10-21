/**
 * Type definitions for attestation operations
 *
 * Attestations enable validators to cryptographically sign query results,
 * providing verifiable proofs that can be consumed by smart contracts and
 * external applications.
 */

/**
 * Input parameters for requesting an attestation
 */
export interface RequestAttestationInput {
  /**
   * Data provider address (0x-prefixed, 42 characters)
   * Example: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c"
   */
  dataProvider: string;

  /**
   * Stream ID (32 characters)
   * Example: "stai0000000000000000000000000000"
   */
  streamId: string;

  /**
   * Action name to attest (must be in allowlist)
   * Example: "get_record", "get_index"
   */
  actionName: string;

  /**
   * Action arguments (will be encoded)
   * Must match the signature of the action
   */
  args: any[];

  /**
   * Whether to encrypt the signature (must be false in MVP)
   * Future: ECIES encryption to requester's public key
   */
  encryptSig: boolean;

  /**
   * Maximum fee willing to pay (in smallest token unit)
   * Transaction will abort if actual fee exceeds this
   */
  maxFee: number;
}

/**
 * Result of requesting an attestation
 */
export interface RequestAttestationResult {
  /**
   * Transaction ID for this attestation request
   * Use this to retrieve the signed attestation later
   */
  requestTxId: string;
}

/**
 * Input parameters for retrieving a signed attestation
 */
export interface GetSignedAttestationInput {
  /**
   * Transaction ID from request_attestation
   */
  requestTxId: string;
}

/**
 * Result of retrieving a signed attestation
 */
export interface SignedAttestationResult {
  /**
   * Complete attestation payload: canonical (8 fields) + signature
   *
   * Format: version | algo | height | provider | stream | action | args | result | signature
   *
   * This payload can be passed to EVM contracts for verification
   */
  payload: Uint8Array;
}

/**
 * Input parameters for listing attestations
 */
export interface ListAttestationsInput {
  /**
   * Optional: Filter by requester address (20 bytes)
   * If provided, only returns attestations requested by this address
   */
  requester?: Uint8Array;

  /**
   * Optional: Maximum number of results (1-5000, default 5000)
   */
  limit?: number;

  /**
   * Optional: Pagination offset (default 0)
   */
  offset?: number;

  /**
   * Optional: Sort order
   *
   * Allowed values:
   * - "created_height asc"
   * - "created_height desc"
   * - "signed_height asc"
   * - "signed_height desc"
   *
   * Case-insensitive
   */
  orderBy?: string;
}

/**
 * Metadata for a single attestation
 */
export interface AttestationMetadata {
  /**
   * Transaction ID for this attestation request
   */
  requestTxId: string;

  /**
   * Attestation hash (identifies this attestation)
   */
  attestationHash: Uint8Array;

  /**
   * Address of the requester (20 bytes)
   */
  requester: Uint8Array;

  /**
   * Block height when attestation was created
   */
  createdHeight: number;

  /**
   * Block height when attestation was signed (null if not yet signed)
   */
  signedHeight: number | null;

  /**
   * Whether signature is encrypted
   */
  encryptSig: boolean;
}

/**
 * Validates attestation request input
 *
 * @param input - The attestation request to validate
 * @throws Error if validation fails
 */
export function validateAttestationRequest(input: RequestAttestationInput): void {
  // Data provider validation
  if (input.dataProvider.length !== 42) {
    throw new Error(
      `data_provider must be 0x-prefixed 40 hex characters, got ${input.dataProvider.length} chars`
    );
  }

  if (!input.dataProvider.startsWith('0x')) {
    throw new Error('data_provider must start with 0x prefix');
  }

  // Validate hex after 0x prefix
  const hex = input.dataProvider.slice(2);
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) {
    throw new Error('data_provider must contain valid hex characters after 0x prefix');
  }

  // Stream ID validation
  if (input.streamId.length !== 32) {
    throw new Error(`stream_id must be 32 characters, got ${input.streamId.length}`);
  }

  // Action name validation
  if (!input.actionName || input.actionName.trim() === '') {
    throw new Error('action_name cannot be empty');
  }

  // Encryption validation
  if (input.encryptSig) {
    throw new Error('encryption not implemented in MVP');
  }

  // Fee validation
  if (input.maxFee < 0) {
    throw new Error(`max_fee must be non-negative, got ${input.maxFee}`);
  }
}

/**
 * Whitelist of valid orderBy values
 */
const VALID_ORDER_BY_VALUES = [
  'created_height asc',
  'created_height desc',
  'signed_height asc',
  'signed_height desc',
  'created_height ASC',
  'created_height DESC',
  'signed_height ASC',
  'signed_height DESC',
];

/**
 * Validates orderBy parameter
 *
 * @param orderBy - The orderBy value to validate
 * @returns true if valid, false otherwise
 */
export function isValidOrderBy(orderBy: string): boolean {
  return VALID_ORDER_BY_VALUES.includes(orderBy);
}

/**
 * Validates list attestations input
 *
 * @param input - The list attestations input to validate
 * @throws Error if validation fails
 */
export function validateListAttestationsInput(input: ListAttestationsInput): void {
  // Validate limit
  if (input.limit !== undefined) {
    if (input.limit < 1 || input.limit > 5000) {
      throw new Error('limit must be between 1 and 5000');
    }
  }

  // Validate offset
  if (input.offset !== undefined) {
    if (input.offset < 0) {
      throw new Error('offset must be non-negative');
    }
  }

  // Validate requester length
  if (input.requester !== undefined) {
    if (input.requester.length !== 20) {
      throw new Error('requester must be exactly 20 bytes');
    }
  }

  // Validate orderBy
  if (input.orderBy !== undefined) {
    if (!isValidOrderBy(input.orderBy)) {
      throw new Error(
        `Invalid orderBy value. Must be one of: ${VALID_ORDER_BY_VALUES.slice(0, 4).join(', ')}`
      );
    }
  }
}

// Inline unit tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('validateAttestationRequest', () => {
    it('should accept valid input', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000000,
        })
      ).not.toThrow();
    });

    it('should reject invalid data_provider length', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0xinvalid',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('data_provider must be 0x-prefixed 40 hex characters');
    });

    it('should reject data_provider without 0x prefix', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '4710a8d8f0d845da110086812a32de6d90d7ff5c00',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('data_provider must start with 0x prefix');
    });

    it('should reject data_provider with invalid hex', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0xGGGGa8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('data_provider must contain valid hex characters');
    });

    it('should reject short stream_id', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'short',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('stream_id must be 32 characters');
    });

    it('should reject long stream_id', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai00000000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('stream_id must be 32 characters');
    });

    it('should reject empty action_name', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: '',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('action_name cannot be empty');
    });

    it('should reject whitespace-only action_name', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: '   ',
          args: [],
          encryptSig: false,
          maxFee: 1000,
        })
      ).toThrow('action_name cannot be empty');
    });

    it('should reject encryptSig=true', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: true,
          maxFee: 1000,
        })
      ).toThrow('encryption not implemented in MVP');
    });

    it('should reject negative maxFee', () => {
      expect(() =>
        validateAttestationRequest({
          dataProvider: '0x4710a8d8f0d845da110086812a32de6d90d7ff5c',
          streamId: 'stai0000000000000000000000000000',
          actionName: 'get_record',
          args: [],
          encryptSig: false,
          maxFee: -1,
        })
      ).toThrow('max_fee must be non-negative');
    });
  });

  describe('isValidOrderBy', () => {
    it('should accept valid lowercase orderBy', () => {
      expect(isValidOrderBy('created_height asc')).toBe(true);
      expect(isValidOrderBy('created_height desc')).toBe(true);
      expect(isValidOrderBy('signed_height asc')).toBe(true);
      expect(isValidOrderBy('signed_height desc')).toBe(true);
    });

    it('should accept valid uppercase orderBy', () => {
      expect(isValidOrderBy('created_height ASC')).toBe(true);
      expect(isValidOrderBy('created_height DESC')).toBe(true);
      expect(isValidOrderBy('signed_height ASC')).toBe(true);
      expect(isValidOrderBy('signed_height DESC')).toBe(true);
    });

    it('should reject invalid orderBy', () => {
      expect(isValidOrderBy('invalid')).toBe(false);
      expect(isValidOrderBy('created_height')).toBe(false);
      expect(isValidOrderBy('created_height ascending')).toBe(false);
      expect(isValidOrderBy('')).toBe(false);
    });
  });

  describe('validateListAttestationsInput', () => {
    it('should accept valid input with all fields', () => {
      expect(() =>
        validateListAttestationsInput({
          requester: new Uint8Array(20),
          limit: 100,
          offset: 0,
          orderBy: 'created_height desc',
        })
      ).not.toThrow();
    });

    it('should accept valid input with no optional fields', () => {
      expect(() => validateListAttestationsInput({})).not.toThrow();
    });

    it('should reject limit < 1', () => {
      expect(() =>
        validateListAttestationsInput({
          limit: 0,
        })
      ).toThrow('limit must be between 1 and 5000');
    });

    it('should reject limit > 5000', () => {
      expect(() =>
        validateListAttestationsInput({
          limit: 5001,
        })
      ).toThrow('limit must be between 1 and 5000');
    });

    it('should reject negative offset', () => {
      expect(() =>
        validateListAttestationsInput({
          offset: -1,
        })
      ).toThrow('offset must be non-negative');
    });

    it('should reject requester > 20 bytes', () => {
      expect(() =>
        validateListAttestationsInput({
          requester: new Uint8Array(21),
        })
      ).toThrow('requester must be at most 20 bytes');
    });

    it('should reject invalid orderBy', () => {
      expect(() =>
        validateListAttestationsInput({
          orderBy: 'invalid',
        })
      ).toThrow('Invalid orderBy value');
    });
  });
}
