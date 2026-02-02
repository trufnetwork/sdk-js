/**
 * Order Book Types for TRUF.NETWORK Prediction Markets
 *
 * Binary prediction markets where outcomes are YES (true) or NO (false).
 * Prices are in cents (1-99), representing probability.
 */

// ============================================
// Bridge Types
// ============================================

/** Valid bridge identifiers for collateral */
export type BridgeIdentifier =
  | "hoodi_tt2"
  | "sepolia_bridge"
  | "ethereum_bridge";

// ============================================
// Market Types
// ============================================

/** Full market information */
export interface MarketInfo {
  /** Unique market identifier */
  id: number;
  /** SHA256 hash of query components (32 bytes) */
  hash: Uint8Array;
  /** ABI-encoded query tuple */
  queryComponents: Uint8Array;
  /** Bridge used for collateral */
  bridge: BridgeIdentifier;
  /** Unix timestamp when market settles */
  settleTime: number;
  /** Whether market has been settled */
  settled: boolean;
  /** Winning outcome (null if not settled) */
  winningOutcome: boolean | null;
  /** Unix timestamp when settled (null if not settled) */
  settledAt: number | null;
  /** Maximum bid-ask spread allowed (1-50 cents) */
  maxSpread: number;
  /** Minimum order size (string for large values) */
  minOrderSize: string;
  /** Unix timestamp when market was created */
  createdAt: number;
  /** Creator's wallet address (20 bytes) */
  creator: Uint8Array;
}

/** Lighter market summary for listings */
export interface MarketSummary {
  /** Unique market identifier */
  id: number;
  /** SHA256 hash of query components (32 bytes) */
  hash: Uint8Array;
  /** Unix timestamp when market settles */
  settleTime: number;
  /** Whether market has been settled */
  settled: boolean;
  /** Winning outcome (null if not settled) */
  winningOutcome: boolean | null;
  /** Maximum bid-ask spread allowed (1-50 cents) */
  maxSpread: number;
  /** Minimum order size (string for large values) */
  minOrderSize: string;
  /** Unix timestamp when market was created */
  createdAt: number;
}

/** Market collateral validation result */
export interface MarketValidation {
  /** Whether YES/NO token counts match */
  validTokenBinaries: boolean;
  /** Whether vault balance matches expected collateral */
  validCollateral: boolean;
  /** Total YES shares (NUMERIC as string) */
  totalTrue: string;
  /** Total NO shares (NUMERIC as string) */
  totalFalse: string;
  /** Vault balance (NUMERIC as string) */
  vaultBalance: string;
  /** Expected collateral (NUMERIC as string) */
  expectedCollateral: string;
  /** Value locked in open buy orders (NUMERIC as string) */
  openBuysValue: string;
}

// ============================================
// Order Types
// ============================================

/** Single order book entry */
export interface OrderBookEntry {
  /** Wallet address of order owner (20 bytes) */
  walletAddress: Uint8Array;
  /**
   * Price in cents:
   * - Negative (-99 to -1): Buy order at |price| cents
   * - Zero (0): Holding (shares owned, not listed)
   * - Positive (1 to 99): Sell order at price cents
   */
  price: number;
  /** Number of shares */
  amount: number;
  /** Unix timestamp of last update (used for FIFO ordering) */
  lastUpdated: number;
}

/** User's position in a market */
export interface UserPosition {
  /** Market identifier */
  queryId: number;
  /** Outcome: true=YES, false=NO */
  outcome: boolean;
  /**
   * Price in cents:
   * - Negative: Buy order
   * - Zero: Holding
   * - Positive: Sell order
   */
  price: number;
  /** Number of shares */
  amount: number;
  /** Unix timestamp of last update */
  lastUpdated: number;
}

/** Aggregated depth at a price level */
export interface DepthLevel {
  /** Price level in cents */
  price: number;
  /** Total shares in buy orders at this price */
  buyVolume: number;
  /** Total shares in sell orders at this price */
  sellVolume: number;
}

