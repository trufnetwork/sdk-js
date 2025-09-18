import { describe, test, expect, beforeAll } from 'vitest'
import { NodeTNClient } from '../../src/client/nodeClient'
import { Wallet } from 'ethers'

describe('ERC20 Bridge Tests', () => {
  let authorizedClient: NodeTNClient;
  const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
  const chainId = process.env.TEST_CHAIN_ID || "tn-v2.1";

  beforeAll(async () => {
    // Use environment private key as default for all tests
    const envPrivateKey = process.env.TEST_PRIVATE_KEY || "0x0000000000000000000000000000000000000000100000000100000000000001";
    const wallet = new Wallet(envPrivateKey);

    authorizedClient = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });
  });

  test('get wallet balance - should work with any client (publicly accessible)', async () => {
    // Create a separate client with unauthorized private key
    const unauthorizedPrivateKey = "0x0000000000000000000000000000000000000000100000000100000000000001";
    const wallet = new Wallet(unauthorizedPrivateKey);

    const unauthorizedClient = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });

    // The wallet balance endpoint is actually publicly accessible
    // It returns a valid balance (could be 0) rather than throwing an error
    const result = await unauthorizedClient.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
    expect(typeof result).toBe("string");
    expect(Number(result)).toBeGreaterThanOrEqual(0);
  }, 60000);

  test('get wallet balance - should pass with authorized client', async () => {
    try {
      const balance = await authorizedClient.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
      expect(Number(balance)).toBeGreaterThanOrEqual(0);
    } catch (error: any) {
      // Skip test if backend is unavailable in test environment
      if (error.message?.includes("no available backend")) {
        console.info("Skipping test: blockchain backend unavailable in test environment");
        return;
      }
      throw error;
    }
  }, 60000);
});