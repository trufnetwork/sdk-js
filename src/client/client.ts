import { Client, KwilSigner, NodeKwil, WebKwil, Types, EnvironmentType } from "@trufnetwork/kwil-js";
import { ComposedAction, ListTaxonomiesByHeightParams, GetTaxonomiesForStreamsParams, TaxonomyQueryResult } from "../contracts-api/composedAction";
import { deployStream } from "../contracts-api/deployStream";
import { deleteStream } from "../contracts-api/deleteStream";
import { PrimitiveAction } from "../contracts-api/primitiveAction";
import { Action, ListMetadataByHeightParams, MetadataQueryResult } from "../contracts-api/action";
import { StreamType } from "../contracts-api/contractValues";
import { WithdrawalProof } from "../types/bridge";
import { StreamLocator, TNStream } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { listStreams } from "./listStreams";
import { getLastTransactions } from "./getLastTransactions";
import { RoleManagement } from "../contracts-api/roleManagement";
import { AttestationAction } from "../contracts-api/attestationAction";
import { TransactionAction } from "../contracts-api/transactionAction";
import { OwnerIdentifier } from "../types/role";

export interface SignerInfo {
  // we need to have the address upfront to create the KwilSigner, instead of relying on the signer to return it asynchronously
  address: string;
  signer: Types.EthSigner;
}

export type TNClientOptions = {
  endpoint: string;
  signerInfo: SignerInfo;
} & Omit<Types.KwilConfig, "kwilProvider">;

export interface ListStreamsInput {
    dataProvider?: string;
    limit?: number;
    offset?: number;
    orderBy?: string;
    blockHeight?: number;
}

/**
 * @param dataProvider optional address; when omitted or null, returns for all providers
 * @param limitSize max rows to return (default 6, max 100)
 */
export interface GetLastTransactionsInput {
  dataProvider?: string;
  limitSize?: number;
}

export abstract class BaseTNClient<T extends EnvironmentType> {
  protected kwilClient: Types.Kwil<T> | undefined;
  protected signerInfo: SignerInfo;

  protected constructor(options: TNClientOptions) {
    this.signerInfo = options.signerInfo;
  }

