import { KwilSigner, NodeKwil } from "@trufnetwork/kwil-js";
import { describe, it, expect, vi } from "vitest";
import { TransactionAction } from "./transactionAction";

/**
 * Pure-unit tests for getTransactionInput. The wire decoding is covered in TransactionPayload.test.ts
 * (and, canonically, in kwil-js); this layer only normalizes the hash, calls txInfo, validates the
 * receipt, and delegates decoding — so the kwil client is mocked. The live txInfo round-trip is an
 * integration concern, not reachable in a pure-unit test.
 */

const mockSigner = { signatureType: "secp256k1_ep" } as unknown as KwilSigner;

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

// kwil-db ActionExecution.MarshalBinary for namespace "main", action "insert_records",
// [["stream_a", int64(100), true], ["stream_b", int64(-5), false]].
const goHex =
  "0000" +
  "040000006d61696e" +
  "0e000000696e736572745f7265636f726473" +
  "0200" +
  "0300" +
  "2400000000000f0000000000000000047465787400000000000100090000000173747265616d5f61" +
  "2400000000000f000000000000000004696e74380000000000010009000000010000000000000064" +
  "1d00000000000f000000000000000004626f6f6c00000000000100020000000101" +
  "0300" +
  "2400000000000f0000000000000000047465787400000000000100090000000173747265616d5f62" +
  "2400000000000f000000000000000004696e7438000000000001000900000001fffffffffffffffb" +
  "1d00000000000f000000000000000004626f6f6c00000000000100020000000100";
const payloadBytes = hexToBytes(goHex);

/** A successful txInfo receipt with the given payload and type. */
const okReceipt = (payload: unknown, type = "execute") => ({
  status: 200,
  data: { tx: { body: { type, payload } } },
});

function makeAction(txInfo: ReturnType<typeof vi.fn>) {
  const mockKwil = { txInfo } as unknown as NodeKwil;
  return new TransactionAction(mockKwil, mockSigner);
}

describe("TransactionAction.getTransactionInput", () => {
  it("decodes the payload into namespace, action, and native arguments", async () => {
    const txInfo = vi.fn().mockResolvedValue(okReceipt(payloadBytes));
    const action = makeAction(txInfo);

    const result = await action.getTransactionInput({ txId: "abc123" });

    expect(result.namespace).toBe("main");
    expect(result.action).toBe("insert_records");
    expect(result.arguments).toEqual([
      ["stream_a", 100n, true],
      ["stream_b", -5n, false],
    ]);
  });

  it("strips a 0x prefix before querying (node expects 64-char hex)", async () => {
    const txInfo = vi.fn().mockResolvedValue(okReceipt(payloadBytes));
    const action = makeAction(txInfo);

    await action.getTransactionInput({ txId: "0xABC123" });

    expect(txInfo).toHaveBeenCalledWith("ABC123");
  });

  it("accepts a base64-encoded payload", async () => {
    const base64 = Buffer.from(payloadBytes).toString("base64");
    const txInfo = vi.fn().mockResolvedValue(okReceipt(base64));
    const action = makeAction(txInfo);

    const result = await action.getTransactionInput({ txId: "abc123" });

    expect(result.action).toBe("insert_records");
  });

  it("throws when the tx id is empty", async () => {
    const action = makeAction(vi.fn());
    await expect(action.getTransactionInput({ txId: "  " })).rejects.toThrow(/tx_id is required/);
  });

  it("throws when the node returns a non-200 status", async () => {
    const txInfo = vi.fn().mockResolvedValue({ status: 500, data: null });
    const action = makeAction(txInfo);
    await expect(action.getTransactionInput({ txId: "abc123" })).rejects.toThrow(/HTTP 500/);
  });

  it("throws when the transaction has no payload", async () => {
    const txInfo = vi.fn().mockResolvedValue(okReceipt(null));
    const action = makeAction(txInfo);
    await expect(action.getTransactionInput({ txId: "abc123" })).rejects.toThrow(/no payload/);
  });

  it("throws when the payload is not an action call", async () => {
    const txInfo = vi.fn().mockResolvedValue(okReceipt(payloadBytes, "transfer"));
    const action = makeAction(txInfo);
    await expect(action.getTransactionInput({ txId: "abc123" })).rejects.toThrow(/not an action call/);
  });

  it("wraps a decode failure with the transaction id", async () => {
    // A truncated execute payload makes the decoder throw; the tx id must be in the message.
    const txInfo = vi.fn().mockResolvedValue(okReceipt(hexToBytes("0000"), "execute"));
    const action = makeAction(txInfo);
    await expect(action.getTransactionInput({ txId: "0xdeadbeef" })).rejects.toThrow(
      /Failed to decode transaction input for 0xdeadbeef/
    );
  });
});
