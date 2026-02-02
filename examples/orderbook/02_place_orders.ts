/**
 * Order Book E2E Example - Step 2: Place Orders
 *
 * Market Maker provides two-sided liquidity to earn LP rewards.
 * Uses OBMarketMaker wallet.
 *
 * Order Book Strategy:
 * 1. Place split limit orders to create YES holdings (needed for selling)
 * 2. Place LP-eligible paired orders: YES SELL + NO BUY at complementary prices
 *
 * LP Rewards Eligibility:
 * - Formula: yes_price == 100 + no_price (where no_price is negative for BUY)
 * - Example: YES SELL @ 55 + NO BUY @ 45 → 55 == 100 + (-45) ✓
 * - Both orders must have the same amount
 */

import { Wallet } from "ethers";
import { NodeTNClient } from "../../src/index.node";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Testnet configuration
const TESTNET_URL = "http://ec2-3-141-77-16.us-east-2.compute.amazonaws.com:8484";
const CHAIN_ID = "testnet-v1";

// WARNING: This is a throwaway private key provided for testnet examples only.
// DO NOT use this key for production or store any real funds in this wallet.
// Always use secure key management practices in production environments.
const MARKET_MAKER_PRIVATE_KEY =
  "1b94f77f8eeb3ff78aa091b0965bf1b54305e3af50f9a6cd24cb457edc8c77ed";
const MARKET_MAKER_ADDRESS = "0xc11Ff6d3cC60823EcDCAB1089F1A4336053851EF";

