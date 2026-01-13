/**
 * Types for bridge-related operations
 */

/**
 * Withdrawal proof returned from getWithdrawalProof()
 *
 * This proof contains all the data needed for a user to claim their withdrawal
 * on the destination chain by submitting a transaction to the bridge contract.
 *
 * @example
 * ```typescript
 * const proofs = await client.getWithdrawalProof("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
 * const proof = proofs[0];
 *
 * // Decode base64 data to use in smart contract call
 * const blockHash = Buffer.from(proof.block_hash, 'base64').toString('hex');
 * const root = Buffer.from(proof.root, 'base64').toString('hex');
 * const signatures = proof.signatures.map(sig => Buffer.from(sig, 'base64'));
 * ```
 */
export interface WithdrawalProof {
  /**
   * The source chain name (e.g., "hoodi", "sepolia")
   * Note: This is the chain name, not the bridge identifier
   */
  chain: string;

  /**
   * The numeric chain ID (e.g., "3639" for Hoodi)
   */
  chain_id: string;

  /**
   * The bridge contract address on the destination chain
   */
  contract: string;

  /**
   * The block number when the epoch was created
   */
  created_at: number;

  /**
   * The recipient wallet address
   */
  recipient: string;

  /**
   * The withdrawal amount in wei (as string to handle large numbers)
   */
  amount: string;

  /**
   * The Kwil block hash (base64-encoded bytes)
   * Decode to bytes32 for smart contract call
   */
  block_hash: string;

  /**
   * The merkle root (base64-encoded bytes)
   * Decode to bytes32 for smart contract call
   */
  root: string;

  /**
   * Array of merkle proofs (base64-encoded bytes)
   * Usually empty for single withdrawals
   */
  proofs: string[];

  /**
   * Array of validator signatures (base64-encoded bytes)
   * Each signature is 65 bytes: r[32] || s[32] || v[1]
   * Decode and split into (v, r, s) for smart contract call
   */
  signatures: string[];
}
