import { StreamId } from "../util/StreamId";
import { EthereumAddress } from "../util/EthereumAddress";

export interface StreamLocator {
  /**
   * the unique identifier of the stream, used as name of the deployed contract
   */
  streamId: StreamId;
  /**
   * the address of the data provider, it's the deployer of the stream
   */
  dataProvider: EthereumAddress;
}

export interface TNStream {
  streamId: StreamId;
  dataProvider: EthereumAddress;
  streamType: string;
  createdAt: number;
}
