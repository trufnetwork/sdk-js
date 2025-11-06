import { KwilSigner, NodeKwil, WebKwil, Types } from "@trufnetwork/kwil-js";
import { TransactionEvent, FeeDistribution, GetTransactionEventInput } from "../types/transaction";

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

    const row = result.data.result[0] as any;

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

          // Validate amount is numeric
          if (isNaN(Number(amount)) || !Number.isFinite(Number(amount))) {
            throw new Error(`Invalid fee distribution amount (not numeric): ${amount} (tx: ${row.tx_id})`);
          }

          feeDistributions.push({ recipient, amount });
        }
      }
    }

    // Validate block height
    const blockHeight = parseInt(row.block_height, 10);
    if (!Number.isFinite(blockHeight) || blockHeight < 0) {
      throw new Error(`Invalid block height: ${row.block_height} (tx: ${row.tx_id})`);
    }

    return {
      txId: row.tx_id,
      blockHeight,
      method: row.method,
      caller: row.caller,
      feeAmount: row.fee_amount,
      feeRecipient: row.fee_recipient || undefined,
      metadata: row.metadata || undefined,
      feeDistributions,
    };
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
