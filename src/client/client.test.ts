import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import { NodeTSNClient } from "./nodeClient";

describe.sequential("Client", { timeout: 30000 }, () => {
  // Skip in CI, because it needs a local node
  it.skipIf(process.env.CI);

  const wallet = new ethers.Wallet(
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  );
  it("should create a client", async () => {
    const chainId = await NodeTSNClient.getDefaultChainId(
      "http://localhost:8484",
    );
    if (!chainId) {
      throw new Error("Chain id not found");
    }
    const client = new NodeTSNClient({
      endpoint: "http://localhost:8484",
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
    });
    const kwilClient = client.getKwilClient();
    const chainInfo = await kwilClient.chainInfo();
    expect(chainInfo.data?.chain_id).toBeDefined();
  });
});
