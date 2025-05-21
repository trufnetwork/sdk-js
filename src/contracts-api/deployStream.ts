import { StreamType } from "./contractValues";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { Kwil } from "@kwilteam/kwil-js/dist/client/kwil";
import { CompiledKuneiform } from "@kwilteam/kwil-js/dist/core/payload";
import {
  composedStreamTemplate,
  primitiveStreamTemplate,
  composedStreamTemplateUnix,
  primitiveStreamTemplateUnix
} from "../contracts/contractsContent";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { KwilSigner } from "@kwilteam/kwil-js";
import { StreamId } from "../util/StreamId";
import { isBrowser } from "../util/isBrowser";

export interface DeployStreamInput {
  streamId: StreamId;
  streamType: StreamType;
  kwilClient: Kwil<any>;
  kwilSigner: KwilSigner;
  synchronous?: boolean;
  contractVersion?: number;
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
    const schema = await getContract(input.streamType, input.contractVersion);

    schema.name = input.streamId.getId();

    const txHash = await input.kwilClient.deploy(
      {
        schema,
        description: `TN SDK - Deploying ${input.streamType} stream: ${input.streamId.getId()}`,
      },
      input.kwilSigner,
      input.synchronous,
    );

    // Optional: insert into Postgres via neon connection
    if (input.neonConnectionString && !isBrowser) {
      console.log("Neon connection detected, attempting to insert into DB...");

      const signer: any = input.kwilSigner.signer;
      const dataProvider = signer.address.toLowerCase().substring(2);

      const pgModule = await import("pg");
      const { Pool } = pgModule.default;
      const pool = new Pool({ connectionString: input.neonConnectionString });
      await pool.query(
        `INSERT INTO streams (data_provider, stream_id, type, stream_name, display_name, categories, owner_wallet, geography, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (data_provider, stream_id) DO NOTHING`,
        [dataProvider, input.streamId.getId(), input.streamType, input.streamId.getName(), input.streamId.getName(), '{External}', dataProvider, 'Global', '{External}'],
      );
      await pool.end();

      console.log("successfully inserted into Explorer DB", input.streamId.getName());
    } else if (input.neonConnectionString && isBrowser) {
      console.warn(
        "Database operations are not supported in browser environments. Stream data will not be saved to the database."
      );
    }

    return txHash;
  } catch (error) {
    throw new Error(`Failed to deploy stream: ${error}`);
  }
}

/**
 * Returns the contract content based on the stream type.
 * @param streamType - The type of the stream.
 * @param contractVersion
 * @returns The contract content as a Uint8Array.
 */
async function getContract(streamType: StreamType, contractVersion?: number): Promise<CompiledKuneiform> {
  switch (streamType) {
    case StreamType.Composed:
      return contractVersion === 2 ? composedStreamTemplateUnix : composedStreamTemplate;
    case StreamType.Primitive:
      return contractVersion === 2 ? primitiveStreamTemplateUnix : primitiveStreamTemplate;
    default:
      throw new Error(`Unknown stream type: ${streamType}`);
  }
}
