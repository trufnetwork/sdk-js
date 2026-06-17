import { KwilSigner, NodeKwil, Utils } from "@trufnetwork/kwil-js";
import { describe, it, expect, vi } from "vitest";
import { MAAAction } from "./maaActions";

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
