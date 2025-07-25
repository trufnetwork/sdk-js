import { Client, KwilSigner, NodeKwil, WebKwil } from "@trufnetwork/kwil-js";
import { KwilConfig } from "@trufnetwork/kwil-js/dist/api_client/config";
import { Kwil } from "@trufnetwork/kwil-js/dist/client/kwil";
import { EthSigner } from "@trufnetwork/kwil-js/dist/core/signature";
import { EnvironmentType } from "@trufnetwork/kwil-js/dist/core/enums";
import { GenericResponse } from "@trufnetwork/kwil-js/dist/core/resreq";
import { TxReceipt } from "@trufnetwork/kwil-js/dist/core/tx";
import { TxInfoReceipt } from "@trufnetwork/kwil-js/dist/core/txQuery";
import { ComposedAction } from "../contracts-api/composedAction";
import { deployStream } from "../contracts-api/deployStream";
import { deleteStream } from "../contracts-api/deleteStream";
import { PrimitiveAction } from "../contracts-api/primitiveAction";
import { Action } from "../contracts-api/action";
import { StreamType } from "../contracts-api/contractValues";
import { StreamLocator, TNStream } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { listStreams } from "./listStreams";
import { getLastTransactions } from "./getLastTransactions";
import { RoleManagement } from "../contracts-api/roleManagement";
import { OwnerIdentifier } from "../types/role";

export interface SignerInfo {
  // we need to have the address upfront to create the KwilSigner, instead of relying on the signer to return it asynchronously
  address: string;
  signer: EthSigner;
}

export type TNClientOptions = {
  endpoint: string;
  signerInfo: SignerInfo;
} & Omit<KwilConfig, "kwilProvider">;

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
  protected kwilClient: Kwil<T> | undefined;
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
  async waitForTx(txHash: string, timeout = 12000): Promise<TxInfoReceipt> {
    return new Promise<TxInfoReceipt>(async (resolve, reject) => {
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
  getKwilClient(): Kwil<EnvironmentType> {
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
  ): Promise<GenericResponse<TxReceipt>> {
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
  ): Promise<GenericResponse<TxReceipt>> {
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
