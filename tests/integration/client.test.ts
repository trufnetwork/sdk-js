import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import { NodeTNClient } from "../../src/client/nodeClient";
import { setupTrufNetwork } from "./utils";

describe.sequential("Client", { timeout: 360000 }, () => {
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

  const wallet = new ethers.Wallet(
    "0x0000000000000000000000000000000000000000000000000000000000000001"
  );
  it("should create a client", async () => {
    const chainId = await NodeTNClient.getDefaultChainId(
      "http://localhost:8484"
    );
    if (!chainId) {
      throw new Error("Chain id not found");
    }
    const client = new NodeTNClient({
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
