import { KwilSigner, NodeKwil } from "@trufnetwork/kwil-js";
import { describe, it, expect, vi } from "vitest";
import { OrderbookAction } from "./orderbookAction";

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
