import {Client, KwilSigner, NodeKwil, WebKwil} from "@kwilteam/kwil-js";
import {KwilConfig} from "@kwilteam/kwil-js/dist/api_client/config";
import {Kwil} from "@kwilteam/kwil-js/dist/client/kwil";
import {EthSigner} from "@kwilteam/kwil-js/dist/core/builders";
import {EnvironmentType} from "@kwilteam/kwil-js/dist/core/enums";
import {GenericResponse} from "@kwilteam/kwil-js/dist/core/resreq";
import {TxReceipt} from "@kwilteam/kwil-js/dist/core/tx";
import {TxInfoReceipt} from "@kwilteam/kwil-js/dist/core/txQuery";
import {Client as IClient} from "../types/client";
import {StreamType} from "../types/contractValues";
import {IStream, StreamLocator} from "../types/stream";
import {EthereumAddress} from "../util/EthereumAddress";
import {StreamId} from "../util/StreamId";
import {IPrimitiveStream} from "../types/primitiveStream";
import {IComposedStream} from "../types/composedStream";
import {deployStream} from "../contracts-api/deployStream";
import {destroyStream} from "../contracts-api/destroyStream";
import {listAllStreams} from "./listAllStreams";
import {Stream} from "../contracts-api/stream";

export interface EthProvider {
  getAddress(): string;
  getSigner(): EthSigner;
}

type TSNClientOptions = {
  endpoint: string;
  walletProvider: EthProvider;
} & Omit<KwilConfig, "kwilProvider">;

export abstract class TSNClient<T extends EnvironmentType> implements IClient {
  protected kwilClient: Kwil<T> | undefined;
  protected ethProvider: EthProvider;
  protected constructor(options: TSNClientOptions) {
    this.ethProvider = options.walletProvider;
  }

  async waitForTx(txHash: string, timeout = 12000): Promise<TxInfoReceipt> {
    return new Promise<TxInfoReceipt>(async (resolve, reject) => {
      const interval = setInterval(async () => {
        const receipt = await this.getKwilClient()["txInfoClient"](txHash).catch(() => ({data: undefined, status: undefined}));
        switch (receipt.status) {
          case 200:
            if (receipt.data?.tx_result.log === 'success') {
              resolve(receipt.data);
            } else {
              reject(new Error(`Transaction failed: status ${receipt.status} : log message ${receipt.data?.tx_result.log}`));
            }
            break;
          case undefined:
            break;
          default:
            reject(new Error(`Transaction failed: status ${receipt.status} : log message ${receipt.data?.tx_result.log}`));
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Transaction failed: Timeout"));
      }, timeout);
    });
  }

  getKwilSigner(): KwilSigner {
    return new KwilSigner(this.ethProvider.getSigner(), this.address().getAddress());
  }

  getKwilClient(): Kwil<EnvironmentType> {
    if (!this.kwilClient) {
      throw new Error("Kwil client not initialized");
    }
    return this.kwilClient;
  }

  async deployStream(
    streamId: StreamId,
    streamType: StreamType,
    synchronous?: boolean
  ): Promise<GenericResponse<TxReceipt>> {
    return await deployStream({
      streamId,
      streamType,
      synchronous,
      kwilClient: this.getKwilClient(),
      kwilSigner: this.getKwilSigner(),
    });
  }

  async destroyStream(streamId: StreamId, synchronous?: boolean): Promise<GenericResponse<TxReceipt>> {
    return await destroyStream({
      streamId,
      synchronous,
      kwilClient: this.getKwilClient(),
      kwilSigner: this.getKwilSigner(),
    });
  }

  async loadStream(stream: StreamLocator): Promise<IStream> {
    return new Stream(this.getKwilClient() as WebKwil | NodeKwil, this.getKwilSigner(), stream);
  }

  async loadPrimitiveStream(stream: StreamLocator): Promise<IPrimitiveStream> {
    throw new Error("Method not implemented.");
  }

  async loadComposedStream(stream: StreamLocator): Promise<IComposedStream> {
    throw new Error("Method not implemented.");
  }

  ownStreamLocator(streamId: StreamId): StreamLocator {
    return {
      streamId,
      dataProvider: this.address(),
    };
  }

  address(): EthereumAddress {
    return new EthereumAddress(this.ethProvider.getAddress());
  }

  /**
   * Get all streams from the TSN network.
   * @param owner - The owner of the streams. If not provided, all streams will be returned.
   * @returns A list of stream locators.
   */
  async getAllStreams(owner?: EthereumAddress): Promise<StreamLocator[]> {
    return listAllStreams(this.getKwilClient(), owner);
  }

  /**
   * Get the default chain id for a provider. Use with caution, as this decreases the security of the TSN.
   * @param provider - The provider url.
   * @returns The chain id.
   */
  public static async getDefaultChainId(provider: string) {
    const kwilClient = new Client({
      kwilProvider: provider,
    });
    const chainInfo = await kwilClient["chainInfoClient"]();
    return chainInfo.data?.chain_id;
  }
}

export class BrowserTSNClient extends TSNClient<EnvironmentType.BROWSER> {
  constructor(options: TSNClientOptions) {
    super(options);
    this.kwilClient = new WebKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }
}

export class NodeTSNClient extends TSNClient<EnvironmentType.NODE> {
  constructor(options: TSNClientOptions) {
    super(options);
    this.kwilClient = new NodeKwil({
      ...options,
      kwilProvider: options.endpoint,
    });
  }
}


