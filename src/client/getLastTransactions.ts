import { WebKwil, NodeKwil, KwilSigner } from "@trufnetwork/kwil-js";
import { GetLastTransactionsInput } from "../internal";
import { LastTransaction } from "../types/transaction";

const INDEXER_BASE = "https://indexer.infra.truf.network";

export async function getLastTransactions(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
    input: GetLastTransactionsInput
): Promise<LastTransaction[]> {
    // 1) call your SQL action
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
    const rows = (res.data?.result as { created_at: number; method: string }[]) || [];

    if (rows.length === 0) {
        return [];
    }

    // 2) Parse block heights and validate
    const blockHeights = rows.map(({ created_at }) => {
        const blockHeight = Number(created_at);
        if (Number.isNaN(blockHeight)) {
            throw new Error(`Invalid block height returned: ${created_at}`);
        }
        return blockHeight;
    });

    // 3) Make a single range query to indexer for all blocks
    const minBlock = Math.min(...blockHeights);
    const maxBlock = Math.max(...blockHeights);

    const txUrl = `${INDEXER_BASE}/v0/chain/transactions`
        + `?from-block=${minBlock}&to-block=${maxBlock}`
        + `&order=asc`;

    const resp = await fetch(txUrl);
    if (!resp.ok) {
        throw new Error(`Indexer fetch failed: ${resp.status}`);
    }

    const json = (await resp.json()) as {
        ok: boolean;
        data: Array<{
            block_height: number;
            hash: string;
            sender: string;
            stamp_ms: number | null;
        }>;
    };

    if (!json.ok) {
        throw new Error("Indexer returned ok: false");
    }

    // 4) Build a map of blockHeight -> first transaction
    const blockToTx = new Map<number, {
        hash: string;
        sender: string;
        stamp_ms: number | null;
    }>();

    for (const tx of json.data) {
        // Only keep the first transaction per block
        if (!blockToTx.has(tx.block_height)) {
            blockToTx.set(tx.block_height, {
                hash: tx.hash,
                sender: tx.sender,
                stamp_ms: tx.stamp_ms,
            });
        }
    }

    // 5) Map back to original order with methods from SQL query
    return rows.map(({ created_at, method }) => {
        const blockHeight = Number(created_at);
        const tx = blockToTx.get(blockHeight);

        if (!tx) {
            return {
                blockHeight,
                method,
                sender: "(unknown)",
                transactionHash: "(unknown)",
                stampMs: 0,
            };
        }

        return {
            blockHeight,
            method,
            sender: tx.sender,
            transactionHash: tx.hash,
            stampMs: tx.stamp_ms ?? 0,
        };
    });
}