  /**
   * Waits for a transaction to be mined by TN.
   * @param txHash - The transaction hash to wait for.
   * @param timeout - The timeout in milliseconds.
   * @returns A promise that resolves to the transaction info receipt.
   */
  async waitForTx(txHash: string, timeout = 12000): Promise<Types.TxInfoReceipt> {
    return new Promise<Types.TxInfoReceipt>(async (resolve, reject) => {
      const interval = setInterval(async () => {
        const receipt = await this.getKwilClient()
          ["txInfoClient"](txHash)
          .catch(() => ({ data: undefined, status: undefined }));
        switch (receipt.status) {
          case 200:
            if (receipt.data?.tx_result?.log !== undefined && receipt.data?.tx_result?.log.includes("ERROR")) {
              reject(
                  new Error(
                      `Transaction failed: status ${receipt.status} : log message ${receipt.data?.tx_result.log}`,
                  ))
            } else {
              resolve(receipt.data!);
            }
            break;
          case undefined:
            break;
          default:
            reject(
              new Error(
                `Transaction failed: status ${receipt.status} : log message ${receipt.data?.tx_result.log}`,
              ),
            );
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Transaction failed: Timeout"));
      }, timeout);
    });
  }

  /**
   * Returns the Kwil signer used by the client.
   * @returns An instance of KwilSigner.
   */
  getKwilSigner(): KwilSigner {
    return new KwilSigner(
      this.signerInfo.signer,
      this.address().getAddress(),
    );
  }

  /**
   * Returns the Kwil client used by the client.
   * @returns An instance of Kwil.
   * @throws If the Kwil client is not initialized.
   */
  getKwilClient(): Types.Kwil<EnvironmentType> {
    if (!this.kwilClient) {
      throw new Error("Kwil client not initialized");
    }
    return this.kwilClient;
  }

  /**
   * Deploys a new stream.
   * @param streamId - The ID of the stream to deploy.
   * @param streamType - The type of the stream.
   * @param synchronous - Whether the deployment should be synchronous.
   * @param contractVersion
   * @returns A promise that resolves to a generic response containing the transaction receipt.
   */
  async deployStream(
    streamId: StreamId,
    streamType: StreamType,
    synchronous?: boolean,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return await deployStream({
      streamId,
      streamType,
      synchronous,
      kwilClient: this.getKwilClient(),
      kwilSigner: this.getKwilSigner(),
    });
  }

  /**
   * Destroys a stream.
   * @param stream - The StreamLocator of the stream to destroy.
   * @param synchronous - Whether the destruction should be synchronous.
   * @returns A promise that resolves to a generic response containing the transaction receipt.
   */
  async destroyStream(
    stream: StreamLocator,
    synchronous?: boolean,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return await deleteStream({
      stream,
      synchronous,
      kwilClient: this.getKwilClient(),
      kwilSigner: this.getKwilSigner(),
    });
  }

  /**
   * Loads an already deployed stream, permitting its API usage.
   * @returns An instance of IStream.
   */
  loadAction(): Action {
    return new Action(
      this.getKwilClient() as WebKwil | NodeKwil,
      this.getKwilSigner(),
    );
  }

  /**
   * Loads a primitive stream.
   * @returns An instance of IPrimitiveStream.
   */
  loadPrimitiveAction(): PrimitiveAction {
    return PrimitiveAction.fromStream(this.loadAction());
  }

  /**
   * Loads a composed stream.
   * @returns An instance of IComposedStream.
   */
  loadComposedAction(): ComposedAction {
    return ComposedAction.fromStream(this.loadAction());
  }

  /**
   * Loads the role management contract API, permitting its RBAC usage.
   */
  loadRoleManagementAction(): RoleManagement {
    return RoleManagement.fromClient(
        this.getKwilClient() as WebKwil | NodeKwil,
        this.getKwilSigner(),
    );
  }

  /**
   * Loads the attestation action API, permitting attestation operations.
   * @returns An instance of AttestationAction.
   */
  loadAttestationAction(): AttestationAction {
    return new AttestationAction(
      this.getKwilClient() as WebKwil | NodeKwil,
      this.getKwilSigner(),
    );
  }

  /**
   * Loads the transaction action API, permitting transaction ledger queries.
   * @returns An instance of TransactionAction.
   */
  loadTransactionAction(): TransactionAction {
    return new TransactionAction(
      this.getKwilClient() as WebKwil | NodeKwil,
      this.getKwilSigner(),
    );
  }

  /**
   * Creates a new stream locator.
   * @param streamId - The ID of the stream.
   * @returns A StreamLocator object.
   */
  ownStreamLocator(streamId: StreamId): StreamLocator {
    return {
      streamId,
      dataProvider: this.address(),
    };
  }

  /**
   * Returns the address of the signer used by the client.
   * @returns An instance of EthereumAddress.
   */
  address(): EthereumAddress {
    return new EthereumAddress(this.signerInfo.address);
  }

  /**
   * Returns all streams from the TN network.
   * @param input - The input parameters for listing streams.
   * @returns A promise that resolves to a list of stream locators.
   */
  async getListStreams(input: ListStreamsInput): Promise<TNStream[]> {
    return listStreams(this.getKwilClient() as WebKwil | NodeKwil,this.getKwilSigner(),input);
  }

    /**
     * Returns the last write activity across streams.
     * @param input - The input parameters for getting last transactions.
     * @returns A promise that resolves to a list of last transactions.
     */
    async getLastTransactions(input: GetLastTransactionsInput): Promise<any[]> {
        return getLastTransactions(this.getKwilClient() as WebKwil | NodeKwil,this.getKwilSigner(),input);
    }

  /**
   * Lists taxonomies by height range for incremental synchronization.
   * High-level wrapper for ComposedAction.listTaxonomiesByHeight()
   * 
   * @param params Height range and pagination parameters  
   * @returns Promise resolving to taxonomy query results
   * 
   * @example
   * ```typescript
   * const taxonomies = await client.listTaxonomiesByHeight({
   *   fromHeight: 1000,
   *   toHeight: 2000,
   *   limit: 100,
   *   latestOnly: true
   * });
   * ```
   */
  async listTaxonomiesByHeight(params: ListTaxonomiesByHeightParams = {}): Promise<TaxonomyQueryResult[]> {
    const composedAction = this.loadComposedAction();
    return composedAction.listTaxonomiesByHeight(params);
  }

  async listMetadataByHeight(params: ListMetadataByHeightParams = {}): Promise<MetadataQueryResult[]> {
    const action = this.loadAction();
    return action.listMetadataByHeight(params);
  }

  /**
   * Gets the wallet balance for a specific bridge instance
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt", "ethereum")
   * @param walletAddress The wallet address to check balance for
   * @returns Promise that resolves to the balance as a string (in wei)
   */
  async getWalletBalance(bridgeIdentifier: string, walletAddress: string) {
    const action = this.loadAction();
    return action.getWalletBalance(bridgeIdentifier, walletAddress);
  }

  /**
   * Performs a withdrawal operation by bridging tokens from TN to a destination chain
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt")
   * @param amount The amount to withdraw (in wei)
   * @param recipient The recipient address on the destination chain
   * @returns Promise that resolves to the transaction hash, or throws on error
   */
  async withdraw(bridgeIdentifier: string, amount: string, recipient: string): Promise<string> {
    const action = this.loadAction();

    // Bridge tokens in a single operation
    const bridgeResult = await action.bridgeTokens(bridgeIdentifier, amount, recipient);
    if (!bridgeResult.data?.tx_hash) {
      throw new Error("Bridge tokens operation failed: no transaction hash returned");
    }

    // Wait for bridge transaction to be mined - let waitForTx errors bubble up
    try {
      await this.waitForTx(bridgeResult.data.tx_hash);
    } catch (error) {
      throw new Error(`Bridge tokens transaction failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Return the transaction hash
    return bridgeResult.data.tx_hash;
  }

  /**
   * Lists wallet rewards for a specific bridge instance
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt")
   * @param wallet The wallet address to list rewards for
   * @param withPending Whether to include pending rewards
   * @returns Promise that resolves to an array of rewards data
   * @deprecated This method uses the extension namespace directly. Most users should use getWithdrawalProof instead.
   */
  async listWalletRewards(bridgeIdentifier: string, wallet: string, withPending: boolean): Promise<any[]> {
    const action = this.loadAction();
    return action.listWalletRewards(bridgeIdentifier, wallet, withPending);
  }

  /**
   * Gets withdrawal proof for a specific bridge instance
   * Returns merkle proofs and validator signatures needed for claiming withdrawals on the destination chain
   *
   * This method is used for non-custodial bridge withdrawals where users need to
   * manually claim their withdrawals by submitting proofs to the destination chain contract.
   * The proof includes validator signatures, merkle root, block hash, and amount.
   *
   * @param bridgeIdentifier The bridge instance identifier (e.g., "hoodi_tt", "sepolia", "ethereum")
   * @param walletAddress The wallet address to get withdrawal proof for
   * @returns Promise that resolves to an array of withdrawal proof data (empty array if no unclaimed withdrawals)
   *
   * @example
   * ```typescript
   * // Get withdrawal proofs for Hoodi Test Token bridge
   * const proofs = await client.getWithdrawalProof("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
   *
   * // Proofs will be an array like:
   * // [{
   * //   chain: "hoodi",
   * //   chain_id: "3639",
   * //   contract: "0x878D6aaeB6e746033f50B8dC268d54B4631554E7",
   * //   created_at: 3080,
   * //   recipient: "0x...",
   * //   amount: "100000000000000000000",
   * //   block_hash: <base64-encoded>,
   * //   root: <base64-encoded>,
   * //   proofs: [],
   * //   signatures: [<base64-encoded-signatures>]
   * // }]
   *
   * // Use the proofs to claim withdrawal on destination chain
   * if (proofs.length > 0) {
   *   const proof = proofs[0];
   *   await bridgeContract.claimWithdrawal(proof.recipient, proof.amount, proof.root, proof.proofs, proof.signatures);
   * }
   * ```
   *
   * @note This method has been tested via integration tests in the node repository.
   * See: https://github.com/trufnetwork/kwil-db/blob/main/node/exts/erc20-bridge/erc20/meta_extension_withdrawal_test.go
   */
  async getWithdrawalProof(bridgeIdentifier: string, walletAddress: string): Promise<WithdrawalProof[]> {
    const action = this.loadAction();
    return action.getWithdrawalProof(bridgeIdentifier, walletAddress);
  }

  /**
   * Gets taxonomies for specific streams in batch.
   * High-level wrapper for ComposedAction.getTaxonomiesForStreams()
   * 
   * @param params Stream locators and options
   * @returns Promise resolving to taxonomy query results
   * 
   * @example
   * ```typescript
   * const streams = [
   *   { dataProvider: provider1, streamId: streamId1 },
   *   { dataProvider: provider2, streamId: streamId2 }
   * ];
   * const taxonomies = await client.getTaxonomiesForStreams({
   *   streams,
   *   latestOnly: true
   * });
   * ```
   */
  async getTaxonomiesForStreams(params: GetTaxonomiesForStreamsParams): Promise<TaxonomyQueryResult[]> {
    const composedAction = this.loadComposedAction();
    return composedAction.getTaxonomiesForStreams(params);
  }

  /**
   * Get the default chain id for a provider. Use with caution, as this decreases the security of the TN.
   * @param provider - The provider URL.
   * @returns A promise that resolves to the chain ID.
   */
  public static async getDefaultChainId(provider: string) {
    const kwilClient = new Client({
      kwilProvider: provider,
    });
    const chainInfo = await kwilClient["chainInfoClient"]();
    return chainInfo.data?.chain_id;
  }

  /*
   * High-level role-management helpers. These wrap the lower-level
   * RoleManagement contract calls and expose a simpler API on the
   * TN client.
   */

  /** Grants a role to one or more wallets. */
  async grantRole(input: {
    owner: OwnerIdentifier;
    roleName: string;
    wallets: EthereumAddress | EthereumAddress[];
    synchronous?: boolean;
  }): Promise<string> {
    const rm = this.loadRoleManagementAction();
    const walletsArr: EthereumAddress[] = Array.isArray(input.wallets)
      ? input.wallets
      : [input.wallets];
    const tx = await rm.grantRole(
      {
        owner: input.owner,
        roleName: input.roleName,
        wallets: walletsArr,
      },
      input.synchronous,
    );
    return tx.data?.tx_hash as unknown as string;
  }

  /** Revokes a role from one or more wallets. */
  async revokeRole(input: {
    owner: OwnerIdentifier;
    roleName: string;
    wallets: EthereumAddress | EthereumAddress[];
    synchronous?: boolean;
  }): Promise<string> {
    const rm = this.loadRoleManagementAction();
    const walletsArr: EthereumAddress[] = Array.isArray(input.wallets)
      ? input.wallets
      : [input.wallets];
    const tx = await rm.revokeRole(
      {
        owner: input.owner,
        roleName: input.roleName,
        wallets: walletsArr,
      },
      input.synchronous,
    );
    return tx.data?.tx_hash as unknown as string;
  }

  /**
   * Checks if a wallet is member of a role.
   * Returns true if the wallet is a member.
   */
  async isMemberOf(input: {
    owner: OwnerIdentifier;
    roleName: string;
    wallet: EthereumAddress;
  }): Promise<boolean> {
    const rm = this.loadRoleManagementAction();
    const res = await rm.areMembersOf({
      owner: input.owner,
      roleName: input.roleName,
      wallets: [input.wallet],
    });
    return res.length > 0 && res[0].isMember;
  }

  /**
   * Lists role members – currently unsupported in the
   * smart-contract layer.
   */
  async listRoleMembers(input: {
    owner: OwnerIdentifier;
    roleName: string;
    limit?: number;
    offset?: number;
  }): Promise<import("../types/role").RoleMember[]> {
    const rm = this.loadRoleManagementAction();
    return rm.listRoleMembers({
      owner: input.owner,
      roleName: input.roleName,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