/** Best bid/ask prices for a market outcome */
export interface BestPrices {
  /** Best bid price (null if no bids) */
  bestBid: number | null;
  /** Best ask price (null if no asks) */
  bestAsk: number | null;
  /** Spread between best ask and bid (null if either missing) */
  spread: number | null;
}

/** User's locked collateral across all markets */
export interface UserCollateral {
  /** Total locked collateral in wei (NUMERIC(78,0) as string) */
  totalLocked: string;
  /** Collateral locked in buy orders (NUMERIC as string) */
  buyOrdersLocked: string;
  /** Value of owned shares (NUMERIC as string) */
  sharesValue: string;
}

// ============================================
// Settlement & Rewards Types
// ============================================

/** Fee distribution summary for a market */
export interface DistributionSummary {
  /** Unique distribution identifier */
  distributionId: number;
  /** Market identifier */
  queryId: number;
  /** Total fees distributed (NUMERIC as string) */
  totalFees: string;
  /** Unix timestamp when distributed */
  distributedAt: number;
}

/** Per-LP reward detail */
export interface LPRewardDetail {
  /** LP's wallet address (20 bytes) */
  walletAddress: Uint8Array;
  /** Reward amount (NUMERIC as string) */
  rewardAmount: string;
  /** Share percentage of total rewards (0-100) */
  sharePercentage: number;
}

/** Reward history for a participant */
export interface RewardHistory {
  /** Distribution identifier */
  distributionId: number;
  /** Market identifier */
  queryId: number;
  /** Reward amount (NUMERIC as string) */
  rewardAmount: string;
  /** Share percentage of total rewards */
  totalRewardPercent: number;
  /** Unix timestamp when distributed */
  distributedAt: number;
}

// ============================================
// Input Types for Write Operations
// ============================================

/** Input for creating a new market */
export interface CreateMarketInput {
  /** Bridge identifier for collateral */
  bridge: BridgeIdentifier;
  /** ABI-encoded query components */
  queryComponents: Uint8Array;
  /** Unix timestamp for market settlement */
  settleTime: number;
  /** Maximum bid-ask spread (1-50 cents) */
  maxSpread: number;
  /** Minimum order size (use string for large values to avoid JS safe integer limits) */
  minOrderSize: number | string;
}

/** Input for placing buy or sell orders */
export interface PlaceOrderInput {
  /** Market identifier */
  queryId: number;
  /** Outcome: true=YES, false=NO */
  outcome: boolean;
  /** Price in cents (1-99) */
  price: number;
  /** Number of shares */
  amount: number;
}

/** Input for split limit orders (market making) */
export interface PlaceSplitLimitOrderInput {
  /** Market identifier */
  queryId: number;
  /** YES price in cents (1-99). NO price will be 100 - truePrice */
  truePrice: number;
  /** Number of share pairs to create */
  amount: number;
}

/** Input for canceling an order */
export interface CancelOrderInput {
  /** Market identifier */
  queryId: number;
  /** Outcome: true=YES, false=NO */
  outcome: boolean;
  /** Price of order to cancel (cannot be 0) */
  price: number;
}

/** Input for modifying a buy order */
export interface ChangeBidInput {
  /** Market identifier */
  queryId: number;
  /** Outcome: true=YES, false=NO */
  outcome: boolean;
  /** Current price (must be negative) */
  oldPrice: number;
  /** New price (must be negative) */
  newPrice: number;
  /** New amount */
  newAmount: number;
}

/** Input for modifying a sell order */
export interface ChangeAskInput {
  /** Market identifier */
  queryId: number;
  /** Outcome: true=YES, false=NO */
  outcome: boolean;
  /** Current price (must be non-negative) */
  oldPrice: number;
  /** New price (must be non-negative) */
  newPrice: number;
  /** New amount */
  newAmount: number;
}

