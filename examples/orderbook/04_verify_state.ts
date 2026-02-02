/**
 * Order Book E2E Example - Step 4: Verify Final State
 *
 * Queries the order book state using SDK methods to verify results.
 */

import { Wallet } from "ethers";
import { NodeTNClient, bytesToHex } from "../../src/index.node";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Testnet configuration
const TESTNET_URL = "http://ec2-3-141-77-16.us-east-2.compute.amazonaws.com:8484";
const CHAIN_ID = "testnet-v1";

// WARNING: This is a throwaway private key provided for testnet examples only.
// DO NOT use this key for production or store any real funds in this wallet.
// Always use secure key management practices in production environments.
// Use Market Maker wallet for queries (any wallet works for read operations)
const MARKET_MAKER_PRIVATE_KEY =
  "1b94f77f8eeb3ff78aa091b0965bf1b54305e3af50f9a6cd24cb457edc8c77ed";

// Known wallet addresses for display
const WALLET_NAMES: Record<string, string> = {
  "0x32a46917df74808b9add7dc6ef0c34520412fdf3": "MarketCreator",
  "0xc11ff6d3cc60823ecdcab1089f1a4336053851ef": "MarketMaker",
  "0x1c6790935a3a1a6b914399ba743bec8c41fe89fb": "BuyerTaker",
  "0x51125fd33c366595d24aa42229085d30c95a62da": "SellerTaker",
};

function getWalletName(addressBytes: Uint8Array): string {
  const hex = bytesToHex(addressBytes).toLowerCase();
  return WALLET_NAMES[hex] || `${hex.slice(0, 10)}...`;
}

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
  console.log("=".repeat(70));
  console.log("Order Book E2E Example - Step 4: Verify Final State");
  console.log("=".repeat(70));

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

  console.log(`\nChecking Market ID: ${QUERY_ID}`);

  const orderbook = client.loadOrderbookAction();

  // Market info
  console.log(`\n--- Market Info ---`);
  try {
    const market = await orderbook.getMarketInfo(QUERY_ID);
    console.log(`  Query ID: ${market.id}`);
    console.log(`  Bridge: ${market.bridge}`);
    console.log(`  Settle Time: ${new Date(market.settleTime * 1000).toISOString()}`);
    console.log(`  Settled: ${market.settled}`);
    if (market.settled) {
      console.log(`  Winning Outcome: ${market.winningOutcome ? "YES" : "NO"}`);
    }
    console.log(`  Max Spread: ${market.maxSpread}c`);
    console.log(`  Min Order Size: ${market.minOrderSize}`);
  } catch (e) {
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
  }

  // Order book for YES
  console.log(`\n--- YES Order Book ---`);
  try {
    const yesOrders = await orderbook.getOrderBook(QUERY_ID, true);
    if (yesOrders.length > 0) {
      console.log(`  ${"Wallet".padEnd(14)} | ${"Price".padStart(6)} | ${"Amount".padStart(8)} | ${"Type".padStart(8)}`);
      console.log(`  ${"-".repeat(14)} | ${"-".repeat(6)} | ${"-".repeat(8)} | ${"-".repeat(8)}`);
      for (const order of yesOrders) {
        const walletName = getWalletName(order.walletAddress);
        let orderType: string;
        if (order.price === 0) {
          orderType = "HOLDING";
        } else if (order.price < 0) {
          orderType = "BUY";
        } else {
          orderType = "SELL";
        }
        console.log(
          `  ${walletName.padEnd(14)} | ${Math.abs(order.price).toString().padStart(5)}c | ${order.amount.toString().padStart(8)} | ${orderType.padStart(8)}`
        );
      }
    } else {
      console.log(`  No orders`);
    }
  } catch (e) {
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
  }

  // Order book for NO
  console.log(`\n--- NO Order Book ---`);
  try {
    const noOrders = await orderbook.getOrderBook(QUERY_ID, false);
    if (noOrders.length > 0) {
      console.log(`  ${"Wallet".padEnd(14)} | ${"Price".padStart(6)} | ${"Amount".padStart(8)} | ${"Type".padStart(8)}`);
      console.log(`  ${"-".repeat(14)} | ${"-".repeat(6)} | ${"-".repeat(8)} | ${"-".repeat(8)}`);
      for (const order of noOrders) {
        const walletName = getWalletName(order.walletAddress);
        let orderType: string;
        if (order.price === 0) {
          orderType = "HOLDING";
        } else if (order.price < 0) {
          orderType = "BUY";
        } else {
          orderType = "SELL";
        }
        console.log(
          `  ${walletName.padEnd(14)} | ${Math.abs(order.price).toString().padStart(5)}c | ${order.amount.toString().padStart(8)} | ${orderType.padStart(8)}`
        );
      }
    } else {
      console.log(`  No orders`);
    }
  } catch (e) {
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
  }

  // Best prices
  console.log(`\n--- Best Prices ---`);
  for (const [outcomeName, outcome] of [
    ["YES", true],
    ["NO", false],
  ] as const) {
    try {
      const prices = await orderbook.getBestPrices(QUERY_ID, outcome);
      console.log(
        `  ${outcomeName}: Bid=${prices.bestBid ?? "N/A"}c, Ask=${prices.bestAsk ?? "N/A"}c, Spread=${prices.spread ?? "N/A"}c`
      );
    } catch (e) {
      console.log(`  ${outcomeName}: Error - ${e instanceof Error ? e.message : e}`);
    }
  }

  // Market depth
  console.log(`\n--- Market Depth (YES) ---`);
  try {
    const depth = await orderbook.getMarketDepth(QUERY_ID, true);
    if (depth.length > 0) {
      console.log(`  ${"Price".padStart(6)} | ${"Buy Vol".padStart(10)} | ${"Sell Vol".padStart(10)}`);
      console.log(`  ${"-".repeat(6)} | ${"-".repeat(10)} | ${"-".repeat(10)}`);
      for (const level of depth) {
        console.log(`  ${level.price.toString().padStart(5)}c | ${level.buyVolume.toString().padStart(10)} | ${level.sellVolume.toString().padStart(10)}`);
      }
    } else {
      console.log(`  No depth data`);
    }
  } catch (e) {
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
  }

  // Collateral validation
  console.log(`\n--- Market Collateral Validation ---`);
  try {
    const validation = await orderbook.validateMarketCollateral(QUERY_ID);
    console.log(`  Valid Token Binaries: ${validation.validTokenBinaries}`);
    console.log(`  Valid Collateral: ${validation.validCollateral}`);
    console.log(`  Total YES: ${validation.totalTrue}`);
    console.log(`  Total NO: ${validation.totalFalse}`);
    console.log(`  Vault Balance: ${validation.vaultBalance}`);
    console.log(`  Expected Collateral: ${validation.expectedCollateral}`);
    console.log(`  Open Buys Value: ${validation.openBuysValue}`);
  } catch (e) {
    console.log(`  Error: ${e instanceof Error ? e.message : e}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("Verification Complete!");
  console.log("=".repeat(70));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
