import { WebKwil, NodeKwil, KwilSigner } from "@kwilteam/kwil-js";
import { GetLastTransactionsInput } from "./client";
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

    const rows =
        (res.data?.result as { created_at: number; method: string }[]) || [];

    // 2) for each row, hit the indexer to grab sender & tx hash
    return Promise.all(
        rows.map(async (r) => {
            const url = `${INDEXER_BASE}/v0/chain/transactions`
                + `?from-block=${r.created_at}`
                + `&to-block=${r.created_at}`
                + `&order=asc&limit=1`;

            const resp = await fetch(url);
            if (!resp.ok) {
                throw new Error(`Indexer fetch failed: ${resp.status}`);
            }
            const json = await resp.json() as {
                ok: boolean;
                data: Array<{
                    hash: string;
                    sender: string;
                    /* ... */
                }>;
            };

            const tx = json.data[0];
            return {
                blockHeight: r.created_at,
                method: r.method,
                sender: tx.sender,
                transactionHash: tx.hash,
            };
        })
    );
}
