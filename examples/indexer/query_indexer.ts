/**
 * Prediction Market Indexer API Example (TypeScript)
 *
 * Demonstrates how to query the TrufNetwork Prediction Market Indexer
 * to retrieve historical market data, settlements, snapshots, and LP rewards.
 *
 * For full API documentation, endpoint details, field descriptions, and architecture:
 *   https://github.com/trufnetwork/node/blob/main/docs/prediction-market-indexer.md
 *
 * Usage:
 *   cd examples && npx tsx indexer/query_indexer.ts
 */

// Indexer URLs
// Production: https://indexer.infra.truf.network
// Testnet:    http://ec2-52-15-66-172.us-east-2.compute.amazonaws.com:8080
const INDEXER_URL =
  "http://ec2-52-15-66-172.us-east-2.compute.amazonaws.com:8080";

// Example wallet addresses (from testnet order book examples)
const BUYER_WALLET = "1c6790935a3a1A6B914399Ba743BEC8C41Fe89Fb";
const LP1_WALLET = "c11Ff6d3cC60823EcDCAB1089F1A4336053851EF";

// Types

interface Market {
  query_id: number;
  query_hash: string;
  settle_time: number;
  settled: boolean;
  winning_outcome?: boolean;
  settled_at?: number;
  created_at: number;
  creator: string;
  max_spread: number;
  min_order_size: string;
  bridge: string;
}

interface Snapshot {
  block_height: number;
  timestamp: number;
  yes_bid_price?: number;
  yes_ask_price?: number;
  no_bid_price?: number;
  no_ask_price?: number;
  yes_volume?: number;
  no_volume?: number;
  midpoint_price?: number;
  spread?: number;
}

interface Settlement {
  query_id: number;
  winning_shares: number;
  losing_shares: number;
  payout: string;
  refunded_collateral: string;
  timestamp: number;
}

interface SettlementsData {
  wallet_address: string;
  settlements: Settlement[];
  total_won: number;
  total_lost: number;
}

interface Reward {
  query_id: number;
  total_reward_percent: number;
  reward_amount: string;
  blocks_sampled: number;
  distributed_at: number;
}

interface RewardsData {
  wallet_address: string;
  rewards: Reward[];
  total_rewards: string;
}

interface APIResponse<T> {
  ok: boolean;
  data: T;
}

function weiToUSDC(wei: string): string {
  return (Number(BigInt(wei)) / 1e18).toFixed(4);
}

async function fetchJSON<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  const json = (await resp.json()) as APIResponse<T>;
  return json.data;
}

async function queryMarkets(): Promise<Market[]> {
  console.log("=".repeat(60));
  console.log("Endpoint 1: List Historical Markets");
  console.log("=".repeat(60));

  const markets = await fetchJSON<Market[]>(
    `${INDEXER_URL}/v0/prediction-market/markets?limit=5`
  );

  console.log(`\nFound ${markets.length} markets:`);
  for (const m of markets) {
    const status = m.settled ? "SETTLED" : "ACTIVE";
    const outcome =
      m.winning_outcome !== undefined
        ? m.winning_outcome
          ? " (YES wins)"
          : " (NO wins)"
        : "";
    console.log(`  Market #${m.query_id}: ${status}${outcome}`);
    console.log(`    Hash: ${m.query_hash.slice(0, 16)}...`);
    console.log(`    Bridge: ${m.bridge}, Max Spread: ${m.max_spread}c`);
  }

  return markets;
}

async function querySnapshots(queryId: number): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log(`Endpoint 2: Order Book Snapshots (Market #${queryId})`);
  console.log("=".repeat(60));

  const snapshots = await fetchJSON<Snapshot[]>(
    `${INDEXER_URL}/v0/prediction-market/markets/${queryId}/snapshots?limit=5`
  );

  if (!snapshots.length) {
    console.log("  No snapshots found for this market.");
    return;
  }

  console.log(`\nFound ${snapshots.length} snapshots:`);
  for (const s of snapshots) {
    const mid = s.midpoint_price ?? "N/A";
    const spread = s.spread ?? "N/A";
    console.log(
      `  Block ${s.block_height}: midpoint=${mid}c, spread=${spread}c`
    );
  }
}

async function querySettlements(wallet: string): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log(`Endpoint 3: Participant Settlements (${wallet.slice(0, 10)}...)`);
  console.log("=".repeat(60));

  const data = await fetchJSON<SettlementsData>(
    `${INDEXER_URL}/v0/prediction-market/participants/${wallet}/settlements?limit=10`
  );

  console.log(`\n  Wallet: ${data.wallet_address}`);
  console.log(`  Total Won: ${data.total_won}, Total Lost: ${data.total_lost}`);

  for (const s of data.settlements) {
    console.log(`\n  Market #${s.query_id}:`);
    console.log(
      `    Winning shares: ${s.winning_shares}, Losing shares: ${s.losing_shares}`
    );
    console.log(
      `    Payout: ${weiToUSDC(s.payout)} USDC, Refund: ${weiToUSDC(s.refunded_collateral)} USDC`
    );
  }
}

async function queryRewards(wallet: string): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log(`Endpoint 4: LP Rewards (${wallet.slice(0, 10)}...)`);
  console.log("=".repeat(60));

  const data = await fetchJSON<RewardsData>(
    `${INDEXER_URL}/v0/prediction-market/participants/${wallet}/rewards?limit=10`
  );

  console.log(`\n  Wallet: ${data.wallet_address}`);
  console.log(`  Total Rewards: ${weiToUSDC(data.total_rewards)} USDC`);

  for (const r of data.rewards) {
    console.log(`\n  Market #${r.query_id}:`);
    console.log(
      `    Reward: ${weiToUSDC(r.reward_amount)} USDC (${r.total_reward_percent.toFixed(2)}%)`
    );
    console.log(`    Blocks Sampled: ${r.blocks_sampled}`);
  }
}

async function main() {
  console.log("TrufNetwork Prediction Market Indexer - TypeScript Example");
  console.log("Indexer URL:", INDEXER_URL);
  console.log();

  // 1. List markets
  const markets = await queryMarkets();

  // 2. Snapshots for the most recent market
  if (markets.length > 0) {
    await querySnapshots(markets[0].query_id);
  }

  // 3. Settlement results for buyer
  await querySettlements(BUYER_WALLET);

  // 4. LP rewards for LP1
  await queryRewards(LP1_WALLET);

  console.log("\n" + "=".repeat(60));
  console.log("Done! All 4 indexer endpoints demonstrated.");
  console.log("=".repeat(60));
}

main().catch(console.error);
