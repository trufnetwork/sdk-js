import { KwilSigner, NodeKwil, WebKwil } from "@trufnetwork/kwil-js";
import { TransactionEvent, FeeDistribution, GetTransactionEventInput } from "../types/transaction";
import { decodeTransactionPayload } from "../util/TransactionPayload";
import type { DecodedTransactionPayload } from "../util/TransactionPayload";

/**
 * Decodes a base64 string to bytes in both Node.js and browser environments.
 */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const INDEXER_BASE = "https://indexer.infra.truf.network";

function normalizeTransactionId(txId: string): string {
  const lower = txId.toLowerCase();
  return lower.startsWith("0x") ? lower : `0x${lower}`;
}

async function fetchTransactionStampMs(blockHeight: number, txId: string): Promise<number> {
  const url = `${INDEXER_BASE}/v0/chain/transactions?from-block=${blockHeight}&to-block=${blockHeight}&order=desc`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Indexer returned ${response.status} while fetching block ${blockHeight} for tx ${txId}`);
      return 0;
    }

    const data = await response.json() as {
      ok: boolean;
      data: Array<{
        block_height: number;
        hash: string;
        stamp_ms: number | null;
      }>;
    };

    if (!data.ok || !Array.isArray(data.data)) {
      console.warn(`Indexer payload malformed for block ${blockHeight} (tx ${txId})`);
      return 0;
    }

    const normalizedTargetHash = normalizeTransactionId(txId);
    const tx = data.data.find(entry => normalizeTransactionId(entry.hash) === normalizedTargetHash);
    return tx?.stamp_ms ?? 0;
  } catch (error) {
    console.warn(`Failed to fetch stamp_ms for tx ${txId} at block ${blockHeight}`, error);
    return 0;
  }
}

/**
 * Database row structure returned from get_transaction_event action
 */
interface TransactionEventRow {
  tx_id: string;
  block_height: string | number;
  method: string;
  caller: string;
  fee_amount: string | number;
  fee_recipient?: string | null;
  metadata?: string | null;
  fee_distributions: string;
}

/**
 * TransactionAction provides methods for querying transaction ledger data
 */
export class TransactionAction {
  protected kwilClient: WebKwil | NodeKwil;
  protected kwilSigner: KwilSigner;

  constructor(kwilClient: WebKwil | NodeKwil, kwilSigner: KwilSigner) {
    this.kwilClient = kwilClient;
    this.kwilSigner = kwilSigner;
  }

  /**
   * Fetches detailed transaction information by transaction hash
   *
   * @param input Transaction query input containing tx hash
   * @returns Promise resolving to transaction event with fee details
   * @throws Error if transaction not found or query fails
   *
   * @example
   * ```typescript
   * const txAction = client.loadTransactionAction();
   * const txEvent = await txAction.getTransactionEvent({
   *   txId: "0xabcdef123456..."
   * });
   * console.log(`Method: ${txEvent.method}, Fee: ${txEvent.feeAmount} TRUF`);
   * ```
   */
  async getTransactionEvent(input: GetTransactionEventInput): Promise<TransactionEvent> {
    if (!input.txId || input.txId.trim() === "") {
      throw new Error("tx_id is required");
    }

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_transaction_event",
        inputs: {
          $tx_id: input.txId,
        },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get transaction event: HTTP ${result.status}`);
    }

    if (!result.data?.result || result.data.result.length === 0) {
      throw new Error(`Transaction not found: ${input.txId}`);
    }

    const row = result.data.result[0] as TransactionEventRow;

    // Validate required fields
    if (!row.method || typeof row.method !== 'string' || row.method.trim() === '') {
      throw new Error(`Missing or invalid method field (tx: ${row.tx_id})`);
    }

    if (!row.caller || typeof row.caller !== 'string' || row.caller.trim() === '') {
      throw new Error(`Missing or invalid caller field (tx: ${row.tx_id})`);
    }

    if (row.fee_amount === null || row.fee_amount === undefined) {
      throw new Error(`Missing fee_amount field (tx: ${row.tx_id})`);
    }

    // Validate fee_amount is numeric (can be string or number)
    const feeAmount = typeof row.fee_amount === 'string' ? row.fee_amount : String(row.fee_amount);
    const feeAmountNum = Number(feeAmount);
    if (isNaN(feeAmountNum) || !Number.isFinite(feeAmountNum)) {
      throw new Error(`Invalid fee_amount (not numeric): ${row.fee_amount} (tx: ${row.tx_id})`);
    }
    if (feeAmountNum < 0) {
      throw new Error(`Invalid fee_amount (negative): ${row.fee_amount} (tx: ${row.tx_id})`);
    }

    // Parse fee_distributions string: "recipient1:amount1,recipient2:amount2"
    const feeDistributions: FeeDistribution[] = [];
    if (row.fee_distributions && row.fee_distributions !== "") {
      const parts = row.fee_distributions.split(",");
      for (const part of parts) {
        const trimmedPart = part.trim();
        if (trimmedPart) {
          // Split only on first colon to handle addresses with colons
          const colonIndex = trimmedPart.indexOf(":");
          if (colonIndex === -1) {
            throw new Error(`Invalid fee distribution format (missing colon): ${trimmedPart} (tx: ${row.tx_id})`);
          }

          const recipient = trimmedPart.substring(0, colonIndex).trim();
          const amount = trimmedPart.substring(colonIndex + 1).trim();

          if (!recipient || !amount) {
            throw new Error(`Invalid fee distribution entry (empty recipient or amount): ${trimmedPart} (tx: ${row.tx_id})`);
          }

          // Validate amount is numeric and non-negative
          const amt = Number(amount);
          if (isNaN(amt) || !Number.isFinite(amt)) {
            throw new Error(`Invalid fee distribution amount (not numeric): ${amount} (tx: ${row.tx_id})`);
          }
          if (amt < 0) {
            throw new Error(`Invalid fee distribution amount (negative): ${amount} (tx: ${row.tx_id})`);
          }

          feeDistributions.push({ recipient, amount });
        }
      }
    }

    // Validate block height
    const blockHeight = typeof row.block_height === 'number'
      ? row.block_height
      : parseInt(row.block_height, 10);
    if (!Number.isFinite(blockHeight) || blockHeight < 0) {
      throw new Error(`Invalid block height: ${row.block_height} (tx: ${row.tx_id})`);
    }

    const stampMs = await fetchTransactionStampMs(blockHeight, row.tx_id);

    return {
      txId: row.tx_id,
      blockHeight,
      stampMs,
      method: row.method,
      caller: row.caller,
      feeAmount,
      feeRecipient: row.fee_recipient || undefined,
      metadata: row.metadata || undefined,
      feeDistributions,
    };
  }

  /**
   * Fetches a transaction and decodes its input payload — the action that was called and its
   * arguments (e.g. the deployed stream IDs from a deploy, the records from an insert).
   *
   * Unlike {@link getTransactionEvent} (which reads the ledger for fee data), this decodes the raw
   * `execute` payload, so it works for any action-call transaction without a dedicated view action.
   *
   * @param input Transaction query input containing the tx hash
   * @returns Promise resolving to the decoded namespace, action, and native arguments
   * @throws Error if the transaction is not found, has no payload, or is not an action call
   *
   * @example
   * ```typescript
   * const txAction = client.loadTransactionAction();
   * const { action, arguments: args } = await txAction.getTransactionInput({
   *   txId: "0xabcdef123456...",
   * });
   * // action === "insert_records"; args is one array of native values per batched call
   * ```
   */
  async getTransactionInput(input: GetTransactionEventInput): Promise<DecodedTransactionPayload> {
    if (!input.txId || input.txId.trim() === "") {
      throw new Error("tx_id is required");
    }

    // The node's tx_query expects a 64-character hex hash; a leading "0x" (66 chars) is rejected.
    const hash = input.txId.trim().replace(/^0x/i, "");

    const result = await this.kwilClient.txInfo(hash);

    if (result.status !== 200 || !result.data) {
      throw new Error(`Failed to get transaction info: HTTP ${result.status}`);
    }

    const body = result.data.tx?.body;
    if (!body || body.payload === null || body.payload === undefined) {
      throw new Error(`Transaction has no payload: ${input.txId}`);
    }

    // Data-provision writes (deploy, insert, ...) are all `execute` (action call) payloads.
    if (body.type !== "execute") {
      throw new Error(
        `Transaction ${input.txId} is a "${body.type}" payload, not an action call; cannot decode input`
      );
    }

    // The receipt type declares Uint8Array, but be tolerant of a base64 string over the wire.
    const payloadBytes =
      typeof body.payload === "string" ? base64ToBytes(body.payload) : (body.payload as Uint8Array);

    try {
      return decodeTransactionPayload(payloadBytes);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to decode transaction input for ${input.txId}: ${detail}`);
    }
  }

  /**
   * Creates a TransactionAction instance from an existing client and signer
   *
   * @param kwilClient The Kwil client (Web or Node)
   * @param kwilSigner The Kwil signer for authentication
   * @returns A new TransactionAction instance
   */
  static fromClient(kwilClient: WebKwil | NodeKwil, kwilSigner: KwilSigner): TransactionAction {
    return new TransactionAction(kwilClient, kwilSigner);
  }
}
