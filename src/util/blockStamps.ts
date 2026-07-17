import { NodeKwil, WebKwil } from "@trufnetwork/kwil-js";

const INDEXER_BASE = "https://indexer.infra.truf.network";

/**
 * Resolves block heights to their block time in unix milliseconds, reading each
 * block's timestamp directly from the node's block header and falling back to
 * the chain indexer only for blocks the node no longer retains.
 *
 * The node always has the header for any block it still holds — including the
 * newest tip block — so this avoids the indexer's tip lag, which is what made
 * the freshest transactions report a missing (stampMs=0) age. For older blocks
 * the node has pruned after a state-sync, the indexer supplies the stamp.
 *
 * Heights that neither source can resolve are simply absent from the returned
 * map; callers apply their own `?? 0` "unknown timestamp" fallback.
 */
export async function resolveBlockStamps(
  kwilClient: WebKwil | NodeKwil,
  blockHeights: number[]
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const distinct = Array.from(new Set(blockHeights)).filter(
    (h) => Number.isFinite(h) && h >= 0
  );
  if (distinct.length === 0) return result;

  // Primary: read the block time straight from the node's block header.
  const missing: number[] = [];
  await Promise.all(
    distinct.map(async (height) => {
      try {
        const res = await kwilClient.blockHeader(height);
        const stampMs = res.data?.stampMs;
        if (typeof stampMs === "number" && stampMs > 0) {
          result.set(height, stampMs);
          return;
        }
      } catch {
        // Block not retained by the node (pruned below its state-sync cutoff)
        // or the chain RPC service is disabled — fall back to the indexer.
      }
      missing.push(height);
    })
  );

  // Fallback: the indexer, for blocks the node has dropped.
  if (missing.length > 0) {
    const fromIndexer = await fetchBlockStampsFromIndexer(missing);
    for (const [height, stampMs] of fromIndexer) {
      result.set(height, stampMs);
    }
  }

  return result;
}

/**
 * Best-effort lookup of block timestamps from the chain indexer. Returns a map
 * of block height -> stamp_ms (ms) for every block found in the queried range;
 * blocks the indexer has not stamped (or an indexer error) are simply omitted.
 */
export async function fetchBlockStampsFromIndexer(
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
      data: Array<{ block_height: number; stamp_ms: number | null }> | null;
    };
    if (!json.ok || !Array.isArray(json.data)) return result;
    for (const tx of json.data) {
      if (tx.stamp_ms != null && !result.has(tx.block_height)) {
        result.set(tx.block_height, tx.stamp_ms);
      }
    }
  } catch {
    // Indexer timestamp lookup is best-effort; callers fall back to 0.
  }
  return result;
}
