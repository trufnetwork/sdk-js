import {StreamId} from "../util/StreamId";
import {KwilSigner, Types} from "@trufnetwork/kwil-js";
import {StreamLocator} from "../types/stream";

/**
 * Input parameters for destroying a stream.
 */
export interface DestroyStreamInput {
  stream: StreamLocator;
  kwilClient: Types.Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
}

/**
 * Output after deleting a stream.
 */
export interface DeleteStreamOutput {
  receipt: Types.TxReceipt;
}

/**
 * Delete a stream from TN.
 * @param input - The input parameters for destroying the stream.
 * @returns The transaction receipt of the destruction.
 */
export async function deleteStream(
  input: DestroyStreamInput,
): Promise<Types.GenericResponse<Types.TxReceipt>> {
  try {
    return await input.kwilClient.execute({
          description: `TN SDK - Deleting stream: ${input.stream.streamId.getId()} from data provider: ${input.stream.dataProvider.getAddress()}`,
          inputs: [{
              $data_provider: input.stream.dataProvider.getAddress(),
              $stream_id: input.stream.streamId.getId()
          }],
          name: "delete_stream",
          namespace: "main"
        },
        input.kwilSigner,
        input.synchronous,
        )} catch (error) {
    throw new Error(`Failed to delete stream: ${error}`);
  }
}