function getQueryId(): number {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const queryIdFile = path.join(scriptDir, ".query_id");
  try {
    const content = fs.readFileSync(queryIdFile, "utf-8").trim();
    const queryId = parseInt(content, 10);
    if (!Number.isInteger(queryId)) {
      console.error(`Error: Invalid query_id in ${queryIdFile}: "${content}"`);
      process.exit(1);
    }
    return queryId;
  } catch {
    console.error(`Error: ${queryIdFile} not found. Run 01_create_market.ts first.`);
    process.exit(1);
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Order Book E2E Example - Step 2: Place Orders");
  console.log("=".repeat(60));

  const QUERY_ID = getQueryId();

  // Initialize client
  const wallet = new Wallet(MARKET_MAKER_PRIVATE_KEY);
  const client = new NodeTNClient({
    endpoint: TESTNET_URL,
    signerInfo: {
      address: wallet.address,
      signer: wallet,
    },
    chainId: CHAIN_ID,
  });

  console.log(`\nMarket Maker: OBMarketMaker (${wallet.address})`);
  console.log(`Market ID: ${QUERY_ID}`);

  const orderbook = client.loadOrderbookAction();

  // ==========================================================================
  // Step 1: Create YES holdings via split limit orders
  // ==========================================================================
  console.log(`\n--- Step 1: Create YES Holdings (Split Limit Orders) ---`);
  console.log(`These create YES shares we can sell for LP rewards.`);

  const splitOrders = [
    { truePrice: 60, amount: 100 },
    { truePrice: 55, amount: 50 },
  ];

  for (const order of splitOrders) {
    console.log(`\n  Creating ${order.amount} YES holdings @ ${order.truePrice}c...`);
    const result = await orderbook.placeSplitLimitOrder({
      queryId: QUERY_ID,
      truePrice: order.truePrice,
      amount: order.amount,
    });
    if (!result.data?.tx_hash) {
      throw new Error("Failed to place split limit order");
    }
    await client.waitForTx(result.data.tx_hash, 30000);
    console.log(`    Done: ${order.amount} YES holdings + ${order.amount} NO sell @ ${100 - order.truePrice}c`);
  }

  // ==========================================================================
  // Step 2: Place LP-eligible paired orders (YES SELL + NO BUY)
  // ==========================================================================
  console.log(`\n--- Step 2: Place LP-Eligible Orders ---`);
  console.log(`Formula: YES_SELL_PRICE == 100 + NO_BUY_PRICE`);
  console.log(`(NO BUY stored as negative in DB, so prices must sum to 100)`);

  // LP pairs: YES SELL @ X + NO BUY @ (100-X)
  const lpPairs = [
    { yesPrice: 55, noPrice: 45, amount: 25 },
    { yesPrice: 52, noPrice: 48, amount: 25 },
    { yesPrice: 50, noPrice: 50, amount: 25 },
  ];

  for (const pair of lpPairs) {
    console.log(`\n  LP Pair: YES SELL @ ${pair.yesPrice}c + NO BUY @ ${pair.noPrice}c (amount: ${pair.amount})`);

    // Place YES sell order (we have YES holdings from split limit orders)
    const sellResult = await orderbook.placeSellOrder({
      queryId: QUERY_ID,
      outcome: true, // YES
      price: pair.yesPrice,
      amount: pair.amount,
    });
    if (!sellResult.data?.tx_hash) {
      throw new Error("Failed to place YES sell order: no transaction hash");
    }
    await client.waitForTx(sellResult.data.tx_hash, 30000);
    console.log(`    YES SELL: ${sellResult.data.tx_hash.slice(0, 16)}...`);

    // Place NO buy order at complementary price
    const buyResult = await orderbook.placeBuyOrder({
      queryId: QUERY_ID,
      outcome: false, // NO
      price: pair.noPrice,
      amount: pair.amount,
    });
    if (!buyResult.data?.tx_hash) {
      throw new Error("Failed to place NO buy order: no transaction hash");
    }
    await client.waitForTx(buyResult.data.tx_hash, 30000);
    console.log(`    NO BUY:   ${buyResult.data.tx_hash.slice(0, 16)}...`);

    // Verify LP eligibility
    const check = pair.yesPrice === 100 - pair.noPrice;
    console.log(`    LP Check: ${pair.yesPrice} + ${pair.noPrice} = ${pair.yesPrice + pair.noPrice} ${check ? "✓" : "✗"}`);
  }

  // ==========================================================================
  // Step 3: Display positions
  // ==========================================================================
  console.log(`\n--- Current Positions ---`);
  const allPositions = await orderbook.getUserPositions();
  const positions = allPositions.filter((p) => p.queryId === QUERY_ID);

  if (positions.length > 0) {
    console.log(`  ${"Outcome".padEnd(8)} | ${"Price".padStart(6)} | ${"Amount".padStart(8)} | ${"Type".padStart(8)}`);
    console.log(`  ${"-".repeat(8)} | ${"-".repeat(6)} | ${"-".repeat(8)} | ${"-".repeat(8)}`);
    for (const pos of positions) {
      const outcome = pos.outcome ? "YES" : "NO";
      let orderType: string;
      if (pos.price === 0) {
        orderType = "HOLDING";
      } else if (pos.price < 0) {
        orderType = "BUY";
      } else {
        orderType = "SELL";
      }
      console.log(
        `  ${outcome.padEnd(8)} | ${Math.abs(pos.price).toString().padStart(5)}c | ${pos.amount.toString().padStart(8)} | ${orderType.padStart(8)}`
      );
    }
  }

  // ==========================================================================
  // Step 4: Display market prices
  // ==========================================================================
  console.log(`\n--- Market Prices ---`);
  for (const [name, outcome] of [
    ["YES", true],
    ["NO", false],
  ] as const) {
    const prices = await orderbook.getBestPrices(QUERY_ID, outcome);
    console.log(
      `  ${name}: Bid=${prices.bestBid ?? "N/A"}c, Ask=${prices.bestAsk ?? "N/A"}c, Spread=${prices.spread ?? "N/A"}c`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("Orders Placed Successfully!");
  console.log("LP rewards will be sampled every 10 blocks by the scheduler.");
  console.log("Run 03_take_orders.ts next to execute trades.");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
