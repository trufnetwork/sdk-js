/**
 * Order Book E2E Example - Step 3: Takers Execute Trades
 *
 * Buyer and Seller takers execute against Market Maker's orders.
 *
 * - OBBuyerTaker: Buys YES shares (takes from NO sell orders)
 * - OBSellerTaker: Sells YES shares (takes from YES buy orders)
 */

import { Wallet } from "ethers";
import { NodeTNClient } from "../../src/index.node";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Testnet configuration
const TESTNET_URL = "http://ec2-3-141-77-16.us-east-2.compute.amazonaws.com:8484";
const CHAIN_ID = "testnet-v1";

// WARNING: These are throwaway private keys provided for testnet examples only.
// DO NOT use these keys for production or store any real funds in these wallets.
// Always use secure key management practices in production environments.
const BUYER_TAKER_PRIVATE_KEY =
  "9b70937b21176cfa48f0859f4063c66a7998964cc2dfde873ef3d54c8fe04d74";
const BUYER_TAKER_ADDRESS = "0x1c6790935a3a1A6B914399Ba743BEC8C41Fe89Fb";

const SELLER_TAKER_PRIVATE_KEY =
  "9ce79cafa66d736da853941c5cd32f996d5e45a29d3001ba6b8d51bdfa608b97";
const SELLER_TAKER_ADDRESS = "0x51125FD33c366595d24aa42229085D30c95a62dA";

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
  console.log("Order Book E2E Example - Step 3: Take Orders");
  console.log("=".repeat(60));

  const QUERY_ID = getQueryId();

  // Initialize buyer taker client
  const buyerWallet = new Wallet(BUYER_TAKER_PRIVATE_KEY);
  const buyerClient = new NodeTNClient({
    endpoint: TESTNET_URL,
    signerInfo: {
      address: buyerWallet.address,
      signer: buyerWallet,
    },
    chainId: CHAIN_ID,
  });

  // Initialize seller taker client
  const sellerWallet = new Wallet(SELLER_TAKER_PRIVATE_KEY);
  const sellerClient = new NodeTNClient({
    endpoint: TESTNET_URL,
    signerInfo: {
      address: sellerWallet.address,
      signer: sellerWallet,
    },
    chainId: CHAIN_ID,
  });

  console.log(`\nBuyer Taker: OBBuyerTaker (${BUYER_TAKER_ADDRESS})`);
  console.log(`Seller Taker: OBSellerTaker (${SELLER_TAKER_ADDRESS})`);
  console.log(`Market ID: ${QUERY_ID}`);

  const buyerOrderbook = buyerClient.loadOrderbookAction();
  const sellerOrderbook = sellerClient.loadOrderbookAction();

  // Step 1: Buyer purchases YES shares
  console.log(`\n--- Buyer Taker: Purchasing YES Shares ---`);

  // Place a buy order that will match with existing sell orders
  console.log(`  Placing buy order: 20 YES shares at 60c...`);
  const buyResult = await buyerOrderbook.placeBuyOrder({
    queryId: QUERY_ID,
    outcome: true, // YES
    price: 60, // Match the 60c ask
    amount: 20,
  });

  if (!buyResult.data?.tx_hash) {
    throw new Error("Failed to place buy order: no transaction hash");
  }
  console.log(`  Transaction: ${buyResult.data.tx_hash}`);
  await buyerClient.waitForTx(buyResult.data.tx_hash, 30000);
  console.log(`  Order executed!`);

  // Step 2: Seller creates shares and sells
  console.log(`\n--- Seller Taker: Selling via Split Limit Order ---`);

  // Use split limit order to create shares and immediately list for sale
  console.log(`  Creating 30 pairs and selling NO at 35c...`);
  const splitResult = await sellerOrderbook.placeSplitLimitOrder({
    queryId: QUERY_ID,
    truePrice: 65, // Keep YES at 65c, sell NO at 35c
    amount: 30,
  });

  if (!splitResult.data?.tx_hash) {
    throw new Error("Failed to place split limit order: no transaction hash");
  }
  console.log(`  Transaction: ${splitResult.data.tx_hash}`);
  await sellerClient.waitForTx(splitResult.data.tx_hash, 30000);
  console.log(`  Shares created and NO listed!`);

  // Step 3: Display buyer's positions
  console.log(`\n--- Buyer's Positions ---`);
  const buyerPositions = await buyerOrderbook.getUserPositions();
  const buyerMarketPositions = buyerPositions.filter((p) => p.queryId === QUERY_ID);

  if (buyerMarketPositions.length > 0) {
    for (const pos of buyerMarketPositions) {
      const outcome = pos.outcome ? "YES" : "NO";
      const type = pos.price === 0 ? "HOLDING" : pos.price < 0 ? "BUY" : "SELL";
      console.log(`  ${outcome} ${type}: ${pos.amount} shares at ${Math.abs(pos.price)}c`);
    }
  } else {
    console.log(`  No positions`);
  }

  // Step 4: Display seller's positions
  console.log(`\n--- Seller's Positions ---`);
  const sellerPositions = await sellerOrderbook.getUserPositions();
  const sellerMarketPositions = sellerPositions.filter((p) => p.queryId === QUERY_ID);

  if (sellerMarketPositions.length > 0) {
    for (const pos of sellerMarketPositions) {
      const outcome = pos.outcome ? "YES" : "NO";
      const type = pos.price === 0 ? "HOLDING" : pos.price < 0 ? "BUY" : "SELL";
      console.log(`  ${outcome} ${type}: ${pos.amount} shares at ${Math.abs(pos.price)}c`);
    }
  } else {
    console.log(`  No positions`);
  }

  // Step 5: Display updated market prices
  console.log(`\n--- Updated Market Prices ---`);
  for (const [name, outcome] of [
    ["YES", true],
    ["NO", false],
  ] as const) {
    const prices = await buyerOrderbook.getBestPrices(QUERY_ID, outcome);
    console.log(
      `  ${name}: Bid=${prices.bestBid ?? "N/A"}c, Ask=${prices.bestAsk ?? "N/A"}c, Spread=${prices.spread ?? "N/A"}c`
    );
  }

  console.log("\n" + "=".repeat(60));
  console.log("Trades Executed Successfully!");
  console.log("Run 04_verify_state.ts to view the final order book state.");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
