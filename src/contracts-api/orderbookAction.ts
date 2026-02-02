/**
 * Order Book Action API
 *
 * Provides methods for interacting with TRUF.NETWORK binary prediction markets.
 * Markets are automatically settled based on real-world data from trusted data providers.
 */

import { KwilSigner, NodeKwil, WebKwil, Types } from "@trufnetwork/kwil-js";
import {
  MarketInfo,
  MarketSummary,
  MarketValidation,
  OrderBookEntry,
  UserPosition,
  DepthLevel,
  BestPrices,
  UserCollateral,
  DistributionSummary,
  LPRewardDetail,
  RewardHistory,
  CreateMarketInput,
  PlaceOrderInput,
  PlaceSplitLimitOrderInput,
  CancelOrderInput,
  ChangeBidInput,
  ChangeAskInput,
  ListMarketsInput,
  CreatePriceThresholdMarketInput,
  CreateValueInRangeMarketInput,
  CreateValueEqualsMarketInput,
  BridgeIdentifier,
  RawMarketInfo,
  RawMarketSummary,
  RawOrderBookEntry,
  RawUserPosition,
  RawDepthLevel,
  RawBestPrices,
  RawUserCollateral,
  RawMarketValidation,
  RawDistributionSummary,
  RawLPRewardDetail,
  RawRewardHistory,
} from "../types/orderbook";
import {
  encodeActionArgs,
  encodeQueryComponents,
  encodeRangeActionArgs,
  encodeEqualsActionArgs,
  dbBytesToUint8Array,
  validatePrice,
  validateAmount,
  validateBridge,
  validateMaxSpread,
  validateSettleTime,
  settledFilterToBoolean,
} from "../util/orderbookHelpers";

/**
 * OrderbookAction provides methods for interacting with binary prediction markets.
 *
 * @example
 * ```typescript
 * const client = new NodeTNClient({...});
 * const orderbook = client.loadOrderbookAction();
 *
 * // Get market info
 * const market = await orderbook.getMarketInfo(queryId);
 *
 * // Place a buy order
 * await orderbook.placeBuyOrder({
 *   queryId: market.id,
 *   outcome: true,  // YES
 *   price: 55,      // 55 cents
 *   amount: 100,    // 100 shares
 * });
 * ```
 */
export class OrderbookAction {
  protected kwilClient: WebKwil | NodeKwil;
  protected kwilSigner: KwilSigner;

  constructor(kwilClient: WebKwil | NodeKwil, kwilSigner: KwilSigner) {
    this.kwilClient = kwilClient;
    this.kwilSigner = kwilSigner;
  }

  // ==========================================
  // Market Operations
  // ==========================================

