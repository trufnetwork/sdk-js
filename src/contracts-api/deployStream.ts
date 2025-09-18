import {StreamType} from "./contractValues";
import {KwilSigner, Types} from "@trufnetwork/kwil-js";
import {StreamId} from "../util/StreamId";

export interface DeployStreamInput {
  streamId: StreamId;
  streamType: StreamType;
  kwilClient: Types.Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
}

export interface DeployStreamOutput {
  receipt: Types.TxReceipt;
}

/**
 * Deploys a stream to TN.
 * @param input - The input parameters for deploying the stream.
 * @returns The transaction hash of the deployment.
 */
export async function deployStream(
  input: DeployStreamInput,
): Promise<Types.GenericResponse<Types.TxReceipt>> {
  try {
      const txHash = await input.kwilClient.execute(
        {
            namespace: "main",
            inputs: [{
                $stream_id: input.streamId.getId(),
                $stream_type: input.streamType,
            }],
            name: "create_stream",
            description: `TN SDK - Deploying ${input.streamType} stream: ${input.streamId.getId()}`
        },
        input.kwilSigner,
        input.synchronous,
    );

    return txHash;
  } catch (error) {
    throw new Error(`Failed to deploy stream: ${error}`);
  }
}