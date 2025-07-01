import {KwilSigner, NodeKwil, Utils, WebKwil} from "@trufnetwork/kwil-js";
import { GenericResponse } from "@trufnetwork/kwil-js/dist/core/resreq";
import { TxReceipt } from "@trufnetwork/kwil-js/dist/core/tx";
import { DateString } from "../types/other";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { Action } from "./action";
import DataType = Utils.DataType;

export const ErrorStreamNotComposed = "stream is not a composed stream";

export interface TaxonomySet {
  stream: StreamLocator;
  taxonomyItems: TaxonomyItem[];
  startDate: number;
}

export interface TaxonomyItem {
  childStream: StreamLocator;
  weight: string;
}

export interface DescribeTaxonomiesParams {
  stream: StreamLocator;
  /**
   * if true, will return the latest version of the taxonomy only
   */
  latestGroupSequence: boolean;
}

export class ComposedAction extends Action {
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ) {
    super(kwilClient, kwilSigner);
  }

  /**
   * Returns the taxonomy of the stream
   * @param params Parameters for describing taxonomies
   * @returns A promise that resolves to the taxonomy
   */
  public async describeTaxonomies(
    params: DescribeTaxonomiesParams,
  ): Promise<TaxonomySet[]> {
    type TaxonomyResult = {
      data_provider: string;
      stream_id: string;
      child_data_provider: string;
      child_stream_id: string;
      weight: string;
      created_at: number;
      group_sequence: number;
      start_date: number;
    }[];

    const result = await this.call<TaxonomyResult>(
        "describe_taxonomies",
        {
            $data_provider: params.stream.dataProvider.getAddress(),
            $stream_id: params.stream.streamId.getId(),
            $latest_group_sequence: params.latestGroupSequence,
        },
    );



    return result
      .mapRight((records) => {
        const taxonomyItems: Map<DateString, TaxonomyItem[]> = records.reduce(
          (acc, record) => {
            const currentArray = acc.get(record.start_date.toString()) || [];
            currentArray.push({
              childStream: {
                streamId: StreamId.fromString(record.child_stream_id).throw(),
                dataProvider: EthereumAddress.fromString(
                  record.child_data_provider,
                ).throw(),
              },
              weight: record.weight,
            });
            acc.set(record.start_date.toString(), currentArray);
            return acc;
          },
          new Map<DateString, TaxonomyItem[]>(),
        );

        return Array.from(taxonomyItems.entries()).map(
          ([startDate, taxonomyItems]) => ({
            stream: {
              streamId: StreamId.fromString(records[0].stream_id).throw(),
              dataProvider: EthereumAddress.fromString(
                records[0].data_provider,
              ).throw(),
            },
            taxonomyItems,
            startDate: Number(startDate)
          }),
        );
      })
      .throw();
  }

  /**
   * Sets the taxonomy of the stream
   * @param taxonomy The taxonomy to set
   * @returns A promise that resolves to the transaction receipt
   */
  public async setTaxonomy(
    taxonomy: TaxonomySet,
  ): Promise<GenericResponse<TxReceipt>> {
    const childDataProviders: string[] = [];
    const childStreamIds: string[] = [];
    const weights: string[] = [];

    for (const item of taxonomy.taxonomyItems) {
      childDataProviders.push(item.childStream.dataProvider
          .getAddress());
      childStreamIds.push(item.childStream.streamId.getId());
      weights.push(item.weight.toString());
    }

    const txHash = await this.executeWithActionBody({
        namespace: "main",
        name: "insert_taxonomy",
        inputs: [
          {
            $data_provider: taxonomy.stream.dataProvider.getAddress(),
            $stream_id: taxonomy.stream.streamId.getId(),
            $child_data_providers: childDataProviders,
            $child_stream_ids: childStreamIds,
            $weights: weights,
            $start_date: taxonomy.startDate
          },
        ],
        types: {
          $data_provider: DataType.Text,
          $stream_id: DataType.Text,
          $child_data_providers: DataType.TextArray,
          $child_stream_ids: DataType.TextArray,
          $weights: DataType.NumericArray(36,18),
          $start_date: DataType.Int
        }});

    return txHash;
  }

  /**
   * Creates a ComposedStream from a base Stream
   * @param stream The base stream to convert
   * @returns A ComposedStream instance
   */
  public static fromStream(stream: Action): ComposedAction {
    return new ComposedAction(
      stream["kwilClient"],
      stream["kwilSigner"],
    );
  }
}
