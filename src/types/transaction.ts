export interface LastTransaction {
    /** Block height */
    blockHeight: number;
    /** Which action was taken */
    method: string;
    /** Address that sent the on‐chain tx */
    sender: string;
    /** Hash of the on‐chain transaction */
    transactionHash: string;
    /**
     * Block time in unix milliseconds, read from the node's block header
     * (indexer fallback for pruned blocks). 0 when neither source can resolve it.
     */
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
     * Block time in unix milliseconds, read from the node's block header
     * (indexer fallback for pruned blocks). 0 when neither source can resolve it.
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

/**
 * Which side of the fee ledger to match a wallet against.
 *
 * - `paid` - the wallet was the transaction's caller
 * - `received` - the wallet was the fee recipient or a distribution recipient
 * - `both` - either of the above
 *
 * `paid` matches on the caller alone, so it omits transactions where the wallet
 * received a distribution without sending the transaction. Use `both` to see those.
 */
export type TransactionFeeMode = "paid" | "received" | "both";

/**
 * Input for listing a wallet's transaction fees
 */
export interface ListTransactionFeesInput {
    /** Ethereum address to query */
    wallet: string;
    /** Which side of the ledger to match. Defaults to "paid" (the node's default). */
    mode?: TransactionFeeMode;
    /**
     * Maximum *transactions* to return, not rows. The node applies the limit before
     * expanding each transaction into one row per fee distribution, so the returned
     * array can be longer than this. Defaults to 20; the node errors above 1000, and
     * treats a value of zero or less as 20.
     */
    limit?: number;
    /** Transactions to skip, for pagination. Defaults to 0. */
    offset?: number;
}

/**
 * One row of the fee ledger.
 *
 * The node returns one row per fee distribution, so a transaction with several
 * distributions appears more than once, distinguished by `distributionSequence`.
 * Group by `txId` to reassemble a whole transaction.
 */
export interface TransactionFeeEntry {
    /** Transaction hash (0x-prefixed) */
    txId: string;
    /** Block height when the transaction was included */
    blockHeight: number;
    /** Method name (e.g., "insertRecords") */
    method: string;
    /** Ethereum address of the caller (lowercase, 0x-prefixed) */
    caller: string;
    /** Total fee for the transaction, as a string to preserve 18-decimal precision */
    totalFee: string;
    /** Primary fee recipient, when the node recorded one */
    feeRecipient?: string;
    /** Optional metadata JSON */
    metadata?: string;
    /** Index of this distribution within the transaction */
    distributionSequence: number;
    /** Recipient for this distribution */
    distributionRecipient?: string;
    /** Amount for this distribution, as a string to preserve precision */
    distributionAmount?: string;
}
