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
  const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
  const chainId = process.env.TEST_CHAIN_ID || "tn-v2.1";

  beforeAll(() => {
    const privateKey =
      process.env.TEST_PRIVATE_KEY ||
      "0x0000000000000000000000000000000000000000100000000100000000000001";
    const wallet = new Wallet(privateKey);

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
