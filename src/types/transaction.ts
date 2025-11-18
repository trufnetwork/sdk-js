export interface LastTransaction {
    /** Block height */
    blockHeight: number;
    /** Which action was taken */
    method: string;
    /** Address that sent the on‐chain tx */
    sender: string;
    /** Hash of the on‐chain transaction */
    transactionHash: string;
    /** Millisecond timestamp from the block header */
    stampMs: number;
}

/**
 * Represents a single fee distribution
 */
export interface FeeDistribution {
    /** Recipient Ethereum address */
    recipient: string;
    /** Amount as string (handles large numbers) */
    amount: string;
}

/**
 * Represents a single transaction event from the ledger
 *
 * Fee Fields Relationship:
 * - feeAmount: Total fee charged for the transaction (as string to handle large numbers)
 * - feeRecipient: Primary fee recipient address (if single recipient). May be undefined for:
 *   1. Transactions from fee-exempt wallets (system:network_writer role)
 *   2. Transactions with multiple fee distributions (use feeDistributions instead)
 * - feeDistributions: Array of fee distributions to multiple recipients
 *   - Aggregated using string_agg() in get_transaction_event query
 *   - Parsed from "recipient1:amount1,recipient2:amount2" format
 *   - Sum of amounts in feeDistributions equals feeAmount (when present)
 *   - Empty array when there are no distributions or single recipient (use feeRecipient)
 */
export interface TransactionEvent {
    /** Transaction hash (0x-prefixed) */
    txId: string;
    /** Block height when transaction was included */
    blockHeight: number;
    /**
     * Millisecond timestamp from the block header via indexer lookup.
     * Will be 0 when the indexer is unavailable.
     */
    stampMs: number;
    /** Method name (e.g., "deployStream", "insertRecords") */
    method: string;
    /** Ethereum address of caller (lowercase, 0x-prefixed) */
    caller: string;
    /**
     * Total fee amount as string (handles large numbers with 18 decimals)
     * Will be "0" for fee-exempt wallets (system:network_writer role)
     */
    feeAmount: string;
    /**
     * Primary fee recipient address (lowercase, 0x-prefixed)
     * Undefined when:
     * - Wallet is fee-exempt (feeAmount === "0")
     * - Fee has multiple distributions (check feeDistributions)
     */
    feeRecipient?: string;
    /** Optional metadata JSON (nullable) */
    metadata?: string;
    /**
     * Array of fee distributions to multiple recipients
     * Aggregated from transaction_event_distributions table using string_agg()
     */
    feeDistributions: FeeDistribution[];
}

/**
 * Input for getting transaction event
 */
export interface GetTransactionEventInput {
    /** Transaction hash (with or without 0x prefix) */
    txId: string;
}