/** Input for listing markets */
export interface ListMarketsInput {
  /**
   * Filter by settlement status:
   * - null/undefined: All markets
   * - true: Unsettled markets only
   * - false: Settled markets only
   */
  settledFilter?: boolean | null;
  /** Maximum number of markets to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================
// Binary Market Helper Input Types
// ============================================

/** Base input for binary market creation helpers */
export interface BaseBinaryMarketInput {
  /** Data provider's Ethereum address */
  dataProvider: string;
  /** Stream ID (32 characters) */
  streamId: string;
  /** Unix timestamp for price/value check */
  timestamp: number;
  /** Block height for data snapshot */
  frozenAt: number;
  /** Bridge identifier for collateral */
  bridge: BridgeIdentifier;
  /** Unix timestamp for market settlement */
  settleTime: number;
  /** Maximum bid-ask spread (1-50 cents) */
  maxSpread: number;
  /** Minimum order size (use string for large values to avoid JS safe integer limits) */
  minOrderSize: number | string;
}

/** Input for price above/below threshold markets */
export interface CreatePriceThresholdMarketInput extends BaseBinaryMarketInput {
  /** Price threshold (as decimal string, e.g., "50000.00") */
  threshold: string;
}

/** Input for value in range markets */
export interface CreateValueInRangeMarketInput extends BaseBinaryMarketInput {
  /** Minimum value of range (as decimal string) */
  minValue: string;
  /** Maximum value of range (as decimal string) */
  maxValue: string;
}

/** Input for value equals markets */
export interface CreateValueEqualsMarketInput extends BaseBinaryMarketInput {
  /** Target value (as decimal string) */
  targetValue: string;
  /** Acceptable tolerance (as decimal string) */
  tolerance: string;
}

// ============================================
// Raw Database Response Types (Internal)
// ============================================

/** @internal Raw market info from database */
export interface RawMarketInfo {
  id: number;
  hash: string;
  query_components: string;
  bridge: string;
  settle_time: number;
  settled: boolean;
  winning_outcome: boolean | null;
  settled_at: number | null;
  max_spread: number;
  min_order_size: string | number;
  created_at: number;
  creator: string;
}

/** @internal Raw market summary from database */
export interface RawMarketSummary {
  id: number;
  hash: string;
  settle_time: number;
  settled: boolean;
  winning_outcome: boolean | null;
  max_spread: number;
  min_order_size: string | number;
  created_at: number;
}

/** @internal Raw order book entry from database */
export interface RawOrderBookEntry {
  wallet_address: string;
  price: number;
  amount: number;
  last_updated: number;
}

/** @internal Raw user position from database */
export interface RawUserPosition {
  query_id: number;
  outcome: boolean;
  price: number;
  amount: number;
  last_updated: number;
}

/** @internal Raw depth level from database */
export interface RawDepthLevel {
  price: number | string;
  buy_volume: number | string;
  sell_volume: number | string;
}

/** @internal Raw best prices from database */
export interface RawBestPrices {
  best_bid: number | null;
  best_ask: number | null;
  spread: number | null;
}

/** @internal Raw user collateral from database */
export interface RawUserCollateral {
  total_locked: string;
  buy_orders_locked: string;
  shares_value: string;
}

/** @internal Raw market validation from database */
export interface RawMarketValidation {
  valid_token_binaries: boolean;
  valid_collateral: boolean;
  total_true: string;
  total_false: string;
  vault_balance: string;
  expected_collateral: string;
  open_buys_value: string;
}

/** @internal Raw distribution summary from database */
export interface RawDistributionSummary {
  distribution_id: number;
  query_id: number;
  total_fees: string;
  distributed_at: number;
}

/** @internal Raw LP reward detail from database */
export interface RawLPRewardDetail {
  wallet_address: string;
  reward_amount: string;
  share_percentage: number;
}

/** @internal Raw reward history from database */
export interface RawRewardHistory {
  distribution_id: number;
  query_id: number;
  reward_amount: string;
  total_reward_percent: number;
  distributed_at: number;
}
