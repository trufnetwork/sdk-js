import { Action } from "./action";
import { BridgeHistory } from "../types/bridge";
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
});
