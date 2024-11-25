import { StreamId } from "../util/StreamId";
import { Kwil } from "@kwilteam/kwil-js/dist/client/kwil";
import { KwilSigner } from "@kwilteam/kwil-js";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { generateDBID } from "@kwilteam/kwil-js/dist/utils/dbid";

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
 * Destroys a stream from TN.
 * @param input - The input parameters for destroying the stream.
 * @returns The transaction receipt of the destruction.
 */
export async function destroyStream(
  input: DestroyStreamInput,
): Promise<GenericResponse<TxReceipt>> {
  const dbid = generateDBID(
    input.kwilSigner.identifier,
    input.streamId.getId(),
  );
  try {
    const txReceipt = await input.kwilClient.drop(
      {
        dbid,
      },
      input.kwilSigner,
      input.synchronous,
    );

    return txReceipt;
  } catch (error) {
    throw new Error(`Failed to destroy stream: ${error}`);
  }
}
