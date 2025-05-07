import {StreamType} from "./contractValues";
import {TxReceipt} from "@kwilteam/kwil-js/dist/core/tx";
import {Kwil} from "@kwilteam/kwil-js/dist/client/kwil";
import {KwilSigner} from "@kwilteam/kwil-js";
import {GenericResponse} from "@kwilteam/kwil-js/dist/core/resreq";
import {StreamId} from "../util/StreamId";
import pg from "pg";
const { Pool } = pg;

export interface DeployStreamInput {
  streamId: StreamId;
  streamType: StreamType;
  kwilClient: Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
  neonConnectionString?: string;
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

    // Optional: insert into Postgres via neon connection
    if (input.neonConnectionString) {
      console.log("Neon connection detected, attempting to insert into DB...");

      const signer: any = input.kwilSigner.signer;
      const dataProvider = signer.address.toLowerCase().substring(2);

      const pool = new Pool({ connectionString: input.neonConnectionString });
      await pool.query(
          `INSERT INTO streams (data_provider, stream_id, type, stream_name, display_name, categories, owner_wallet, geography, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (data_provider, stream_id) DO NOTHING`,
          [dataProvider, input.streamId.getId(), input.streamType, input.streamId.getName(), input.streamId.getName(), '{External}', dataProvider, 'Global', '{External}'],
      );
      await pool.end();

      console.log("successfully inserted into Explorer DB", input.streamId.getName());
    }

    return txHash
  } catch (error) {
    throw new Error(`Failed to deploy stream: ${error}`);
  }
}