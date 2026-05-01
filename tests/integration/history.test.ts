import { describe, test, expect, beforeAll } from "vitest";
import { Wallet } from "ethers";
import { NodeTNClient } from "../../src/client/nodeClient";

// getHistory is read-only and the bridge actions only exist on mainnet
// (local node CI does not apply internal/migrations/erc20-bridge/*.sql via
// migrate.sh), so this suite hits the mainnet gateway directly with
// mainnet bridge identifiers (eth_truf / eth_usdc) instead of the
// retired testnet ids (hoodi_tt / hoodi_tt2 / sepolia).
describe("Transaction History Integration Tests", { timeout: 120000 }, () => {
  let client: NodeTNClient;

  beforeAll(() => {
    const endpoint = process.env.TEST_ENDPOINT;
    const chainId = process.env.TEST_CHAIN_ID;
    if (!endpoint || !chainId) {
      throw new Error(
        "TEST_ENDPOINT and TEST_CHAIN_ID must be set; refusing to silently default to mainnet.",
      );
    }

    // Read-only suite: a fresh random wallet is sufficient and avoids
    // committing a private key. We expect getHistory to return [] for a
    // wallet that has never touched a bridge.
    const wallet = Wallet.createRandom();

    client = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });
  });

  test("should return empty history for new wallet across mainnet bridges", async () => {
    const walletAddress = client.address().getAddress();

    for (const bridge of ["eth_truf", "eth_usdc"]) {
      const history = await client.getHistory(bridge, walletAddress, 10, 0);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    }
  }, 60000);

  test("should accept pagination parameters", async () => {
    const walletAddress = client.address().getAddress();
    const history = await client.getHistory("eth_usdc", walletAddress, 5, 10);
    expect(Array.isArray(history)).toBe(true);
  }, 60000);
});
