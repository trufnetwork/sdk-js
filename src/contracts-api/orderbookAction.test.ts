import { KwilSigner, NodeKwil } from "@trufnetwork/kwil-js";
import { describe, it, expect, vi } from "vitest";
import { OrderbookAction } from "./orderbookAction";
import type { ConsolidatedLevel } from "../types/orderbook";

/**
 * Pure-unit tests for the address-parameterized portfolio getters (migration 051):
 * getPositionsByWallet / getCollateralByWallet. These read a wallet BY ADDRESS (not the signer's
 * @caller), so an owner — or a delegated market-maker bot — can monitor an agent wallet's (MAA)
 * inventory without holding its key. The kwil client is mocked; this layer only forwards the call
 * with the right action name + named params and maps the returned rows. The on-chain behaviour is
 * covered by the node integration tests (tests/streams/order_book/portfolio_by_wallet_test.go).
 */

const mockSigner = { signatureType: "secp256k1_ep" } as unknown as KwilSigner;

const ok = (result: unknown) => ({ status: 200, data: { result } });

function makeAction(call: ReturnType<typeof vi.fn>) {
  const mockKwil = { call } as unknown as NodeKwil;
  return new OrderbookAction(mockKwil, mockSigner);
}

const wallet = "0x" + "ab".repeat(20);
const bareWallet = "ab".repeat(20);

