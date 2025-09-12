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

  test('get wallet balance - should fail with unauthorized private key', async () => {
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

    await expect(async () => {
      await unauthorizedClient.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
    }).rejects.toThrow("You don't have necessary permissions to execute this query");
  }, 20000);

  test('get wallet balance - should pass with authorized client', async () => {
    const balance = await authorizedClient.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
    expect(Number(balance)).toBeGreaterThanOrEqual(0);
  }, 20000);
});