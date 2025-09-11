import { describe, test, expect } from 'vitest'
import { NodeTNClient } from '../../src/client/nodeClient'
import { Action } from "../../src";
import { Wallet } from 'ethers'

describe('ERC20 Bridge Tests', () => {
  const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
  const chainId = process.env.TEST_CHAIN_ID || "tn-v2.1";

  test('get wallet balance - should fail with default private key', async () => {
    // Use default private key that doesn't have permissions
    const defaultPrivateKey = "0x0000000000000000000000000000000000000000100000000100000000000001";
    const wallet = new Wallet(defaultPrivateKey);

    const client = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });

    await expect(async () => {
      await client.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
    }).rejects.toThrow("You don't have necessary permissions to execute this query");
  });

  test('get wallet balance - should pass with environment private key', async () => {
    // Use private key from environment that has permissions
    const envPrivateKey = process.env.TEST_PRIVATE_KEY;
    
    // Skip test if no environment private key is provided
    if (!envPrivateKey) {
      console.warn('TEST_PRIVATE_KEY not provided, skipping authorized test');
      return;
    }

    const wallet = new Wallet(envPrivateKey);

    const client = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });

    const balance = await client.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE");
    expect(Number(balance)).toBeGreaterThanOrEqual(0);
  });
});