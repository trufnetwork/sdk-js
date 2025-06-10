import {TNStream} from "../types/stream";
import {EthereumAddress} from "../util/EthereumAddress";
import {StreamId} from "../util/StreamId";
import {Database} from "@kwilteam/kwil-js/dist/core/database";
import {ListStreamsInput} from "./client";
import {KwilSigner, NodeKwil, WebKwil} from "@kwilteam/kwil-js";

/**
 * List all streams from the TN network.
 * @param kwilClient - The Kwil client.
 * @param kwilSigner - The Kwil signer.
 * @param input - The input parameters for listing streams.
 * @returns A list of stream locators.
 */
export async function listStreams(
  kwilClient: WebKwil | NodeKwil,
  kwilSigner: KwilSigner,
  input: ListStreamsInput
): Promise<TNStream[]> {
    const result = await kwilClient.call({
        inputs: {
            $data_provider: input.dataProvider,
            $limit: input.limit,
            $offset: input.offset,
            $order_by: input.orderBy,
            $block_height: input.blockHeight,
        },
        name: "list_streams",
        namespace: "main",
    }, kwilSigner);

    return await Promise.all(
        (result.data?.result as {
            data_provider: string;
            stream_id: string;
            stream_type: string;
            created_at: number;
        }[]).map(async (database) => ({
            streamId: await StreamId.generate(database.stream_id),
            dataProvider: new EthereumAddress(database.data_provider),
            streamType: database.stream_type,
            createdAt: database.created_at
        }))
    );
}