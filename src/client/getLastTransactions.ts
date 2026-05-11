import { WebKwil, NodeKwil, KwilSigner } from "@trufnetwork/kwil-js";
import { GetLastTransactionsInput } from "../internal";
import { LastTransaction } from "../types/transaction";

const INDEXER_BASE = "https://indexer.infra.truf.network";

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

    // Best-effort indexer lookup for block timestamps only. Sender and tx hash
    // already come from the chain via the action result, so a missed timestamp
    // degrades to stampMs=0 rather than "(unknown)" identity fields.
    const stampByBlock = await fetchBlockStamps(
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

async function fetchBlockStamps(
    blockHeights: number[]
): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (blockHeights.length === 0) return result;

    const min = Math.min(...blockHeights);
    const max = Math.max(...blockHeights);
    const url = `${INDEXER_BASE}/v0/chain/transactions?from-block=${min}&to-block=${max}&order=desc`;

    try {
        const resp = await fetch(url);
        if (!resp.ok) return result;
        const json = (await resp.json()) as {
            ok: boolean;
            data: Array<{ block_height: number; stamp_ms: number | null }>;
        };
        if (!json.ok) return result;
        for (const tx of json.data) {
            if (tx.stamp_ms != null && !result.has(tx.block_height)) {
                result.set(tx.block_height, tx.stamp_ms);
            }
        }
    } catch {
        // Indexer timestamp lookup is best-effort; falling back to 0 is acceptable.
    }
    return result;
}
