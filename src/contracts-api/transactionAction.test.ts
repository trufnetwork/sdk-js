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

/**
 * Unit tests for listTransactionFees. The node action (migration 027) is the canonical
 * source of the query semantics; this layer only forwards the parameters and maps rows,
 * so the kwil client is mocked. Row values mirror a real mainnet response: INT8 columns
 * arrive as strings, and NUMERIC(78, 0) amounts must survive as strings.
 */

/** A real mainnet fee row, with the wire types the node actually sends. */
const feeRow = {
  tx_id: "0xfd6e1e210b855d27e278500f23de2880cbe21e70e854a0c79c1d8878b7d1f206",
  block_height: "1954022",
  method: "insertRecords",
  caller: "0x4710a8d8f0d845da110086812a32de6d90d7ff5c",
  total_fee: "1000000000000000000",
  fee_recipient: "0xe89eb212c4dbce9576dec2cf079d7e4580a60a91",
  metadata: null,
  distribution_sequence: 1,
  distribution_recipient: "0xe89eb212c4dbce9576dec2cf079d7e4580a60a91",
  distribution_amount: "1000000000000000000",
};

function makeFeeAction(call: ReturnType<typeof vi.fn>) {
  const mockKwil = { call } as unknown as NodeKwil;
  return new TransactionAction(mockKwil, mockSigner);
}

const okRows = (rows: unknown[]) => ({ status: 200, data: { result: rows } });

describe("TransactionAction.listTransactionFees", () => {
  it("calls list_transaction_fees and maps a row to camelCase", async () => {
    const call = vi.fn().mockResolvedValue(okRows([feeRow]));
    const action = makeFeeAction(call);

    const entries = await action.listTransactionFees({ wallet: feeRow.caller });

    expect(call.mock.calls[0][0]).toMatchObject({
      namespace: "main",
      name: "list_transaction_fees",
    });
    expect(entries).toEqual([
      {
        txId: feeRow.tx_id,
        blockHeight: 1954022,
        method: "insertRecords",
        caller: feeRow.caller,
        totalFee: "1000000000000000000",
        feeRecipient: feeRow.fee_recipient,
        distributionSequence: 1,
        distributionRecipient: feeRow.distribution_recipient,
        distributionAmount: "1000000000000000000",
      },
    ]);
  });

  it("defaults mode to paid and pins the node's other defaults", async () => {
    const call = vi.fn().mockResolvedValue(okRows([]));
    const action = makeFeeAction(call);

    await action.listTransactionFees({ wallet: feeRow.caller });

    expect(call.mock.calls[0][0].inputs).toEqual({
      $wallet: feeRow.caller,
      $mode: "paid",
      $limit: 20,
      $offset: 0,
    });
  });

  it("forwards mode, limit, and offset", async () => {
    const call = vi.fn().mockResolvedValue(okRows([]));
    const action = makeFeeAction(call);

    await action.listTransactionFees({
      wallet: feeRow.caller,
      mode: "both",
      limit: 200,
      offset: 40,
    });

    expect(call.mock.calls[0][0].inputs).toEqual({
      $wallet: feeRow.caller,
      $mode: "both",
      $limit: 200,
      $offset: 40,
    });
  });

  it("keeps fee amounts as strings so 18-decimal precision survives", async () => {
    // 78-digit NUMERIC is far past Number.MAX_SAFE_INTEGER; Number() would corrupt it.
    const big = "685701000000000000000000";
    const call = vi.fn().mockResolvedValue(
      okRows([{ ...feeRow, total_fee: big, distribution_amount: big }])
    );
    const action = makeFeeAction(call);

    const [entry] = await action.listTransactionFees({ wallet: feeRow.caller });

    expect(entry.totalFee).toBe(big);
    expect(entry.distributionAmount).toBe(big);
    expect(String(Number(big))).not.toBe(big);
  });

  it("converts the INT8 block height to a number", async () => {
    const call = vi.fn().mockResolvedValue(okRows([feeRow]));
    const action = makeFeeAction(call);

    const [entry] = await action.listTransactionFees({ wallet: feeRow.caller });

    expect(entry.blockHeight).toBe(1954022);
    expect(typeof entry.blockHeight).toBe("number");
  });

  it("omits optional fields the node returned as null", async () => {
    const call = vi.fn().mockResolvedValue(
      okRows([
        {
          ...feeRow,
          fee_recipient: null,
          metadata: null,
          distribution_recipient: null,
          distribution_amount: null,
        },
      ])
    );
    const action = makeFeeAction(call);

    const [entry] = await action.listTransactionFees({ wallet: feeRow.caller });

    expect(entry).not.toHaveProperty("feeRecipient");
    expect(entry).not.toHaveProperty("metadata");
    expect(entry).not.toHaveProperty("distributionRecipient");
    expect(entry).not.toHaveProperty("distributionAmount");
  });

  it("returns an empty array when the wallet has no fee rows", async () => {
    const call = vi.fn().mockResolvedValue(okRows([]));
    const action = makeFeeAction(call);

    await expect(action.listTransactionFees({ wallet: feeRow.caller })).resolves.toEqual([]);
  });

  it("rejects an empty wallet before calling the node", async () => {
    const call = vi.fn();
    const action = makeFeeAction(call);

    await expect(action.listTransactionFees({ wallet: "   " })).rejects.toThrow(/wallet is required/);
    expect(call).not.toHaveBeenCalled();
  });

  it("throws on a non-200 response", async () => {
    const call = vi.fn().mockResolvedValue({ status: 500, data: undefined });
    const action = makeFeeAction(call);

    await expect(action.listTransactionFees({ wallet: feeRow.caller })).rejects.toThrow(
      /Failed to list transaction fees: HTTP 500/
    );
  });
});
