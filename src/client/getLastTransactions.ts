import { WebKwil, NodeKwil, KwilSigner } from "@kwilteam/kwil-js";
import { GetLastTransactionsInput } from "./client";
import { LastTransaction } from "../types/transaction";

const INDEXER_BASE = "https://indexer.infra.truf.network";
const RPC_URL      = "https://gateway.mainnet.truf.network/rpc/v1";

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

    // 2) build per-block Promises
    const tasks = rows.map(({ created_at, method }) => {
        const blockHeight = Number(created_at);
        if (Number.isNaN(blockHeight)) {
            return Promise.reject(new Error(`Invalid block height returned: ${created_at}`));
        }

        const txUrl = `${INDEXER_BASE}/v0/chain/transactions`
            + `?from-block=${blockHeight}&to-block=${blockHeight}`
            + `&order=asc&limit=1`;

        // INDEXER: always return a { sender, hash } object
        const txPromise = fetch(txUrl).then(async (resp) => {
            if (!resp.ok) throw new Error(`Indexer fetch failed: ${resp.status}`);
            const json = (await resp.json()) as {
                ok: boolean;
                data: Array<{ hash: string; sender: string }>;
            };
            if (!json.ok || json.data.length === 0) {
                return { sender: "(unknown)", hash: "(unknown)" };
            }
            const { hash, sender } = json.data[0];
            return { sender, hash };
        });

        // RPC: get stamp_ms
        const rpcPromise = fetch(RPC_URL, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
                jsonrpc: "2.0",
                method:  "chain.block",
                params:  { height: blockHeight },
                id:      1,
            }),
        }).then(async (resp) => {
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`RPC fetch failed: ${resp.status} – ${txt}`);
            }
            const rpc = (await resp.json()) as {
                result: { block: { header: { stamp_ms: number } } };
            };
            return rpc.result.block.header.stamp_ms;
        });

        // wait for both
        return Promise.all([txPromise, rpcPromise]).then(
            ([{ sender, hash }, stampMs]) => ({
                blockHeight,
                method,
                sender,
                transactionHash: hash,
                stampMs,
            })
        );
    });

    // 3) await all in parallel
    return Promise.all(tasks);
}
