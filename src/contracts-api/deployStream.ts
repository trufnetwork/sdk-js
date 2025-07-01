import {StreamType} from "./contractValues";
import {TxReceipt} from "@trufnetwork/kwil-js/dist/core/tx";
import {Kwil} from "@trufnetwork/kwil-js/dist/client/kwil";
import {KwilSigner} from "@trufnetwork/kwil-js";
import {GenericResponse} from "@trufnetwork/kwil-js/dist/core/resreq";
import {StreamId} from "../util/StreamId";
import pg from "pg";
const { Pool } = pg;

export interface DeployStreamInput {
  streamId: StreamId;
  streamType: StreamType;
  kwilClient: Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
}

export interface DeployStreamOutput {
  receipt: TxReceipt;
}

/**
 * Deploys a stream to TN.
 * @param input - The input parameters for deploying the stream.
 * @returns The transaction hash of the deployment.
 */
export async function deployStream(
  input: DeployStreamInput,
): Promise<GenericResponse<TxReceipt>> {
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