describe("OrderbookAction.getPositionsByWallet", () => {
  it("calls get_positions_by_wallet with the wallet as a named param and maps the rows", async () => {
    const call = vi.fn().mockResolvedValue(
      ok([
        { query_id: 7, outcome: true, price: -55, amount: 100, position_type: "buy_order" },
        { query_id: 9, outcome: false, price: 0, amount: 40, position_type: "holding" },
      ]),
    );
    const action = makeAction(call);

    const positions = await action.getPositionsByWallet(wallet);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      { namespace: "main", name: "get_positions_by_wallet", inputs: { $wallet_address: wallet } },
      mockSigner,
    );
    expect(positions).toEqual([
      { queryId: 7, outcome: true, price: -55, amount: 100, positionType: "buy_order" },
      { queryId: 9, outcome: false, price: 0, amount: 40, positionType: "holding" },
    ]);
  });

  it("accepts a bare-hex wallet (no 0x prefix)", async () => {
    const call = vi.fn().mockResolvedValue(ok([]));
    const action = makeAction(call);

    await action.getPositionsByWallet(bareWallet);

    expect(call.mock.calls[0][0].inputs).toEqual({ $wallet_address: bareWallet });
  });

  it("returns an empty array for a wallet that has never traded", async () => {
    const call = vi.fn().mockResolvedValue(ok([]));
    const action = makeAction(call);

    expect(await action.getPositionsByWallet(wallet)).toEqual([]);
  });

  it("rejects a malformed wallet address before calling", async () => {
    const call = vi.fn();
    const action = makeAction(call);

    await expect(action.getPositionsByWallet("0x1234")).rejects.toThrow(
      "wallet address must be 40 hex characters",
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("throws on a non-200 status", async () => {
    const call = vi.fn().mockResolvedValue({ status: 500, data: {} });
    const action = makeAction(call);

    await expect(action.getPositionsByWallet(wallet)).rejects.toThrow(
      "Failed to get positions by wallet: 500",
    );
  });
});

describe("OrderbookAction.getCollateralByWallet", () => {
  it("calls get_collateral_by_wallet with wallet + bridge named params and maps the row", async () => {
    const call = vi.fn().mockResolvedValue(
      ok([
        {
          total_locked: "55000000000000000000",
          buy_orders_locked: "55000000000000000000",
          shares_value: "0",
        },
      ]),
    );
    const action = makeAction(call);

    const collateral = await action.getCollateralByWallet(wallet, "hoodi_tt2");

    expect(call).toHaveBeenCalledWith(
      {
        namespace: "main",
        name: "get_collateral_by_wallet",
        inputs: { $wallet_address: wallet, $bridge: "hoodi_tt2" },
      },
      mockSigner,
    );
    expect(collateral).toEqual({
      totalLocked: "55000000000000000000",
      buyOrdersLocked: "55000000000000000000",
      sharesValue: "0",
    });
  });

  it("returns zeros for a wallet that has never traded", async () => {
    const call = vi.fn().mockResolvedValue(ok([]));
    const action = makeAction(call);

    expect(await action.getCollateralByWallet(wallet, "hoodi_tt2")).toEqual({
      totalLocked: "0",
      buyOrdersLocked: "0",
      sharesValue: "0",
    });
  });

  it("rejects an invalid or empty order-book bridge before calling", async () => {
    const call = vi.fn();
    const action = makeAction(call);

    // hoodi_tt is the funding/fee bridge, not a valid order-book collateral bridge.
    await expect(action.getCollateralByWallet(wallet, "hoodi_tt")).rejects.toThrow("Invalid bridge");
    await expect(action.getCollateralByWallet(wallet, "")).rejects.toThrow("Invalid bridge");
    expect(call).not.toHaveBeenCalled();
  });

  it("rejects a malformed wallet address before calling", async () => {
    const call = vi.fn();
    const action = makeAction(call);

    await expect(action.getCollateralByWallet("nothex", "hoodi_tt2")).rejects.toThrow(
      "wallet address",
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("throws on a non-200 status", async () => {
    const call = vi.fn().mockResolvedValue({ status: 503, data: {} });
    const action = makeAction(call);

    await expect(action.getCollateralByWallet(wallet, "hoodi_tt2")).rejects.toThrow(
      "Failed to get collateral by wallet: 503",
    );
  });
});

/**
 * getConsolidatedOrderBook: the two outcome books folded into the one ladder a
 * trader can actually hit. The mapping is arithmetic on one get_full_market_depth
 * read, so it is fully testable against a mocked client. What matters is that the
 * SIDES swap (a NO ask is a YES bid, not a YES ask) and that each level keeps its
 * native/inverse split, since mint and burn only fire at the exact complement and
 * a caller quoting a fill needs to know which is which.
 *
 * The read is one call because both sides have to describe the same moment. Two
 * calls let an order land between them, and the stitched ladder can then read as
 * crossed when neither height was.
 */

/** One depth row as get_full_market_depth returns it, before its outcome tag. */
type DepthRow = { price: number; buy?: number; sell?: number };

function makeDepthAction(books: { yes: DepthRow[]; no: DepthRow[] }) {
  const call = vi.fn(async (body: { name: string; inputs: Record<string, unknown> }) => {
    if (body.name !== "get_full_market_depth") {
      throw new Error(`unexpected action ${body.name}`);
    }
    // YES levels first then NO, as the action orders them.
    const rows = [
      ...books.yes.map((row) => ({ ...row, outcome: true })),
      ...books.no.map((row) => ({ ...row, outcome: false })),
    ].map((row) => ({
      outcome: row.outcome,
      price: row.price,
      buy_volume: row.buy ?? 0,
      sell_volume: row.sell ?? 0,
    }));
    return ok(rows);
  });
  return { call, action: makeAction(call as unknown as ReturnType<typeof vi.fn>) };
}

describe("OrderbookAction.getFullMarketDepth", () => {
  it("reads the whole market in one call and keeps each level's outcome", async () => {
    const { call, action } = makeDepthAction({
      yes: [{ price: 55, buy: 150 }],
      no: [{ price: 40, sell: 100 }],
    });

    const depth = await action.getFullMarketDepth(419);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].inputs).toEqual({ $query_id: 419 });
    expect(depth).toEqual([
      { outcome: true, price: 55, buyVolume: 150, sellVolume: 0 },
      { outcome: false, price: 40, buyVolume: 0, sellVolume: 100 },
    ]);
  });

  it("throws on a non-200 status", async () => {
    const call = vi.fn(async () => ({ status: 503, data: undefined }));
    const action = makeAction(call as unknown as ReturnType<typeof vi.fn>);

    await expect(action.getFullMarketDepth(419)).rejects.toThrow(
      "Failed to get full market depth: 503",
    );
  });
});

describe("OrderbookAction.getConsolidatedOrderBook", () => {
  it("reads the whole book in one call rather than one call per outcome", async () => {
    const { call, action } = makeDepthAction({ yes: [], no: [] });

    const book = await action.getConsolidatedOrderBook(419);

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toMatchObject({
      name: "get_full_market_depth",
      inputs: { $query_id: 419 },
    });
    expect(book).toEqual({
      queryId: 419,
      outcome: true,
      bids: [],
      asks: [],
      isCrossed: false,
    });
  });

  it("shows a NO ask at 93 as a YES bid at 7 of the same size", async () => {
    // The case from truflation/website#4385: an ask for 4 shares of NO at 93c
    // is economically a bid for 4 shares of YES at 7c, and the chain burns the
    // pair to fill it.
    const { action } = makeDepthAction({
      yes: [],
      no: [{ price: 93, sell: 4 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.bids).toEqual([{ price: 7, total: 4, native: 0, inverse: 4 }]);
    expect(book.asks).toEqual([]);
  });

  it("shows a NO bid at 41 as a YES ask at 59", async () => {
    const { action } = makeDepthAction({
      yes: [],
      no: [{ price: 41, buy: 200 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.asks).toEqual([{ price: 59, total: 200, native: 0, inverse: 200 }]);
    expect(book.bids).toEqual([]);
  });

  it("routes a level by its outcome tag, not by its price", async () => {
    // Both sells sit at 60 in their own book. The YES one is an ask at 60; the
    // NO one is a bid at 40. Read the tag wrong and they land on the same side.
    const { action } = makeDepthAction({
      yes: [{ price: 60, sell: 10 }],
      no: [{ price: 60, sell: 20 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.asks).toEqual([{ price: 60, total: 10, native: 10, inverse: 0 }]);
    expect(book.bids).toEqual([{ price: 40, total: 20, native: 0, inverse: 20 }]);
  });

  it("merges native and inverse volume at one price and keeps the split", async () => {
    const { action } = makeDepthAction({
      yes: [{ price: 59, sell: 100 }],
      no: [{ price: 41, buy: 200 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.asks).toEqual([{ price: 59, total: 300, native: 100, inverse: 200 }]);
  });

  it("sorts bids best-highest and asks best-lowest", async () => {
    const { action } = makeDepthAction({
      yes: [
        { price: 60, sell: 100 },
        { price: 30, buy: 10 },
      ],
      no: [
        { price: 41, buy: 200 },
        { price: 45, buy: 50 },
        { price: 55, sell: 25 },
      ],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.asks.map((l) => l.price)).toEqual([55, 59, 60]);
    expect(book.bids.map((l) => l.price)).toEqual([45, 30]);
  });

  it("returns the NO book as the YES book reflected", async () => {
    const books = {
      yes: [
        { price: 60, sell: 100 },
        { price: 30, buy: 10 },
      ],
      no: [
        { price: 41, buy: 200 },
        { price: 55, sell: 25 },
      ],
    };
    const yesBook = await makeDepthAction(books).action.getConsolidatedOrderBook(419, true);
    const noBook = await makeDepthAction(books).action.getConsolidatedOrderBook(419, false);

    expect(noBook.outcome).toBe(false);
    // Price q on one side is 100 - q on the other, bids become asks, and what
    // was native in the YES frame is inverse in the NO frame.
    const mirror = (l: ConsolidatedLevel): ConsolidatedLevel => ({
      price: 100 - l.price,
      total: l.total,
      native: l.inverse,
      inverse: l.native,
    });
    expect(noBook.asks).toEqual(yesBook.bids.map(mirror));
    expect(noBook.bids).toEqual(yesBook.asks.map(mirror));
  });

  it("reports a crossed book rather than hiding it", async () => {
    // A YES bid at 61 and a NO bid at 45 read as a bid at 61 over an ask at 55.
    // 61 + 45 is 106, so no mint fires and the crossing rests indefinitely.
    const { action } = makeDepthAction({
      yes: [{ price: 61, buy: 30 }],
      no: [{ price: 45, buy: 30 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.bids[0].price).toBe(61);
    expect(book.asks[0].price).toBe(55);
    expect(book.isCrossed).toBe(true);
  });

  it("drops empty price levels and never reports an uncrossed book as crossed", async () => {
    const { action } = makeDepthAction({
      yes: [
        { price: 40, buy: 0, sell: 0 },
        { price: 45, buy: 10 },
      ],
      no: [{ price: 44, buy: 20 }],
    });

    const book = await action.getConsolidatedOrderBook(419, true);

    expect(book.bids).toEqual([{ price: 45, total: 10, native: 10, inverse: 0 }]);
    expect(book.asks).toEqual([{ price: 56, total: 20, native: 0, inverse: 20 }]);
    expect(book.isCrossed).toBe(false);
  });
});
