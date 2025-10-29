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

    // 3) Build a map for storing results
    const blockToTx = new Map<number, {
        hash: string;
        sender: string;
        stamp_ms: number | null;
    }>();

    // 4) Fetch all blocks with iterative bulk range queries (up to 3 attempts)
    let missingBlocks = [...blockHeights]; // All blocks start as missing
    let attempts = 0;
    const maxAttempts = 3;

    while (missingBlocks.length > 0 && attempts < maxAttempts) {
        attempts++;
        const missingMin = Math.min(...missingBlocks);
        const missingMax = Math.max(...missingBlocks);

        // Always use bulk range query to minimize API calls
        const rangeUrl = `${INDEXER_BASE}/v0/chain/transactions?from-block=${missingMin}&to-block=${missingMax}&order=desc`;

        try {
            const rangeResp = await fetch(rangeUrl);

            if (!rangeResp.ok) {
                console.warn(`Indexer returned ${rangeResp.status} for range ${missingMin}-${missingMax}`);
                continue;
            }

            try {
                const rangeJson = await rangeResp.json() as {
                    ok: boolean;
                    data: Array<{
                        block_height: number;
                        hash: string;
                        sender: string;
                        stamp_ms: number | null;
                    }>;
                };

                if (rangeJson.ok) {
                    for (const tx of rangeJson.data) {
                        if (!blockToTx.has(tx.block_height)) {
                            blockToTx.set(tx.block_height, {
                                hash: tx.hash,
                                sender: tx.sender,
                                stamp_ms: tx.stamp_ms,
                            });
                        }
                    }
                } else {
                    console.warn(`Indexer returned ok:false for range ${missingMin}-${missingMax}`);
                }
            } catch (parseError) {
                console.warn(`Failed to parse JSON response for range ${missingMin}-${missingMax}:`, parseError);
            }
        } catch (fetchError) {
            console.warn(`Failed to fetch transactions for range ${missingMin}-${missingMax}:`, fetchError);
        }

        // Update missing blocks for next iteration
        const previousMissing = missingBlocks.length;
        missingBlocks = blockHeights.filter(height => !blockToTx.has(height));

        // If no progress was made, break to avoid infinite loop
        if (missingBlocks.length === previousMissing) {
            break;
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
