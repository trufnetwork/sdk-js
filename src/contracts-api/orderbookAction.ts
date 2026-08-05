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
  WalletPosition,
  DepthLevel,
  BestPrices,
  ConsolidatedOrderBook,
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
  RawWalletPosition,
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
  decodeMarketData,
  validatePrice,
  validateAmount,
  validateBridge,
  validateMaxSpread,
  validateSettleTime,
  validateWalletHex,
  settledFilterToBoolean,
} from "../util/orderbookHelpers";
import {
  bucketBoundsFromMarketData,
  requireQueryTime,
} from "../util/marketBuckets";
import { forecastFromDepth } from "../util/forecast";
import type {
  BookLevel,
  BucketDepth,
  MarketForecast,
} from "../util/forecast";
import {
  consolidateSide,
  depthAsks,
  depthBids,
} from "../util/consolidatedBook";

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
   * Gets one outcome's order book with the opposite outcome's quotes folded in.
   *
   * `getMarketDepth` returns a single outcome's ladder, but a binary market's
   * two books are two views of one position and the matching engine fills
   * across them. A resting SELL NO at 93c is a standing BID for YES at 7c: a
   * trader hits it by SELLING YES, both sides sell, and the chain burns the
   * share pair. Reading only the YES book makes that quote invisible and the
   * market look thinner than it is.
   *
   * So, in the YES frame:
   *
   *     consolidated bids = YES bids + (100 - p for every NO ask)
   *     consolidated asks = YES asks + (100 - p for every NO bid)
   *
   * The sides swap: a NO ask arrives as a YES bid. Hitting it means both
   * parties sell and the share pair burns; hitting a consolidated ask means
   * both buy and a pair mints.
   *
   * **The result is not a sweepable ladder.** Mint and burn matches fire only
   * when the two prices sum to exactly 100, while a direct same-outcome match
   * crosses. So one order fills every native level past its limit plus exactly
   * ONE inverse level, and walking these levels the way you would walk a
   * regular ladder quotes fills the chain will not produce. Each level keeps
   * `native` and `inverse` separately so a caller can price that correctly.
   *
   * Costs two `get_market_depth` reads. They are issued together, but the node
   * exposes no way to pin both to one block, so on a moving book the two sides
   * can come from adjacent heights and `isCrossed` is best-effort. Do not treat
   * a crossed result as a settled arbitrage without re-reading.
   *
   * @param queryId - Market identifier
   * @param outcome - The outcome to frame prices in: true=YES (default),
   *   false=NO. The NO-framed book is the YES-framed book reflected, so one
   *   call answers either tab.
   * @returns Both consolidated ladders, best first, and whether they cross
   *
   * @example
   * ```typescript
   * const book = await orderbook.getConsolidatedOrderBook(419);
   * for (const level of book.asks) {
   *   console.log(level.price, level.total, level.native, level.inverse);
   * }
   * ```
   */
  async getConsolidatedOrderBook(
    queryId: number,
    outcome: boolean = true
  ): Promise<ConsolidatedOrderBook> {
    const [native, opposite] = await Promise.all([
      this.getMarketDepth(queryId, outcome),
      this.getMarketDepth(queryId, !outcome),
    ]);

    const bids = consolidateSide(
      depthBids(native),
      depthAsks(opposite),
      "bid"
    );
    const asks = consolidateSide(
      depthAsks(native),
      depthBids(opposite),
      "ask"
    );

    return {
      queryId,
      outcome,
      bids,
      asks,
      isCrossed:
        bids.length > 0 && asks.length > 0 && bids[0].price >= asks[0].price,
    };
  }

  /**
   * Collapses a market's bucket books into the single value they imply.
   *
   * A prediction market prices ranges: each bucket is its own query_id with its
   * own binary book. This reads every bucket's FULL YES and NO ladders and its
   * bounds, then returns the one number the books collectively imply plus the
   * band around it. See the `forecast` module for the algorithm.
   *
   * The YES and NO books are both fetched because the forecast consolidates
   * them: on this venue a resting BUY NO at p is hittable by a BUY YES at 100-p
   * (mint match), so NO liquidity is executable YES liquidity and ignoring it
   * would discard real quotes. That costs two order-book reads per bucket.
   *
   * @param queryIds - The bucket query_ids of ONE market. Order does not matter,
   *   they are sorted by lower bound here. The buckets are expected to tile the
   *   whole line, with the bottom one open below and the top one open above; a
   *   layout that does not is still estimated, with the problem reported in
   *   `warnings`.
   * @returns The forecast, or `null` when no bucket has a usable quote.
   * @throws If fewer than two query_ids are given, or a market is missing the
   *   query_components needed to derive its bounds.
   *
   * @example
   * ```typescript
   * const forecast = await orderbook.getMarketForecast([419, 420, 421, 422, 423]);
   * if (forecast) {
   *   console.log(forecast.value, forecast.p10, forecast.p90, forecast.warnings);
   * }
   * ```
   */
  async getMarketForecast(queryIds: number[]): Promise<MarketForecast | null> {
    if (queryIds.length < 2) {
      throw new Error(
        `a market forecast needs at least 2 bucket query_ids, got ${queryIds.length}`
      );
    }
    if (new Set(queryIds).size !== queryIds.length) {
      const repeated = [
        ...new Set(queryIds.filter((id, i) => queryIds.indexOf(id) !== i)),
      ].sort((a, b) => a - b);
      throw new Error(
        `duplicate bucket query_ids ${repeated.join(", ")}; a repeated bucket ` +
          `would have its probability counted twice`
      );
    }

    const books: BucketDepth[] = [];
    let identity: string | null = null;
    for (const queryId of queryIds) {
      // The three reads are independent, so overlap them. Buckets stay
      // sequential: fanning every bucket out at once would put 3N simultaneous
      // calls on the gateway for no benefit the caller asked for.
      const [info, yes, no] = await Promise.all([
        this.getMarketInfo(queryId),
        this.orderBookLadders(queryId, true),
        this.orderBookLadders(queryId, false),
      ]);

      if (!info.queryComponents || info.queryComponents.length === 0) {
        throw new Error(
          `market ${queryId} has no query_components, so its bucket bounds ` +
            `cannot be derived`
        );
      }
      const marketData = decodeMarketData(info.queryComponents);

      // Buckets of one market differ only in their strike: they share a data
      // provider, a stream, a settlement time and the query time they observe.
      // Forecasting across two events would normalise unrelated probabilities
      // into one distribution and return a confident number about nothing, so
      // it is rejected rather than warned about.
      //
      // The query's own timestamp and frozenAt are included, not just the
      // settlement time: two markets can settle at the same moment while
      // observing the stream at different points.
      //
      // The bridge is in here too, and it is the one field that lives outside
      // the query components: it is a createMarket argument, so two markets can
      // ask an identical question while collateralising it differently. Those
      // are separate markets with separate books.
      requireQueryTime(queryId, marketData);
      const thisIdentity =
        `${marketData.dataProvider}|${marketData.streamId}|${info.bridge}` +
        `|${info.settleTime}|${marketData.timestamp}|${marketData.frozenAt}`;
      if (identity === null) {
        identity = thisIdentity;
      } else if (thisIdentity !== identity) {
        throw new Error(
          `market ${queryId} belongs to a different event than the first ` +
            `bucket: (dataProvider, streamId, bridge, settleTime, timestamp, ` +
            `frozenAt) ` +
            `is ${thisIdentity} against ${identity}. One forecast covers the ` +
            `buckets of ONE market.`
        );
      }

      const { lower, upper } = bucketBoundsFromMarketData(marketData);
      books.push({
        lower,
        upper,
        yesBids: yes.bids,
        yesAsks: yes.asks,
        noBids: no.bids,
        noAsks: no.asks,
        queryId,
      });
    }

    // Open below sorts first, which is where that bucket belongs.
    books.sort((a, b) => {
      if (a.lower === null) return b.lower === null ? 0 : -1;
      if (b.lower === null) return 1;
      return a.lower - b.lower;
    });

    const layout: string[] = [];
    if (books[0].lower !== null) {
      layout.push("lowest bucket is not open below");
    }
    if (books[books.length - 1].upper !== null) {
      layout.push("highest bucket is not open above");
    }
    let breaks = 0;
    for (let i = 0; i + 1 < books.length; i++) {
      if (books[i].upper !== books[i + 1].lower) breaks += 1;
    }
    if (breaks) {
      layout.push(`${breaks} gap(s) or overlap(s) between bucket bounds`);
    }

    const forecast = forecastFromDepth(books);
    if (forecast === null) return null;
    forecast.warnings.unshift(...layout);
    return forecast;
  }

  /**
   * One outcome's resting book, split into bid and ask ladders.
   *
   * `getOrderBook` marks bids with a NEGATIVE price and asks with a positive
   * one; price 0 means shares held with no resting order, which is not part of
   * the book. Prices come back to the forecast as the positive 1-99 cent
   * convention it expects.
   *
   * Both fields are coerced with Number() rather than trusted: the node returns
   * `amount` as a NUMERIC, which arrives over the wire as a STRING even though
   * OrderBookEntry types it as a number. Left uncoerced it survives
   * multiplication (JS coerces) but turns `+=` into string concatenation, so the
   * bug would hide until some future reader of the ladder happened to sum sizes.
   *
   * @internal
   */
  private async orderBookLadders(
    queryId: number,
    outcome: boolean
  ): Promise<{ bids: BookLevel[]; asks: BookLevel[] }> {
    const bids: BookLevel[] = [];
    const asks: BookLevel[] = [];
    for (const entry of await this.getOrderBook(queryId, outcome)) {
      const price = Number(entry.price);
      const size = Number(entry.amount);
      if (price < 0) {
        bids.push({ price: -price, size });
      } else if (price > 0) {
        asks.push({ price, size });
      }
    }
    return { bids, asks };
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

  /**
   * Gets a wallet's positions across all markets BY ADDRESS (get_positions_by_wallet, migration 051).
   *
   * Unlike getUserPositions (which reads the signer's own @caller positions), this reads the wallet
   * you pass in — so an owner, or a delegated market-maker bot, can monitor an agent wallet's (MAA)
   * inventory without holding its key.
   *
   * @param walletHex - The wallet to read, as a 20-byte hex address (with or without a 0x prefix).
   * @returns The wallet's positions (an empty array if it has never traded).
   */
  async getPositionsByWallet(walletHex: string): Promise<WalletPosition[]> {
    validateWalletHex(walletHex);

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_positions_by_wallet",
        inputs: { $wallet_address: walletHex },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get positions by wallet: ${result.status}`);
    }

    const rows = (result.data?.result as RawWalletPosition[]) || [];
    return rows.map((row) => ({
      queryId: row.query_id,
      outcome: row.outcome,
      price: row.price,
      amount: row.amount,
      positionType: row.position_type as WalletPosition["positionType"],
    }));
  }

  /**
   * Gets a wallet's total locked collateral on one bridge BY ADDRESS (get_collateral_by_wallet,
   * migration 051).
   *
   * Unlike getUserCollateral (which reads the signer), this reads the wallet you pass in. The bridge
   * is required (per-bridge token decimals) — use the bridge the order-book markets settle in
   * (e.g. hoodi_tt2 / eth_usdc), not the wallet's funding/fee bridge.
   *
   * @param walletHex - The wallet to read, as a 20-byte hex address (with or without a 0x prefix).
   * @param bridge - The order-book collateral bridge namespace (required).
   * @returns The wallet's collateral breakdown (all zeros if it has never traded).
   */
  async getCollateralByWallet(
    walletHex: string,
    bridge: string
  ): Promise<UserCollateral> {
    validateWalletHex(walletHex);
    validateBridge(bridge);

    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_collateral_by_wallet",
        inputs: { $wallet_address: walletHex, $bridge: bridge },
      },
      this.kwilSigner
    );

    if (result.status !== 200) {
      throw new Error(`Failed to get collateral by wallet: ${result.status}`);
    }

    const rows = result.data?.result as RawUserCollateral[];
    if (!rows || rows.length === 0) {
      return { totalLocked: "0", buyOrdersLocked: "0", sharesValue: "0" };
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
