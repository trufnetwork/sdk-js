import {StreamType} from "./contractValues";
import {KwilSigner, Types} from "@trufnetwork/kwil-js";
import {StreamId} from "../util/StreamId";

export interface DeployStreamInput {
  streamId: StreamId;
  streamType: StreamType;
  kwilClient: Types.Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
  /**
   * Toggles per-stream persistence of value=0 inserts. Default false
   * preserves the historical behavior — zeros are dropped on insert.
   * Set true for streams where zero is a meaningful measurement.
   */
  allowZeros?: boolean;
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
      // Omit $allow_zeros from the named-parameter map when the caller
      // didn't opt in. Pre-feature nodes don't know about $allow_zeros,
      // so always sending it (even as `false`) risks rejection on
      // older deployments. The action's DEFAULT FALSE preserves today's
      // behavior when the parameter is absent.
      const inputs = input.allowZeros === true
        ? {
            $stream_id: input.streamId.getId(),
            $stream_type: input.streamType,
            $allow_zeros: true,
          }
        : {
            $stream_id: input.streamId.getId(),
            $stream_type: input.streamType,
          };

      const txHash = await input.kwilClient.execute(
        {
            namespace: "main",
            inputs: [inputs],
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
