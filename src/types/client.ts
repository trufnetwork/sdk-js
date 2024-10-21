import type { Kwil } from '@kwilteam/kwil-js/dist/client/kwil';
import { EnvironmentType } from '@kwilteam/kwil-js/dist/core/enums';
import { GenericResponse } from '@kwilteam/kwil-js/dist/core/resreq';
import { TxReceipt } from '@kwilteam/kwil-js/dist/core/tx';
import { TxInfoReceipt } from '@kwilteam/kwil-js/dist/core/txQuery';
import { EthereumAddress } from '../util/types';
import { IComposedStream } from "./composedStream";
import { StreamType } from "./contractValues";
import { IPrimitiveStream } from "./primitiveStream";
import { IStream, StreamLocator } from "./stream";

export interface Client {
    /**
     * waits for a transaction to be mined by TSN
     */
    waitForTx(txHash: string, interval: number): Promise<TxInfoReceipt>;
    /**
     * returns the kwil client used by the client
     */
    getKwilClient(): Kwil<EnvironmentType>;
    /**
     * deploys a new stream
     */
    deployStream(streamId: string, streamType: StreamType): Promise<GenericResponse<TxReceipt>>;
    /**
     * destroys a stream
     */
    destroyStream(streamId: string): Promise<GenericResponse<TxReceipt>>;
    /**
     * loads a already deployed stream, permitting its API usage
     */
    loadStream(stream: StreamLocator): Promise<IStream>;
    loadPrimitiveStream(stream: StreamLocator): Promise<IPrimitiveStream>;
    loadComposedStream(stream: StreamLocator): Promise<IComposedStream>;
    /**
     * creates a new stream locator
     */
    ownStreamLocator(streamId: string): StreamLocator;
    /**
     * returns the address of the signer used by the client
     */
    address(): EthereumAddress;
    /**
     * returns all streams from the TSN network
     */
    getAllStreams(): Promise<StreamLocator[]>;
}
