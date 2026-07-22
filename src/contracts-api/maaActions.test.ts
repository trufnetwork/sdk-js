import { KwilSigner, NodeKwil, Utils } from "@trufnetwork/kwil-js";
import { describe, it, expect, vi } from "vitest";
import { MAAAction } from "./maaActions";
import { MAAAddress } from "../util/MAAAddress";

/**
 * Pure-unit tests for executeAgentAction (the maa_exec submission wrapper). The wire encoding and
 * broadcast live in kwil-js (asserted there against the Go golden vector); this layer only normalizes
 * the friendly input, forwards a MAAExecBody to kwil.maaExec, and surfaces the tx hash — so the kwil
 * client is mocked. The on-chain behaviour (gate, role, allow-list, @caller rewrite) is covered by the
 * node integration tests, not reachable over the black-box SDK harness.
 */

const mockSigner = { signatureType: "secp256k1_ep" } as unknown as KwilSigner;

/** A successful maaExec response carries the submission tx hash in data.tx_hash. */
const okResponse = (txHash: string) => ({ status: 200, data: { tx_hash: txHash } });

function makeAction(maaExec: ReturnType<typeof vi.fn>) {
  const mockKwil = { maaExec } as unknown as NodeKwil;
  return new MAAAction(mockKwil, mockSigner);
}

const addr20Hex = "0x" + "11".repeat(20);
const addr20Bytes = new Uint8Array(20).fill(0x11);

describe("MAAAction.executeAgentAction", () => {
  it("forwards a maa_exec body (hex address normalized to bytes) and returns the tx hash", async () => {
    const maaExec = vi.fn().mockResolvedValue(okResponse("0xdeadbeef"));
    const action = makeAction(maaExec);

    const txHash = await action.executeAgentAction({
      maaAddress: addr20Hex,
      action: "ob_place_order",
      args: ["0xabc", 42],
    });

    expect(txHash).toBe("0xdeadbeef");
    expect(maaExec).toHaveBeenCalledTimes(1);
    expect(maaExec).toHaveBeenCalledWith(
      {
        maaAddress: addr20Bytes,
        namespace: "main",
        action: "ob_place_order",
        inputs: ["0xabc", 42],
        types: undefined,
      },
      mockSigner,
    );
  });

  it("accepts a raw 20-byte Uint8Array address unchanged", async () => {
    const maaExec = vi.fn().mockResolvedValue(okResponse("0x01"));
    const action = makeAction(maaExec);

    await action.executeAgentAction({ maaAddress: addr20Bytes, action: "x" });

    const body = maaExec.mock.calls[0][0];
    expect(body.maaAddress).toEqual(addr20Bytes);
    expect(body.maaAddress.length).toBe(20);
  });

  it("defaults namespace to 'main' and respects an explicit namespace", async () => {
    const maaExec = vi.fn().mockResolvedValue(okResponse("0x01"));
    const action = makeAction(maaExec);

    await action.executeAgentAction({ maaAddress: addr20Hex, action: "a" });
    expect(maaExec.mock.calls[0][0].namespace).toBe("main");

    await action.executeAgentAction({ maaAddress: addr20Hex, action: "a", namespace: "custom" });
    expect(maaExec.mock.calls[1][0].namespace).toBe("custom");
  });

  it("defaults args to an empty array for a no-arg action", async () => {
    const maaExec = vi.fn().mockResolvedValue(okResponse("0x01"));
    const action = makeAction(maaExec);

    await action.executeAgentAction({ maaAddress: addr20Hex, action: "noop" });

    expect(maaExec.mock.calls[0][0].inputs).toEqual([]);
  });

  it("forwards positional args and the optional per-arg type overrides", async () => {
    const maaExec = vi.fn().mockResolvedValue(okResponse("0x01"));
    const action = makeAction(maaExec);
    const types = [Utils.DataType.Numeric(78, 0)];

    await action.executeAgentAction({
      maaAddress: addr20Hex,
      action: "a",
      args: ["1000"],
      types,
    });

    const body = maaExec.mock.calls[0][0];
    expect(body.inputs).toEqual(["1000"]);
    expect(body.types).toBe(types);
  });

  it("rejects an address that is not 20 bytes before broadcasting", async () => {
    const maaExec = vi.fn();
    const action = makeAction(maaExec);

    await expect(
      action.executeAgentAction({ maaAddress: "0x" + "11".repeat(19), action: "a" }),
    ).rejects.toThrow("maa_address must be 20 bytes");
    expect(maaExec).not.toHaveBeenCalled();
  });

  it("rejects an empty action before broadcasting", async () => {
    const maaExec = vi.fn();
    const action = makeAction(maaExec);

    await expect(
      action.executeAgentAction({ maaAddress: addr20Hex, action: "" }),
    ).rejects.toThrow("action must not be empty");
    expect(maaExec).not.toHaveBeenCalled();
  });

  it("throws when the node returns no tx hash", async () => {
    const maaExec = vi.fn().mockResolvedValue({ status: 200, data: {} });
    const action = makeAction(maaExec);

    await expect(
      action.executeAgentAction({ maaAddress: addr20Hex, action: "a" }),
    ).rejects.toThrow("no transaction hash returned");
  });
});

/**
 * Pure-unit tests for joinAndFundAgentAddress (the maa_join_and_fund submission wrapper). Like
 * joinAgentAddress it resolves the rule off-chain to derive the wallet locally, then submits one
 * execute; the added funding leg only threads $bridge and a NUMERIC-pinned $amount into that same
 * action. Both the getRule read (call) and the write (execute) are mocked; on-chain atomicity is
 * covered by the node integration tests.
 */
