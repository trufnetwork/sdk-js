import { ethers } from "ethers";
import { NodeTNClient } from "../../src/client/nodeClient";
import { test } from "vitest";
import { Types } from "@trufnetwork/kwil-js";
import { MANAGER_PRIVATE_KEY } from "./trufnetwork.setup";

export const TEST_ENDPOINT = process.env.TEST_ENDPOINT || "http://localhost:8484";

export const testWithDefaultWallet = createTestContexts({
  default: "0x0000000000000000000000000000000000000000100000000100000000000001",
});

export interface WalletContext {
  wallet: ethers.Wallet;
  client: NodeTNClient;
}

type Fixtures<T extends Record<string, any>> = Parameters<
  typeof test.extend<T>
>[0];

/**
 * Creates a test context for a specific wallet.
 *
 * @param privateKey The private key for the wallet.
 * @param autoGrantNetworkWriter When true (default), the helper will ensure the wallet
 *                               has the `system:network_writer` role so it can deploy
 *                               streams.  Set to false for tests that explicitly manage
 *                               role memberships.
 */
export async function createWalletContext(
  privateKey: string,
  autoGrantNetworkWriter = true,
): Promise<WalletContext> {
  const wallet = new ethers.Wallet(privateKey);
  const chainId = await NodeTNClient.getDefaultChainId(TEST_ENDPOINT);

  if (!chainId) throw new Error("Chain id not found");

  const client = new NodeTNClient({
    endpoint: TEST_ENDPOINT,
    signerInfo: {
      address: wallet.address,
      signer: wallet,
    },
    chainId,
    timeout: 60000,
  });

  // Ensure the wallet can deploy streams (requires network_writer role) unless disabled.
  if (autoGrantNetworkWriter) {
    await ensureNetworkWriterRole(client);
  }

  return { wallet, client };
}

/**
 * Options for `createTestContexts`.
 */
interface CreateTestContextOptions {
  /**
   * If true (default), automatically grant the network writer role to every
   * wallet fixture.  Set to false for tests that need precise control over
   * role membership.
   */
  autoGrantNetworkWriter?: boolean;
}

/**
 * Creates a test extension for multiple wallet roles.
 *
 * @param roles   Map of role names to private keys.
 * @param options Optional configuration (e.g., disable auto role grant).
 */
export function createTestContexts<T extends string>(
  roles: Record<T, string>,
  options: CreateTestContextOptions = {},
) {
  type ContextType = {
    [K in T as `${K}Wallet`]: ethers.Wallet;
  } & {
    [K in T as `${K}Client`]: NodeTNClient;
  };

  const testExtension = {} as Fixtures<ContextType>;

  const autoGrant = options.autoGrantNetworkWriter ?? true;

  // Create wallet and client fixtures for each role
  Object.entries(roles).forEach(([role, privateKey]) => {
    // Add wallet fixture
    testExtension[`${role}Wallet` as keyof ContextType] = async (
      {},
      use: any,
    ) => {
      const { wallet } = await createWalletContext(privateKey as string, autoGrant);
      await use(wallet);
    };

    // Add client fixture
    testExtension[`${role}Client` as keyof ContextType] = async (
      { [`${role}Wallet` as keyof ContextType]: wallet },
      use: any,
    ) => {
      const { client } = await createWalletContext(privateKey as string, autoGrant);
      await use(client);
    };
  });

  return test.extend<ContextType>(testExtension);
}

export async function waitForTxSuccess(
  tx: Types.GenericResponse<Types.TxReceipt>,
  client: NodeTNClient,
): Promise<Types.TxInfoReceipt> {
  if (!tx.data?.tx_hash) {
    throw new Error("Tx hash not found");
  }
  return client.waitForTx(tx.data.tx_hash);
}

/**
 * Ensures the provided client wallet is a member of the `system:network_writer` role.
 * If the wallet is not yet a member, the role is granted using the manager wallet.
 *
 * This is required now that stream deployment is restricted to network writers.
 */
export async function ensureNetworkWriterRole(client: NodeTNClient): Promise<void> {
  // First, check if the wallet is already in the role.
  const alreadyMember = await client.isMemberOf({
    owner: "system",
    roleName: "network_writer",
    wallet: client.address(),
  });

  if (alreadyMember) return; // Nothing to do.

  // Build a manager client (the manager wallet is provisioned during migrations).
  const managerWallet = new ethers.Wallet(MANAGER_PRIVATE_KEY);
  const chainId = await NodeTNClient.getDefaultChainId(TEST_ENDPOINT);
  if (!chainId) {
    throw new Error("Chain id not found");
  }

  const managerClient = new NodeTNClient({
    endpoint: TEST_ENDPOINT,
    signerInfo: {
      address: managerWallet.address,
      signer: managerWallet,
    },
    chainId,
    timeout: 60000,
  });

  // Grant the role and wait for confirmation.
  const txHash = await managerClient.grantRole({
    owner: "system",
    roleName: "network_writer",
    wallets: client.address(),
  });

  await managerClient.waitForTx(txHash);
}

/**
 * Normalizes a transaction ID to lowercase with 0x prefix
 * @param txId Transaction ID with or without 0x prefix
 * @returns Normalized transaction ID (lowercase with 0x prefix)
 */
export function normalizeTransactionId(txId: string): string {
  return txId.startsWith("0x") ? txId.toLowerCase() : `0x${txId.toLowerCase()}`;
}

// Re-export the TrufNetwork setup helper so tests can opt-in as needed.
export { setupTrufNetwork } from "./trufnetwork.setup";