  /**
   * Creates a new binary prediction market.
   *
   * @param input - Market creation parameters
   * @returns Transaction receipt with tx_hash
   *
   * @example
   * ```typescript
   * const args = OrderbookAction.encodeActionArgs(
   *   dataProvider, streamId, timestamp, threshold, frozenAt
   * );
   * const queryComponents = OrderbookAction.encodeQueryComponents(
   *   dataProvider, streamId, "price_above_threshold", args
   * );
   *
   * const result = await orderbook.createMarket({
   *   bridge: "hoodi_tt2",
   *   queryComponents,
   *   settleTime: Math.floor(Date.now() / 1000) + 3600,
   *   maxSpread: 10,
   *   minOrderSize: 1,
   * });
   * ```
   */
  async createMarket(
    input: CreateMarketInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    validateBridge(input.bridge);
    validateMaxSpread(input.maxSpread);
    validateSettleTime(input.settleTime);
    // Note: minOrderSize is a token amount (not share count), server validates it

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "create_market",
        inputs: [
          {
            $bridge: input.bridge,
            $query_components: input.queryComponents,
            $settle_time: input.settleTime,
            $max_spread: input.maxSpread,
            $min_order_size: input.minOrderSize,
          },
        ],
        description: "TN SDK - Create market",
      },
      this.kwilSigner
    );
  }

  /**
   * Gets detailed information about a market.
   *
   * @param queryId - Market identifier
   * @returns Full market information
   */
  async getMarketInfo(queryId: number): Promise<MarketInfo> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_market_info",
        inputs: { $query_id: queryId },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get market info: ${result.status}`);
    }

    const rows = result.data?.result as RawMarketInfo[];
    if (!rows || rows.length === 0) {
      throw new Error(`Market not found: ${queryId}`);
    }

    return this.parseMarketInfo(rows[0], queryId);
  }

  /**
   * Gets market information by query hash.
   *
   * @param queryHash - SHA256 hash of query components (32 bytes)
   * @returns Full market information
   */
  async getMarketByHash(queryHash: Uint8Array): Promise<MarketInfo> {
    if (queryHash.length !== 32) {
      throw new Error("Query hash must be exactly 32 bytes");
    }

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_market_by_hash",
        inputs: { $query_hash: queryHash },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get market by hash: ${result.status}`);
    }

    const rows = result.data?.result as RawMarketInfo[];
    if (!rows || rows.length === 0) {
      throw new Error("Market not found for given hash");
    }

    return this.parseMarketInfo(rows[0]);
  }

  /**
   * Lists markets with optional filtering.
   *
   * @param input - Filter and pagination options
   * @returns Array of market summaries
   */
  async listMarkets(input?: ListMarketsInput): Promise<MarketSummary[]> {
    const settledFilter = settledFilterToBoolean(input?.settledFilter);

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "list_markets",
        inputs: {
          $settled_filter: settledFilter,
          $limit_val: input?.limit ?? 100,
          $offset_val: input?.offset ?? 0,
        },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to list markets: ${result.status}`);
    }

    const rows = (result.data?.result as RawMarketSummary[]) || [];
    return rows.map((row) => this.parseMarketSummary(row));
  }

  /**
   * Checks if a market exists for the given query hash.
   *
   * @param queryHash - SHA256 hash of query components (32 bytes)
   * @returns true if market exists
   */
  async marketExists(queryHash: Uint8Array): Promise<boolean> {
    if (queryHash.length !== 32) {
      throw new Error("Query hash must be exactly 32 bytes");
    }

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "market_exists",
        inputs: { $query_hash: queryHash },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to check market exists: ${result.status}`);
    }

    const rows = result.data?.result as { exists: boolean }[];
    return rows && rows.length > 0 && rows[0].exists;
  }

  /**
   * Validates market collateral integrity.
   *
   * Checks that:
   * - YES and NO token counts match (binary pairs)
   * - Vault balance matches expected collateral
   *
   * @param queryId - Market identifier
   * @returns Validation result with detailed breakdown
   */
  async validateMarketCollateral(queryId: number): Promise<MarketValidation> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "validate_market_collateral",
        inputs: { $query_id: queryId },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to validate market collateral: ${result.status}`);
    }

    const rows = result.data?.result as RawMarketValidation[];
    if (!rows || rows.length === 0) {
      throw new Error(`Market not found: ${queryId}`);
    }

    const row = rows[0];
    return {
      validTokenBinaries: row.valid_token_binaries,
      validCollateral: row.valid_collateral,
      totalTrue: row.total_true,
      totalFalse: row.total_false,
      vaultBalance: row.vault_balance,
      expectedCollateral: row.expected_collateral,
      openBuysValue: row.open_buys_value,
    };
  }

  // ==========================================
  // Order Placement Operations
  // ==========================================

  /**
   * Places a buy order for shares.
   *
   * Locks collateral: amount × price × 10^16 wei
   *
   * @param input - Order parameters
   * @returns Transaction receipt
   */
  async placeBuyOrder(
    input: PlaceOrderInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    validatePrice(input.price, "placeBuyOrder");
    validateAmount(input.amount, "placeBuyOrder");

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "place_buy_order",
        inputs: [
          {
            $query_id: input.queryId,
            $outcome: input.outcome,
            $price: input.price,
            $amount: input.amount,
          },
        ],
        description: "TN SDK - Place buy order",
      },
      this.kwilSigner
    );
  }

  /**
   * Places a sell order for owned shares.
   *
   * @param input - Order parameters
   * @returns Transaction receipt
   */
  async placeSellOrder(
    input: PlaceOrderInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    validatePrice(input.price, "placeSellOrder");
    validateAmount(input.amount, "placeSellOrder");

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "place_sell_order",
        inputs: [
          {
            $query_id: input.queryId,
            $outcome: input.outcome,
            $price: input.price,
            $amount: input.amount,
          },
        ],
        description: "TN SDK - Place sell order",
      },
      this.kwilSigner
    );
  }

  /**
   * Places a split limit order for market making.
   *
   * Atomically:
   * 1. Locks collateral (amount × $1.00)
   * 2. Mints a YES/NO share pair
   * 3. Keeps YES shares as holdings
   * 4. Places NO shares as a sell order at (100 - truePrice) cents
   *
   * @param input - Order parameters
   * @returns Transaction receipt
   *
   * @example
   * ```typescript
   * // Create 100 pairs at YES=55¢, NO=45¢
   * await orderbook.placeSplitLimitOrder({
   *   queryId: market.id,
   *   truePrice: 55,
   *   amount: 100,
   * });
   * // Result: 100 YES holdings + 100 NO sell orders at 45¢
   * ```
   */
  async placeSplitLimitOrder(
    input: PlaceSplitLimitOrderInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    validatePrice(input.truePrice, "placeSplitLimitOrder");
    validateAmount(input.amount, "placeSplitLimitOrder");

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "place_split_limit_order",
        inputs: [
          {
            $query_id: input.queryId,
            $true_price: input.truePrice,
            $amount: input.amount,
          },
        ],
        description: "TN SDK - Place split limit order",
      },
      this.kwilSigner
    );
  }

  /**
   * Cancels an open order.
   *
   * Cannot cancel holdings (price = 0).
   *
   * @param input - Order to cancel
   * @returns Transaction receipt
   */
  async cancelOrder(
    input: CancelOrderInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    if (input.price === 0) {
      throw new Error("Cannot cancel holdings (price = 0)");
    }

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "cancel_order",
        inputs: [
          {
            $query_id: input.queryId,
            $outcome: input.outcome,
            $price: input.price,
          },
        ],
        description: "TN SDK - Cancel order",
      },
      this.kwilSigner
    );
  }

  /**
   * Modifies a buy order atomically.
   *
   * Preserves FIFO queue position via timestamp inheritance.
   *
   * @param input - Bid modification parameters
   * @returns Transaction receipt
   */
  async changeBid(
    input: ChangeBidInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    if (input.oldPrice >= 0 || input.newPrice >= 0) {
      throw new Error("changeBid: Prices must be negative (buy orders)");
    }
    validateAmount(input.newAmount, "changeBid");

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "change_bid",
        inputs: [
          {
            $query_id: input.queryId,
            $outcome: input.outcome,
            $old_price: input.oldPrice,
            $new_price: input.newPrice,
            $new_amount: input.newAmount,
          },
        ],
        description: "TN SDK - Change bid",
      },
      this.kwilSigner
    );
  }

  /**
   * Modifies a sell order atomically.
   *
   * Preserves FIFO queue position via timestamp inheritance.
   *
   * @param input - Ask modification parameters
   * @returns Transaction receipt
   */
  async changeAsk(
    input: ChangeAskInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    if (input.oldPrice <= 0 || input.newPrice <= 0) {
      throw new Error(
        "changeAsk: Prices must be strictly positive (sell orders, price 0 is holdings)"
      );
    }
    validateAmount(input.newAmount, "changeAsk");

    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "change_ask",
        inputs: [
          {
            $query_id: input.queryId,
            $outcome: input.outcome,
            $old_price: input.oldPrice,
            $new_price: input.newPrice,
            $new_amount: input.newAmount,
          },
        ],
        description: "TN SDK - Change ask",
      },
      this.kwilSigner
    );
  }

  // ==========================================
  // Query Operations (Read-only)
  // ==========================================

  /**
   * Gets the order book for a market outcome.
   *
   * Returns all buy and sell orders (excludes holdings).
   *
   * @param queryId - Market identifier
   * @param outcome - true=YES, false=NO
   * @returns Array of order book entries
   */
  async getOrderBook(
    queryId: number,
    outcome: boolean
  ): Promise<OrderBookEntry[]> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_order_book",
        inputs: {
          $query_id: queryId,
          $outcome: outcome,
        },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get order book: ${result.status}`);
    }

    const rows = (result.data?.result as RawOrderBookEntry[]) || [];
    return rows.map((row) => ({
      walletAddress: dbBytesToUint8Array(row.wallet_address),
      price: row.price,
      amount: row.amount,
      lastUpdated: row.last_updated,
    }));
  }

  /**
   * Gets the caller's positions across all markets.
   *
   * @returns Array of user positions (holdings and orders)
   */
  async getUserPositions(): Promise<UserPosition[]> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_user_positions",
        inputs: {},
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get user positions: ${result.status}`);
    }

    const rows = (result.data?.result as RawUserPosition[]) || [];
    return rows.map((row) => ({
      queryId: row.query_id,
      outcome: row.outcome,
      price: row.price,
      amount: row.amount,
      lastUpdated: row.last_updated,
    }));
  }

  /**
   * Gets aggregated market depth for an outcome.
   *
   * @param queryId - Market identifier
   * @param outcome - true=YES, false=NO
   * @returns Array of depth levels (price + total volume)
   */
  async getMarketDepth(
    queryId: number,
    outcome: boolean
  ): Promise<DepthLevel[]> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_market_depth",
        inputs: {
          $query_id: queryId,
          $outcome: outcome,
        },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get market depth: ${result.status}`);
    }

    const rows = (result.data?.result as RawDepthLevel[]) || [];
    return rows.map((row) => ({
      price: Number(row.price),
      buyVolume: Number(row.buy_volume),
      sellVolume: Number(row.sell_volume),
    }));
  }

  /**
   * Gets the best bid and ask prices for an outcome.
   *
   * @param queryId - Market identifier
   * @param outcome - true=YES, false=NO
   * @returns Best prices and spread
   */
  async getBestPrices(queryId: number, outcome: boolean): Promise<BestPrices> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_best_prices",
        inputs: {
          $query_id: queryId,
          $outcome: outcome,
        },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get best prices: ${result.status}`);
    }

    const rows = result.data?.result as RawBestPrices[];
    if (!rows || rows.length === 0) {
      return { bestBid: null, bestAsk: null, spread: null };
    }

    const row = rows[0];
    return {
      bestBid: row.best_bid,
      bestAsk: row.best_ask,
      spread: row.spread,
    };
  }

  /**
   * Gets the caller's total locked collateral.
   *
   * @returns Collateral breakdown
   */
  async getUserCollateral(): Promise<UserCollateral> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_user_collateral",
        inputs: {},
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get user collateral: ${result.status}`);
    }

    const rows = result.data?.result as RawUserCollateral[];
    if (!rows || rows.length === 0) {
      return {
        totalLocked: "0",
        buyOrdersLocked: "0",
        sharesValue: "0",
      };
    }

    const row = rows[0];
    return {
      totalLocked: row.total_locked,
      buyOrdersLocked: row.buy_orders_locked,
      sharesValue: row.shares_value,
    };
  }

  // ==========================================
  // Settlement & Rewards
  // ==========================================

  /**
   * Settles a market using attestation results.
   *
   * Can only be called after settle_time has passed.
   * Automatically distributes payouts and LP rewards.
   *
   * @param queryId - Market identifier
   * @returns Transaction receipt
   */
  async settleMarket(
    queryId: number
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "settle_market",
        inputs: [{ $query_id: queryId }],
        description: "TN SDK - Settle market",
      },
      this.kwilSigner
    );
  }

  /**
   * Samples LP rewards for a specific block.
   *
   * Should be called periodically to track LP eligibility.
   *
   * @param queryId - Market identifier
   * @param block - Block height to sample
   * @returns Transaction receipt
   */
  async sampleLPRewards(
    queryId: number,
    block: number
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.kwilClient.execute(
      {
        namespace: "main",
        name: "sample_lp_rewards",
        inputs: [
          {
            $query_id: queryId,
            $block: block,
          },
        ],
        description: "TN SDK - Sample LP rewards",
      },
      this.kwilSigner
    );
  }

  /**
   * Gets the fee distribution summary for a market.
   *
   * @param queryId - Market identifier
   * @returns Distribution summary
   */
  async getDistributionSummary(queryId: number): Promise<DistributionSummary> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_distribution_summary",
        inputs: { $query_id: queryId },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get distribution summary: ${result.status}`);
    }

    const rows = result.data?.result as RawDistributionSummary[];
    if (!rows || rows.length === 0) {
      throw new Error(`No distribution found for market: ${queryId}`);
    }

    const row = rows[0];
    return {
      distributionId: row.distribution_id,
      queryId: row.query_id,
      totalFees: row.total_fees,
      distributedAt: row.distributed_at,
    };
  }

  /**
   * Gets detailed reward breakdown for a distribution.
   *
   * @param distributionId - Distribution identifier
   * @returns Array of per-LP reward details
   */
  async getDistributionDetails(
    distributionId: number
  ): Promise<LPRewardDetail[]> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_distribution_details",
        inputs: { $distribution_id: distributionId },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get distribution details: ${result.status}`);
    }

    const rows = (result.data?.result as RawLPRewardDetail[]) || [];
    return rows.map((row) => ({
      walletAddress: dbBytesToUint8Array(row.wallet_address),
      rewardAmount: row.reward_amount,
      sharePercentage: row.share_percentage,
    }));
  }

  /**
   * Gets reward history for a participant.
   *
   * @param walletHex - Wallet address (0x-prefixed hex)
   * @returns Array of reward history entries
   */
  async getParticipantRewardHistory(walletHex: string): Promise<RewardHistory[]> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_participant_reward_history",
        inputs: { $wallet_hex: walletHex },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(
        `Failed to get participant reward history: ${result.status}`
      );
    }

    const rows = (result.data?.result as RawRewardHistory[]) || [];
    return rows.map((row) => ({
      distributionId: row.distribution_id,
      queryId: row.query_id,
      rewardAmount: row.reward_amount,
      totalRewardPercent: row.total_reward_percent,
      distributedAt: row.distributed_at,
    }));
  }

  // ==========================================
  // Binary Market Convenience Creators
  // ==========================================

  /**
   * Creates a "price above threshold" market.
   *
   * YES wins if price > threshold at settlement time.
   *
   * @param input - Market parameters
   * @returns Transaction receipt
   */
  async createPriceAboveThresholdMarket(
    input: CreatePriceThresholdMarketInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    const args = encodeActionArgs(
      input.dataProvider,
      input.streamId,
      input.timestamp,
      input.threshold,
      input.frozenAt
    );

    const queryComponents = encodeQueryComponents(
      input.dataProvider,
      input.streamId,
      "price_above_threshold",
      args
    );

    return this.createMarket({
      bridge: input.bridge,
      queryComponents,
      settleTime: input.settleTime,
      maxSpread: input.maxSpread,
      minOrderSize: input.minOrderSize,
    });
  }

  /**
   * Creates a "price below threshold" market.
   *
   * YES wins if price < threshold at settlement time.
   *
   * @param input - Market parameters
   * @returns Transaction receipt
   */
  async createPriceBelowThresholdMarket(
    input: CreatePriceThresholdMarketInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    const args = encodeActionArgs(
      input.dataProvider,
      input.streamId,
      input.timestamp,
      input.threshold,
      input.frozenAt
    );

    const queryComponents = encodeQueryComponents(
      input.dataProvider,
      input.streamId,
      "price_below_threshold",
      args
    );

    return this.createMarket({
      bridge: input.bridge,
      queryComponents,
      settleTime: input.settleTime,
      maxSpread: input.maxSpread,
      minOrderSize: input.minOrderSize,
    });
  }

  /**
   * Creates a "value in range" market.
   *
   * YES wins if minValue <= value <= maxValue at settlement time.
   *
   * @param input - Market parameters
   * @returns Transaction receipt
   */
  async createValueInRangeMarket(
    input: CreateValueInRangeMarketInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    const args = encodeRangeActionArgs(
      input.dataProvider,
      input.streamId,
      input.timestamp,
      input.minValue,
      input.maxValue,
      input.frozenAt
    );

    const queryComponents = encodeQueryComponents(
      input.dataProvider,
      input.streamId,
      "value_in_range",
      args
    );

    return this.createMarket({
      bridge: input.bridge,
      queryComponents,
      settleTime: input.settleTime,
      maxSpread: input.maxSpread,
      minOrderSize: input.minOrderSize,
    });
  }

  /**
   * Creates a "value equals" market.
   *
   * YES wins if |value - targetValue| <= tolerance at settlement time.
   *
   * @param input - Market parameters
   * @returns Transaction receipt
   */
  async createValueEqualsMarket(
    input: CreateValueEqualsMarketInput
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    const args = encodeEqualsActionArgs(
      input.dataProvider,
      input.streamId,
      input.timestamp,
      input.targetValue,
      input.tolerance,
      input.frozenAt
    );

    const queryComponents = encodeQueryComponents(
      input.dataProvider,
      input.streamId,
      "value_equals",
      args
    );

    return this.createMarket({
      bridge: input.bridge,
      queryComponents,
      settleTime: input.settleTime,
      maxSpread: input.maxSpread,
      minOrderSize: input.minOrderSize,
    });
  }

  // ==========================================
  // Static Helper Methods
  // ==========================================

  /**
   * Encodes action arguments for query components.
   * @see encodeActionArgs
   */
  static encodeActionArgs = encodeActionArgs;

  /**
   * Encodes query components for market creation.
   * @see encodeQueryComponents
   */
  static encodeQueryComponents = encodeQueryComponents;

  /**
   * Encodes action arguments for range markets.
   * @see encodeRangeActionArgs
   */
  static encodeRangeActionArgs = encodeRangeActionArgs;

  /**
   * Encodes action arguments for equals markets.
   * @see encodeEqualsActionArgs
   */
  static encodeEqualsActionArgs = encodeEqualsActionArgs;

  // ==========================================
  // Private Helper Methods
  // ==========================================

  private parseMarketInfo(row: RawMarketInfo, queryId?: number): MarketInfo {
    return {
      // get_market_info doesn't return id, so use the passed queryId if available
      id: queryId ?? Number(row.id),
      hash: dbBytesToUint8Array(row.hash),
      queryComponents: dbBytesToUint8Array(row.query_components),
      bridge: row.bridge as BridgeIdentifier,
      settleTime: Number(row.settle_time),
      settled: row.settled,
      winningOutcome: row.winning_outcome,
      settledAt: row.settled_at !== null ? Number(row.settled_at) : null,
      maxSpread: Number(row.max_spread),
      minOrderSize: String(row.min_order_size),
      createdAt: Number(row.created_at),
      creator: dbBytesToUint8Array(row.creator),
    };
  }

  private parseMarketSummary(row: RawMarketSummary): MarketSummary {
    return {
      id: Number(row.id),
      hash: dbBytesToUint8Array(row.hash),
      settleTime: Number(row.settle_time),
      settled: row.settled,
      winningOutcome: row.winning_outcome,
      maxSpread: Number(row.max_spread),
      minOrderSize: String(row.min_order_size),
      createdAt: Number(row.created_at),
    };
  }
}
