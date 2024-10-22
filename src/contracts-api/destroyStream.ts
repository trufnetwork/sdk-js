import { StreamId } from "../util/StreamId.js";
import { Kwil } from "@kwilteam/kwil-js/dist/client/kwil.js";
import { KwilSigner } from "@kwilteam/kwil-js";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx.js";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq.js";
import { generateDBID } from "@kwilteam/kwil-js/dist/utils/dbid.js";

/**
 * Input parameters for destroying a stream.
 */
export interface DestroyStreamInput {
  streamId: StreamId;
  kwilClient: Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
}

/**
 * Output after destroying a stream.
 */
export interface DestroyStreamOutput {
  receipt: TxReceipt;
}

/**
 * Destroys a stream from TSN.
 * @param input - The input parameters for destroying the stream.
 * @returns The transaction receipt of the destruction.
 */
export async function destroyStream(input: DestroyStreamInput): Promise<GenericResponse<TxReceipt>> {
    const dbid = generateDBID(input.kwilSigner.identifier, input.streamId.getId());
  try {
    const txReceipt = await input.kwilClient.drop({
        dbid
    },
      input.kwilSigner,
      input.synchronous
    );

    return txReceipt;
  } catch (error) {
    throw new Error(`Failed to destroy stream: ${error}`);
  }
}

