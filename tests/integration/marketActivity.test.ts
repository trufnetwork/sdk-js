/**
 * Live-network check that getMarketActivity reads get_market_activity from a
 * real node and that the figures it returns hang together.
 *
 * The unit tests prove the arguments and the mapping of a captured row, and the
 * node's own tests prove the action's definition on a local chain. What they
 * cannot prove is that a live network serves the action to this SDK and
 * filters the window the way the definition says. That is the gap this file
 * covers.
 *
 * Gated, because it needs a network carrying markets with real fills:
 *
 *     TEST_MAINNET_ENDPOINT=https://gateway.mainnet.truf.network \
 *     TEST_MAINNET_CHAIN_ID=tn-v2.1 \
 *     npx vitest run tests/integration/marketActivity.test.ts
 *
 * The network must run a node carrying get_market_activity (node migration
 * 058). The action is a view, so the signing wallet needs no funds and controls
 * nothing; a throwaway is generated.
 *
 * These assert INVARIANTS, not numbers. The node trims order events once they
 * are indexed, so figures pinned here would drift.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { Wallet } from "ethers";
import { NodeTNClient } from "../../src/client/nodeClient";
import type { OrderbookAction } from "../../src/contracts-api/orderbookAction";
import type { MarketActivity } from "../../src/types/orderbook";

// How far back the suite looks for fills.
const ACTIVITY_WINDOW_SECONDS = 30 * 24 * 3600;

// Discovery reads the action once per market, newest market first, so it is
// bounded.
const MAX_MARKETS_SCANNED = 100;

// A live market can take a fill, or lose old events to a trim, between two
// reads. A check that needs several reads to agree retries this many times.
const STABLE_READ_ATTEMPTS = 3;

// No market has this id: query_id is an INT and this is its largest value.
const MISSING_MARKET = 2_147_483_647;

const endpoint = process.env.TEST_MAINNET_ENDPOINT;
const chainId = process.env.TEST_MAINNET_CHAIN_ID;
const configured = Boolean(endpoint && chainId);

/** The part of an activity that depends only on the fills in the window. */
function fillsOf(activity: MarketActivity) {
  // Coverage is left out: it moves whenever the node trims old events.
  const {
    coverageFromBlock: _from,
    coverageComplete: _complete,
    ...fills
  } = activity;
  return fills;
}

/** The newest market with a fill inside the window, with its activity. */
async function findMarketWithFills(
  orderbook: OrderbookAction,
  fromTs: number,
  toTs: number
): Promise<{ queryId: number; activity: MarketActivity } | null> {
  const limit = 100;
  let scanned = 0;
  for (let offset = 0; scanned < MAX_MARKETS_SCANNED; offset += limit) {
    // Newest first: list_markets orders by creation.
    const page = await orderbook.listMarkets({ limit, offset });
    for (const market of page) {
      if (scanned >= MAX_MARKETS_SCANNED) break;
      scanned += 1;

      const activity = await orderbook.getMarketActivity(
        market.id,
        fromTs,
        toTs
      );
      if (activity.fillCount > 0) {
        console.log(`market ${market.id} has fills; found after ${scanned}`);
        return { queryId: market.id, activity };
      }
    }
    if (page.length < limit) break;
  }
  return null;
}

describe.skipIf(!configured)(
  "Market Activity Live Integration Tests",
  { timeout: 600000 },
  () => {
    let orderbook: OrderbookAction;
    const toTs = Math.floor(Date.now() / 1000);
    const fromTs = toTs - ACTIVITY_WINDOW_SECONDS;
    let found: { queryId: number; activity: MarketActivity } | null = null;

    beforeAll(async () => {
      const wallet = Wallet.createRandom();
      const client = new NodeTNClient({
        endpoint: endpoint!,
        signerInfo: { address: wallet.address, signer: wallet },
        chainId: chainId!,
        timeout: 30000,
      });
      orderbook = client.loadOrderbookAction();

      found = await findMarketWithFills(orderbook, fromTs, toTs);
      if (found) {
        console.log(
          `market ${found.queryId}, window [${fromTs}, ${toTs}]:`,
          JSON.stringify(found.activity)
        );
      }
    });

    /** Guards the tests that need fills: a quiet month is not a defect. */
    function live(): { queryId: number; activity: MarketActivity } | null {
      if (found === null) {
        console.warn(
          `skipping: none of the newest ${MAX_MARKETS_SCANNED} markets has a fill in the window`
        );
      }
      return found;
    }

    test("the figures hang together", () => {
      const it = live();
      if (!it) return;
      const { activity } = it;

      expect(activity.bridge).not.toBe("");
      expect(BigInt(activity.volumeCents)).toBe(
        BigInt(activity.directCents) + BigInt(activity.mintBurnCents)
      );
      expect(activity.directFillCount).toBeLessThanOrEqual(activity.fillCount);
      expect(activity.uniqueTraders).toBeGreaterThanOrEqual(1);

      expect(activity.firstEventTs).not.toBeNull();
      expect(activity.lastEventTs).not.toBeNull();
      expect(activity.firstEventTs!).toBeGreaterThanOrEqual(fromTs);
      expect(activity.firstEventTs!).toBeLessThanOrEqual(activity.lastEventTs!);
      expect(activity.lastEventTs!).toBeLessThanOrEqual(toTs);
    });

    test("the window includes both of its ends", async () => {
      const it = live();
      if (!it) return;
      const { queryId } = it;

      // Narrow the window to the first and last fill inside it. It must count
      // exactly the same fills, which holds only if both bounds are inclusive,
      // and the seconds just outside it must count none. Reading the full
      // window again afterwards and finding it unchanged shows the reads in
      // between saw the same fills.
      for (let attempt = 1; attempt <= STABLE_READ_ATTEMPTS; attempt++) {
        const before = await orderbook.getMarketActivity(queryId, fromTs, toTs);
        if (before.firstEventTs === null || before.lastEventTs === null) {
          console.warn(`skipping: market ${queryId} lost its fills`);
          return;
        }
        const first = before.firstEventTs;
        const last = before.lastEventTs;

        const narrow = await orderbook.getMarketActivity(queryId, first, last);
        const head =
          first > fromTs
            ? await orderbook.getMarketActivity(queryId, fromTs, first - 1)
            : null;
        const tail =
          last < toTs
            ? await orderbook.getMarketActivity(queryId, last + 1, toTs)
            : null;

        const after = await orderbook.getMarketActivity(queryId, fromTs, toTs);
        if (
          JSON.stringify(fillsOf(before)) !== JSON.stringify(fillsOf(after))
        ) {
          console.log(`market ${queryId} moved during attempt ${attempt}`);
          continue;
        }

        expect(fillsOf(narrow)).toEqual(fillsOf(before));
        if (head) {
          expect(head.fillCount).toBe(0);
          expect(head.firstEventTs).toBeNull();
        }
        if (tail) {
          expect(tail.fillCount).toBe(0);
          expect(tail.lastEventTs).toBeNull();
        }
        return;
      }
      console.warn(
        `skipping: market ${queryId} kept moving across ${STABLE_READ_ATTEMPTS} attempts`
      );
    });

    test("a market that does not exist is an error", async () => {
      await expect(
        orderbook.getMarketActivity(MISSING_MARKET, fromTs, toTs)
      ).rejects.toThrow(`Market not found: ${MISSING_MARKET}`);
    });
  }
);
