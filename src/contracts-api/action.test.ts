import { Action, ReservedMetadataKeyError } from "./action";
import { BridgeHistory } from "../types/bridge";
import { MetadataKey, MetadataKeyValueMap, MetadataType } from "./contractValues";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { KwilSigner, NodeKwil } from "@trufnetwork/kwil-js";
import { Either } from "monads-io";
import { vi, describe, it, expect } from "vitest";

describe("Action", () => {
    // Mock dependencies
    const mockKwil = {
        call: vi.fn(),
    } as unknown as NodeKwil;

    const mockSigner = {
        signatureType: "secp256k1_ep",
    } as unknown as KwilSigner;

    it("coerces INT8 columns the node sends as strings into the declared numbers", async () => {
        // block_height / block_timestamp are INT8, which arrives as a string over the
        // wire even though BridgeHistory declares them as number. A real mainnet row.
        const action = new Action(mockKwil, mockSigner);
        const callSpy = vi.spyOn(action as any, "call");

        callSpy.mockResolvedValue(
            Either.right([
                {
                    type: "transfer",
                    amount: "1000000000000000000",
                    from_address: "RxCo2PDYRdoRAIaBKjLebZDX/1w=",
                    to_address: "6J6yEsTbzpV23sLPB51+RYCmCpE=",
                    internal_tx_hash: "/qipiretMAD0LqJOijtZ5pOzPvvBP4xYqU/NYaoeqFY=",
                    external_tx_hash: null,
                    status: "completed",
                    block_height: "1954099",
                    block_timestamp: "1784644272",
                    external_block_height: null,
                } as unknown as BridgeHistory,
            ])
        );

        const [row] = await action.getHistory("eth_truf", "0x123", 1, 0);

        expect(row.block_height).toBe(1954099);
        expect(row.block_timestamp).toBe(1784644272);
        expect(typeof row.block_height).toBe("number");
        expect(typeof row.block_timestamp).toBe("number");
        // A null external height stays null rather than becoming 0.
        expect(row.external_block_height).toBeNull();
        // NUMERIC amounts must NOT be coerced; precision would be lost.
        expect(row.amount).toBe("1000000000000000000");
    });

    it("leaves numeric INT8 values untouched", async () => {
        const action = new Action(mockKwil, mockSigner);
        const callSpy = vi.spyOn(action as any, "call");

        callSpy.mockResolvedValue(
            Either.right([
                {
                    type: "deposit",
                    amount: "100",
                    from_address: null,
                    to_address: "0x123",
                    internal_tx_hash: null,
                    external_tx_hash: "0xabc",
                    status: "completed",
                    block_height: 10,
                    block_timestamp: 1000,
                    external_block_height: 5,
                } as BridgeHistory,
            ])
        );

        const [row] = await action.getHistory("sepolia_bridge", "0x123", 1, 0);

        expect(row.block_height).toBe(10);
        expect(row.block_timestamp).toBe(1000);
        expect(row.external_block_height).toBe(5);
    });

    it("should call get_history with correct parameters", async () => {
        const action = new Action(mockKwil, mockSigner);
        
        // Spy on the 'call' method of the action instance
        const callSpy = vi.spyOn(action as any, "call");
        
        const mockHistory: BridgeHistory[] = [{
            type: "deposit",
            amount: "100",
            from_address: null,
            to_address: "0x123",
            internal_tx_hash: null,
            external_tx_hash: "0xabc",
            status: "completed",
            block_height: 10,
            block_timestamp: 1000,
            external_block_height: 5
        }];

        callSpy.mockResolvedValue(Either.right(mockHistory));

        const result = await action.getHistory("sepolia_bridge", "0x123", 10, 5);

        expect(callSpy).toHaveBeenCalledWith(
            "sepolia_bridge_get_history",
            {
                $wallet_address: "0x123",
                $limit: 10,
                $offset: 5
            }
        );
        
        expect(result).toEqual(mockHistory);
    });

    it("should handle null results from get_history", async () => {
        const action = new Action(mockKwil, mockSigner);
        const callSpy = vi.spyOn(action as any, "call");
        
        callSpy.mockResolvedValue(Either.right(null));

        const result = await action.getHistory("bridge", "0x123");

        expect(result).toEqual([]);
    });

    it("should use default parameters for getHistory", async () => {
        const action = new Action(mockKwil, mockSigner);
        const callSpy = vi.spyOn(action as any, "call");

        callSpy.mockResolvedValue(Either.right([]));

        await action.getHistory("bridge", "0x123");

        expect(callSpy).toHaveBeenCalledWith(
            "bridge_get_history",
            {
                $wallet_address: "0x123",
                $limit: 20,
                $offset: 0
            }
        );
    });

    describe("allow_zeros wiring", () => {
        // Locks in the metadata-key registration: a future rename in the
        // node-side migration would silently break SDK callers without
        // this assertion.
        it("registers AllowZerosKey as a Bool metadata type", () => {
            expect(MetadataKey.AllowZerosKey).toBe("allow_zeros");
            expect(MetadataKeyValueMap[MetadataKey.AllowZerosKey]).toBe(MetadataType.Bool);
        });

        it("setAllowZeros calls set_allow_zeros with $value=true", async () => {
            const action = new Action(mockKwil, mockSigner);
            const execSpy = vi.spyOn(action as any, "executeWithNamedParams");
            execSpy.mockResolvedValue({ data: { tx_hash: "abc" }, status: 200 });

            const streamId = StreamId.fromString("st00000000000000000000000000a110").throw();
            const dp = EthereumAddress.fromString("0x000000000000000000000000000000000000a110").throw();

            await action.setAllowZeros({ streamId, dataProvider: dp }, true);

            expect(execSpy).toHaveBeenCalledWith("set_allow_zeros", [{
                $data_provider: dp.getAddress(),
                $stream_id: streamId.getId(),
                $value: true,
            }]);
        });

        it("getAllowZeros returns false when get_allow_zeros yields no rows", async () => {
            const action = new Action(mockKwil, mockSigner);
            const callSpy = vi.spyOn(action as any, "call");
            callSpy.mockResolvedValue(Either.right([]));

            const streamId = StreamId.fromString("st00000000000000000000000000a111").throw();
            const dp = EthereumAddress.fromString("0x000000000000000000000000000000000000a111").throw();

            const v = await action.getAllowZeros({ streamId, dataProvider: dp });
            expect(v).toBe(false);
        });

        it("getAllowZeros returns true when get_allow_zeros yields allow_zeros=true", async () => {
            const action = new Action(mockKwil, mockSigner);
            const callSpy = vi.spyOn(action as any, "call");
            callSpy.mockResolvedValue(Either.right([{ allow_zeros: true }]));

            const streamId = StreamId.fromString("st00000000000000000000000000a112").throw();
            const dp = EthereumAddress.fromString("0x000000000000000000000000000000000000a112").throw();

            const v = await action.getAllowZeros({ streamId, dataProvider: dp });
            expect(v).toBe(true);
        });

        // Mirrors the node-side guard: routing AllowZerosKey through
        // the generic setMetadata path would let two parallel "latest"
        // rows coexist. The TypeScript Exclude already blocks this at
        // compile time; this runtime test catches the `as any` escape
        // hatch and asserts the SDK throws ReservedMetadataKeyError
        // before the node ever sees the request.
        it("setMetadata throws ReservedMetadataKeyError when called with AllowZerosKey", async () => {
            const action = new Action(mockKwil, mockSigner);
            const execSpy = vi.spyOn(action as any, "executeWithNamedParams");

            const streamId = StreamId.fromString("st00000000000000000000000000a113").throw();
            const dp = EthereumAddress.fromString("0x000000000000000000000000000000000000a113").throw();

            // Cast through `any` to bypass the protected modifier and the
            // type-level Exclude — we want to prove the runtime guard
            // also fires for callers who reach the helper dynamically.
            const setMetadata = (action as any).setMetadata.bind(action);

            await expect(
                setMetadata({ streamId, dataProvider: dp }, MetadataKey.AllowZerosKey, true),
            ).rejects.toBeInstanceOf(ReservedMetadataKeyError);

            expect(execSpy).not.toHaveBeenCalled();
        });
    });
});

