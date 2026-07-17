import { WebKwil, NodeKwil, KwilSigner } from "@trufnetwork/kwil-js";
import { GetLastTransactionsInput } from "../internal";
import { LastTransaction } from "../types/transaction";
import { resolveBlockStamps } from "../util/blockStamps";

type LedgerRow = {
    tx_id: string;
    created_at: number;
    method: string;
    caller: string;
};

export async function getLastTransactions(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
    input: GetLastTransactionsInput
): Promise<LastTransaction[]> {
    const res = await kwilClient.call(
        {
            name: "get_last_transactions",
            namespace: "main",
            inputs: {
                $data_provider: input.dataProvider ?? null,
                $limit_size: input.limitSize ?? 6,
            },
        },
        kwilSigner
    );

    const rows = (res.data?.result as Array<Record<string, unknown>>) || [];
    if (rows.length === 0) {
        return [];
    }

    // The consolidated get_last_transactions left-joins fee distributions, so
    // a single transaction can produce multiple rows. Keep the first occurrence
    // per tx_id while preserving the action's ORDER BY (block_height DESC, tx_id DESC).
    const dedup = new Map<string, LedgerRow>();
    for (const row of rows) {
        const txId = String(row.tx_id ?? "");
        if (!txId || dedup.has(txId)) continue;
        const createdAt = Number(row.created_at);
        if (Number.isNaN(createdAt)) {
            throw new Error(`Invalid block height returned: ${row.created_at}`);
        }
        dedup.set(txId, {
            tx_id: txId,
            created_at: createdAt,
            method: String(row.method ?? ""),
            caller: String(row.caller ?? ""),
        });
    }

    const ordered = Array.from(dedup.values());
    if (ordered.length === 0) {
        return [];
    }

    // Block timestamps are read from the node's block header (indexer fallback for
    // pruned blocks). The tx list itself carries the sender and hash, so a block
    // whose stamp can't be resolved degrades to stampMs=0 rather than a bad age.
    const stampByBlock = await resolveBlockStamps(
        kwilClient,
        ordered.map((r) => r.created_at)
    );

    return ordered.map((r) => ({
        blockHeight: r.created_at,
        method: r.method,
        sender: r.caller,
        transactionHash: r.tx_id,
        stampMs: stampByBlock.get(r.created_at) ?? 0,
    }));
}
