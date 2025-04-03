import { Client, KwilSigner, NodeKwil, WebKwil } from "@kwilteam/kwil-js";
import { KwilConfig } from "@kwilteam/kwil-js/dist/api_client/config";
import { Kwil } from "@kwilteam/kwil-js/dist/client/kwil";
import { EthSigner } from "@kwilteam/kwil-js/dist/core/signature";
import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { TxInfoReceipt } from "@kwilteam/kwil-js/dist/core/txQuery";
import { ComposedStream } from "../contracts-api/composedStream";
import { deployStream } from "../contracts-api/deployStream";
import { deleteStream } from "../contracts-api/deleteStream";
import { PrimitiveStream } from "../contracts-api/primitiveStream";
import { Stream } from "../contracts-api/stream";
import { StreamType } from "../contracts-api/contractValues";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { listAllStreams } from "./listAllStreams";

export interface SignerInfo {
  // we need to have the address upfront to create the KwilSigner, instead of relying on the signer to return it asynchronously
  address: string;
  signer: EthSigner;
}

export type TNClientOptions = {
  endpoint: string;
  signerInfo: SignerInfo;
} & Omit<KwilConfig, "kwilProvider">;

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
  loadStream(): Stream {
    return new Stream(
      this.getKwilClient() as WebKwil | NodeKwil,
      this.getKwilSigner(),
    );
  }

  /**
   * Loads a primitive stream.
   * @returns An instance of IPrimitiveStream.
   */
  loadPrimitiveStream(): PrimitiveStream {
    return PrimitiveStream.fromStream(this.loadStream());
  }

  /**
   * Loads a composed stream.
   * @returns An instance of IComposedStream.
   */
  loadComposedStream(): ComposedStream {
    return ComposedStream.fromStream(this.loadStream());
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
   * @param owner - The owner of the streams. If not provided, all streams will be returned.
   * @returns A promise that resolves to a list of stream locators.
   */
  async getAllStreams(owner?: EthereumAddress): Promise<StreamLocator[]> {
    return listAllStreams(this.getKwilClient(), owner);
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
}