/**
 * Unit tests for getOrderedBalances (migration 053, the "richlist").
 *
 * The kwil client is mocked; this layer only forwards the call with the right action name, named
 * params and types, and maps the returned rows. On-chain behaviour — including the hard cap of 50,
 * which cannot be exercised against mainnet because no token has more than 24 holders — is covered
 * by node/tests/streams/order_book/richlist_test.go.
 *
 * Three behaviours below are load-bearing rather than cosmetic, each documented in the design spec
 * (0GoalViewTransactionsInExplorer/2026-07-21_sdk-js-ordered-balances-design.md):
 *   - All four params are always sent. kwil-js resolves named params positionally, so omitting a
 *     middle one silently shifts later arguments into the wrong slots (spec F1).
 *   - $min_balance carries an explicit Numeric(78,0) type, without which the node rejects it as
 *     text (spec F2).
 *   - An unsupported token is rejected client-side, because kwil-js reports the node's ERROR as an
 *     empty 200, making it otherwise indistinguishable from "no holders" (spec F3).
 */
describe("Action.getOrderedBalances", () => {
    const mockSigner = { signatureType: "secp256k1_ep" } as unknown as KwilSigner;

    const ok = (result: unknown) => ({ status: 200, data: { result } });

    function makeAction(call: ReturnType<typeof vi.fn>) {
        return new Action({ call } as unknown as NodeKwil, mockSigner);
    }

    /** A real mainnet TRUF balance: 24 digits, far beyond Number.MAX_SAFE_INTEGER (~9.0e15). */
    const BIG_BALANCE = "685701000000000000000000";

    it("calls get_ordered_balances and maps the returned rows", async () => {
        const call = vi.fn().mockResolvedValue(
            ok([
                { address: "0xaaa", balance: BIG_BALANCE },
                { address: "0xbbb", balance: "661171000000000000000000" },
            ]),
        );
        const action = makeAction(call);

        const balances = await action.getOrderedBalances({ token: "TRUF" });

        expect(call).toHaveBeenCalledTimes(1);
        const [body] = call.mock.calls[0];
        expect(body.namespace).toBe("main");
        expect(body.name).toBe("get_ordered_balances");
        expect(balances).toEqual([
            { address: "0xaaa", balance: BIG_BALANCE },
            { address: "0xbbb", balance: "661171000000000000000000" },
        ]);
    });

    it("preserves a 24-digit balance exactly, without routing it through a number", async () => {
        const call = vi.fn().mockResolvedValue(ok([{ address: "0xaaa", balance: BIG_BALANCE }]));
        const action = makeAction(call);

        const [balance] = await action.getOrderedBalances({ token: "TRUF" });

        // The guard: Number(BIG_BALANCE) rounds to 6.85701e+23 and drops the low-order digits.
        expect(balance.balance).toBe(BIG_BALANCE);
        expect(typeof balance.balance).toBe("string");
    });

    it("sends the node's own defaults when the caller omits the optional params", async () => {
        const call = vi.fn().mockResolvedValue(ok([]));
        const action = makeAction(call);

        await action.getOrderedBalances({ token: "TRUF" });

        const [body] = call.mock.calls[0];
        // Pinned against migration 053: ascending=false, limit=20, min_balance=NULL. kwil-js
        // resolves named params positionally, so each must be present and in the declared order.
        expect(body.inputs).toEqual({
            $token: "TRUF",
            $ascending: false,
            $limit: 20,
            $min_balance: null,
        });
        expect(Object.keys(body.inputs)).toEqual([
            "$token",
            "$ascending",
            "$limit",
            "$min_balance",
        ]);
    });

    it("types $min_balance as numeric(78,0) so the node does not reject it as text", async () => {
        const call = vi.fn().mockResolvedValue(ok([]));
        const action = makeAction(call);

        await action.getOrderedBalances({ token: "USDC", minBalance: "1000000" });

        const [body] = call.mock.calls[0];
        expect(body.types.$min_balance).toEqual(
            expect.objectContaining({ name: "numeric", metadata: [78, 0] }),
        );
        expect(body.inputs.$min_balance).toBe("1000000");
    });

    it("forwards ascending, limit and minBalance when supplied", async () => {
        const call = vi.fn().mockResolvedValue(ok([]));
        const action = makeAction(call);

        await action.getOrderedBalances({
            token: "USDC",
            ascending: true,
            limit: 5,
            minBalance: "1000000",
        });

        const [body] = call.mock.calls[0];
        expect(body.inputs).toEqual({
            $token: "USDC",
            $ascending: true,
            $limit: 5,
            $min_balance: "1000000",
        });
    });

    it("rejects an unsupported token before making any call", async () => {
        const call = vi.fn();
        const action = makeAction(call);

        await expect(
            action.getOrderedBalances({ token: "ETH" as unknown as "TRUF" }),
        ).rejects.toThrow(/unsupported token/i);

        // The node reports its own ERROR as an empty 200, so a bad token would otherwise look
        // identical to a token with no holders. Failing before the round trip is the fix.
        expect(call).not.toHaveBeenCalled();
    });

    it("returns an empty array when no wallet clears the threshold", async () => {
        const call = vi.fn().mockResolvedValue(ok([]));
        const action = makeAction(call);

        const balances = await action.getOrderedBalances({
            token: "TRUF",
            minBalance: "999999999999999999999999999",
        });

        // Deliberately unlike getWalletBalance, which throws on zero rows: for a richlist,
        // "nobody is above your threshold" is a legitimate answer rather than a failure.
        expect(balances).toEqual([]);
    });

    it("throws when the node returns a non-200 status", async () => {
        const call = vi.fn().mockResolvedValue({ status: 500, data: undefined });
        const action = makeAction(call);

        await expect(action.getOrderedBalances({ token: "TRUF" })).rejects.toThrow(
            /ordered balances/i,
        );
    });
});