describe("MAAAction.joinAndFundAgentAddress", () => {
  const ruleIdBytes = new Uint8Array(32).fill(0xab);
  const ruleIdHex = "0x" + "ab".repeat(32);
  const restrictedHex = "0x" + "11".repeat(20);
  const ownerHex = "0x" + "22".repeat(20);

  /** getRule reads maa_get_rule; only restricted_addr is used, to derive the wallet locally. */
  const ruleRow = {
    rule_id: ruleIdHex,
    restricted_addr: restrictedHex,
    rules_hash: "0x" + "00".repeat(32),
    fee_mode: "bps",
    fee_bps: 250,
    fee_flat: "0",
    created_at: 1,
  };

  /**
   * Builds an action whose kwil client answers the getRule `call` with a supplied rule row (or none)
   * and the write `execute` with a tx hash. Records both mocks for assertions. callerAddress is the
   * owner so ownerBytes() resolves without a real signer.
   */
  function makeJoinFundAction(opts: { rule?: any; txHash?: string } = {}) {
    const call = vi.fn().mockResolvedValue({
      status: 200,
      data: { result: opts.rule === null ? [] : [opts.rule ?? ruleRow] },
    });
    const execute = vi.fn().mockResolvedValue(
      "txHash" in opts ? { data: opts.txHash ? { tx_hash: opts.txHash } : {} } : { data: { tx_hash: "0xfund" } },
    );
    const mockKwil = { call, execute } as unknown as NodeKwil;
    const action = new MAAAction(mockKwil, mockSigner, ownerHex);
    return { action, call, execute };
  }

  it("submits maa_join_and_fund with a NUMERIC-pinned amount and returns the derived wallet + tx hash", async () => {
    const { action, execute } = makeJoinFundAction();

    const res = await action.joinAndFundAgentAddress({
      ruleId: ruleIdHex,
      bridge: "eth_truf",
      amount: "40000000000000000000",
    });

    // The wallet is derived locally from (owner, rule's restricted creator, rule_id).
    const expected = MAAAddress.deriveMAAAddress(
      new Uint8Array(20).fill(0x22),
      restrictedHex,
      ruleIdBytes,
    );
    expect(res.maaAddress).toEqual(expected);
    expect(res.maaAddressHex).toBe(MAAAddress.deriveMAAAddressHex(ownerHex, restrictedHex, ruleIdBytes));
    expect(res.txHash).toBe("0xfund");

    expect(execute).toHaveBeenCalledTimes(1);
    const body = execute.mock.calls[0][0];
    expect(body.name).toBe("maa_join_and_fund");
    expect(body.namespace).toBe("main");
    expect(body.inputs).toEqual([
      { $rule_id: ruleIdBytes, $bridge: "eth_truf", $amount: "40000000000000000000" },
    ]);
    expect(body.types).toEqual({ $amount: Utils.DataType.Numeric(78, 0) });
  });

  it("accepts a raw 32-byte rule id", async () => {
    const { action, execute } = makeJoinFundAction();
    await action.joinAndFundAgentAddress({ ruleId: ruleIdBytes, bridge: "hoodi_tt", amount: "1" });
    expect(execute.mock.calls[0][0].inputs[0].$rule_id).toEqual(ruleIdBytes);
  });

  it("rejects a rule id that is not 32 bytes before any call", async () => {
    const { action, call, execute } = makeJoinFundAction();
    await expect(
      action.joinAndFundAgentAddress({ ruleId: "0x" + "ab".repeat(31), bridge: "eth_truf", amount: "1" }),
    ).rejects.toThrow("rule_id must be 32 bytes");
    expect(call).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an empty bridge before any call", async () => {
    const { action, call, execute } = makeJoinFundAction();
    await expect(
      action.joinAndFundAgentAddress({ ruleId: ruleIdHex, bridge: "  ", amount: "1" }),
    ).rejects.toThrow("bridge is required");
    expect(call).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a non-string, non-positive, non-integer, or over-78-digit amount before any call", async () => {
    // A numeric amount (not a string) and a 79-digit string (over NUMERIC(78,0)) must be rejected
    // locally, alongside the zero/negative/non-integer cases — none may reach getRule or the write.
    const badAmounts: any[] = ["0", "-1", "1.5", "", "abc", 40, "1".repeat(79)];
    for (const amount of badAmounts) {
      const { action, call, execute } = makeJoinFundAction();
      await expect(
        action.joinAndFundAgentAddress({ ruleId: ruleIdHex, bridge: "eth_truf", amount }),
      ).rejects.toThrow("positive base-10 integer string within NUMERIC(78,0)");
      expect(call).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("accepts an amount at the NUMERIC(78,0) boundary (78 digits)", async () => {
    const { action, execute } = makeJoinFundAction();
    const maxAmount = "9".repeat(78); // 10^78 - 1, the largest NUMERIC(78,0) value
    await action.joinAndFundAgentAddress({ ruleId: ruleIdHex, bridge: "eth_truf", amount: maxAmount });
    expect(execute.mock.calls[0][0].inputs[0].$amount).toBe(maxAmount);
  });

  it("throws unknown rule_id when the rule does not exist, without submitting", async () => {
    const { action, execute } = makeJoinFundAction({ rule: null });
    await expect(
      action.joinAndFundAgentAddress({ ruleId: ruleIdHex, bridge: "eth_truf", amount: "1" }),
    ).rejects.toThrow("unknown rule_id");
    expect(execute).not.toHaveBeenCalled();
  });

  it("throws when the node returns no tx hash", async () => {
    const { action } = makeJoinFundAction({ txHash: "" });
    await expect(
      action.joinAndFundAgentAddress({ ruleId: ruleIdHex, bridge: "eth_truf", amount: "1" }),
    ).rejects.toThrow("no transaction hash returned");
  });
});
