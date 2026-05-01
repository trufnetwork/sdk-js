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
