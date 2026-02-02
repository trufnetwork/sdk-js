/**
 * Order Book E2E Example - Step 1: Create Market
 *
 * Creates a prediction market: "Will Bitcoin be above $85,000?"
 *
 * Uses OBMarketCreator wallet to create the market on TrufNetwork testnet.
 * The market uses hoodi_tt2 (USDC) as collateral.
 */

import { Wallet } from "ethers";
import { NodeTNClient, OrderbookAction } from "../../src/index.node";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Testnet configuration
const TESTNET_URL = "http://ec2-3-141-77-16.us-east-2.compute.amazonaws.com:8484";
const CHAIN_ID = "testnet-v1";

// WARNING: This is a throwaway private key provided for testnet examples only.
// DO NOT use this key for production or store any real funds in this wallet.
// Always use secure key management practices in production environments.
const MARKET_CREATOR_PRIVATE_KEY =
  "a537437df2ed8d3bcb3b99b4f88818cadf8ac365cd0a66595bb50973ac4ecf51";
const MARKET_CREATOR_ADDRESS = "0x32a46917DF74808b9aDD7DC6eF0c34520412FDF3";

// Bitcoin stream configuration (active stream with fresh price data)
const BITCOIN_STREAM_ID = "st9058219c3c3247faf2b0a738de7027";
const DATA_PROVIDER = "0xe5252596672cd0208a881bdb67c9df429916ba92";

// Market parameters
const THRESHOLD = "78000"; // Will BTC be above $78,000?
const BRIDGE = "hoodi_tt2"; // USDC collateral
const MAX_SPREAD = 10; // 10 cents max spread for LP rewards
// Note: Using a smaller value here as kwil-js doesn't support BigInt for INT8 yet
// For production with 18-decimal tokens, the kwil-js library needs to be updated
const MIN_ORDER_SIZE = 1000; // Minimum order size (simplified for testing)

async function main() {
  console.log("=".repeat(60));
  console.log("Order Book E2E Example - Step 1: Create Market");
  console.log("=".repeat(60));

  // Initialize client
  const wallet = new Wallet(MARKET_CREATOR_PRIVATE_KEY);
  const client = new NodeTNClient({
    endpoint: TESTNET_URL,
    signerInfo: {
      address: wallet.address,
      signer: wallet,
    },
    chainId: CHAIN_ID,
  });

  console.log(`\nConnecting to testnet: ${TESTNET_URL}`);
  console.log(`Market Creator: OBMarketCreator (${MARKET_CREATOR_ADDRESS})`);

  // Load orderbook action
  const orderbook = client.loadOrderbookAction();

  // Set settlement time (30 minutes from now for testing)
  const now = Math.floor(Date.now() / 1000);
  const settleTime = now + 30 * 60; // 30 minutes from now
  const timestamp = settleTime; // Check price at settlement
  const frozenAt = 0; // Use latest data

  console.log(`\nMarket Parameters:`);
  console.log(`  Question: "Will BTC be above $${THRESHOLD} at settlement?"`);
  console.log(`  Settlement Time: ${new Date(settleTime * 1000).toISOString()}`);
  console.log(`  Data Provider: ${DATA_PROVIDER}`);
  console.log(`  Stream ID: ${BITCOIN_STREAM_ID}`);
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Max Spread: ${MAX_SPREAD} cents`);

  // Create market using convenience method
  console.log(`\nCreating market...`);
  const createResult = await orderbook.createPriceAboveThresholdMarket({
    dataProvider: DATA_PROVIDER,
    streamId: BITCOIN_STREAM_ID,
    timestamp,
    threshold: THRESHOLD,
    frozenAt,
    bridge: BRIDGE,
    settleTime,
    maxSpread: MAX_SPREAD,
    minOrderSize: MIN_ORDER_SIZE,
  });

  if (!createResult.data?.tx_hash) {
    throw new Error("Failed to create market: no transaction hash");
  }

  console.log(`  Transaction: ${createResult.data.tx_hash}`);

  // Wait for transaction
  console.log(`  Waiting for confirmation...`);
  await client.waitForTx(createResult.data.tx_hash, 30000);
  console.log(`  Market created successfully!`);

  // Get the market ID from listing
  const markets = await orderbook.listMarkets({ limit: 1 });
  if (markets.length === 0) {
    throw new Error("No markets found after creation");
  }

  const queryId = markets[0].id;
  console.log(`\nMarket ID: ${queryId}`);

  // Save query_id for other scripts
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const queryIdFile = path.join(scriptDir, ".query_id");
  fs.writeFileSync(queryIdFile, queryId.toString());
  console.log(`  Saved to: ${queryIdFile}`);

  // Display market info
  const marketInfo = await orderbook.getMarketInfo(queryId);
  console.log(`\nMarket Info:`);
  console.log(`  ID: ${marketInfo.id}`);
  console.log(`  Bridge: ${marketInfo.bridge}`);
  console.log(`  Settle Time: ${new Date(marketInfo.settleTime * 1000).toISOString()}`);
  console.log(`  Settled: ${marketInfo.settled}`);
  console.log(`  Max Spread: ${marketInfo.maxSpread}c`);
  console.log(`  Min Order Size: ${marketInfo.minOrderSize}`);

  console.log("\n" + "=".repeat(60));
  console.log("Market Created Successfully!");
  console.log("Run 02_place_orders.ts next to provide liquidity.");
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
