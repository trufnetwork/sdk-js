import { ethers } from "ethers";
import { NodeTSNClient } from "../../src/client/nodeClient";
import { test } from "vitest";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";

export const TEST_ENDPOINT = "http://localhost:8484";

export const testWithDefaultWallet = createTestContexts({
  default: "0x0000000000000000000000000000000000000000100000000100000000000001",
});

export interface WalletContext {
  wallet: ethers.Wallet;
  client: NodeTSNClient;
}

type Fixtures<T extends Record<string, any>> = Parameters<
  typeof test.extend<T>
>[0];

/**
 * Creates a test context for a specific wallet
 * @param privateKey The private key for the wallet
 * @returns A context containing the wallet and its client
 */
export async function createWalletContext(
  privateKey: string,
): Promise<WalletContext> {
  const wallet = new ethers.Wallet(privateKey);
  const chainId = await NodeTSNClient.getDefaultChainId(TEST_ENDPOINT);

  if (!chainId) throw new Error("Chain id not found");

  const client = new NodeTSNClient({
    endpoint: TEST_ENDPOINT,
    walletProvider: {
      getAddress: () => wallet.address,
      getSigner: () => wallet,
    },
    chainId,
  });

  return { wallet, client };
}

/**
 * Creates a test extension for multiple wallet roles
 * @param roles Map of role names to private keys
 * @returns A test extension with wallet contexts for each role
 */
export function createTestContexts<T extends string>(roles: Record<T, string>) {
  type ContextType = {
    [K in T as `${K}Wallet`]: ethers.Wallet;
  } & {
    [K in T as `${K}Client`]: NodeTSNClient;
  };

  const testExtension = {} as Fixtures<ContextType>;

  // Create wallet and client fixtures for each role
  Object.entries(roles).forEach(([role, privateKey]) => {
    // Add wallet fixture
    testExtension[`${role}Wallet` as keyof ContextType] = async (
      {},
      use: any,
    ) => {
      const { wallet } = await createWalletContext(privateKey as string);
      await use(wallet);
    };

    // Add client fixture
    testExtension[`${role}Client` as keyof ContextType] = async (
      { [`${role}Wallet` as keyof ContextType]: wallet },
      use: any,
    ) => {
      const { client } = await createWalletContext(privateKey as string);
      await use(client);
    };
  });

  return test.extend<ContextType>(testExtension);
}

export async function waitForTxSuccess(
  tx: GenericResponse<TxReceipt>,
  client: NodeTSNClient,
) {
  if (!tx.data?.tx_hash) {
    throw new Error("Tx hash not found");
  }
  return client.waitForTx(tx.data.tx_hash);
}
