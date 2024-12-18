import { Kwil } from "@kwilteam/kwil-js/dist/client/kwil";
import { EnvironmentType } from "@kwilteam/kwil-js/dist/core/enums";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { Database } from "@kwilteam/kwil-js/dist/core/database";

/**
 * List all streams from the TN network.
 * @param kwilClient - The Kwil client.
 * @param owner - The owner of the streams. If not provided, all streams will be returned.
 * @returns A list of stream locators.
 */
export async function listAllStreams(
  kwilClient: Kwil<EnvironmentType>,
  owner?: EthereumAddress,
): Promise<StreamLocator[]> {
  const databases = await kwilClient.listDatabases(owner?.getAddress());
  const schemas = await Promise.all(
    databases.data?.map(async (database) => {
      const schema = await kwilClient.getSchema(database.dbid);
      if (schema.status === 200 && schema.data && isStream(schema.data)) {
        return schema.data;
      }
      return undefined;
    }) ?? [],
  );
  return schemas
    .filter((schema) => schema !== undefined)
    .map((schema) => ({
      streamId: StreamId.fromString(schema.name).throw(),
      dataProvider: EthereumAddress.fromBytes(schema.owner).throw(),
    }));
}

export const isStream = (schema: Database) => {
  const requiredProcedures = ["get_index", "get_record", "get_metadata"];
  return requiredProcedures.every((procedure) =>
    schema.procedures.some((p) => p.name === procedure),
  );
};
