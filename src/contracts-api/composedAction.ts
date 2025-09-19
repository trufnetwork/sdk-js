import {KwilSigner, NodeKwil, Utils, WebKwil, Types} from "@trufnetwork/kwil-js";
import { DateString } from "../types/other";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { Action } from "./action";

// Use kwil-js DataType directly
const DataType = Utils.DataType;

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

export interface ListTaxonomiesByHeightParams {
  /** Start height (inclusive). If null, uses earliest available. */
  fromHeight?: number;
  /** End height (inclusive). If null, uses current height. */
  toHeight?: number;
  /** Maximum number of results to return. Default: 1000 */
  limit?: number;
  /** Number of results to skip for pagination. Default: 0 */
  offset?: number;
  /** If true, returns only latest group_sequence per stream. Default: false */
  latestOnly?: boolean;
}

export interface GetTaxonomiesForStreamsParams {
  /** Array of stream locators to query */
  streams: StreamLocator[];
  /** If true, returns only latest group_sequence per stream. Default: false */
  latestOnly?: boolean;
}

export interface TaxonomyQueryResult {
  /** Parent stream data provider */
  dataProvider: EthereumAddress;
  /** Parent stream ID */
  streamId: StreamId;
  /** Child stream data provider */
  childDataProvider: EthereumAddress;
  /** Child stream ID */
  childStreamId: StreamId;
  /** Weight of the child stream in the taxonomy */
  weight: string;
  /** Block height when taxonomy was created */
  createdAt: number;
  /** Group sequence number for this taxonomy set */
  groupSequence: number;
  /** Start time timestamp for this taxonomy */
  startTime: number;
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
   * Lists taxonomies by block height range for incremental synchronization.
   * Enables efficient detection of taxonomy changes since a specific block height.
   * 
   * @param params Height range and pagination parameters
   * @returns Promise resolving to taxonomy query results
   * 
   * @example
   * ```typescript
   * const taxonomies = await composedAction.listTaxonomiesByHeight({
   *   fromHeight: 1000,
   *   toHeight: 2000,
   *   limit: 100,
   *   latestOnly: true
   * });
   * ```
   */
  public async listTaxonomiesByHeight(
    params: ListTaxonomiesByHeightParams = {},
  ): Promise<TaxonomyQueryResult[]> {
    type TaxonomyRawResult = {
      data_provider: string;
      stream_id: string;
      child_data_provider: string;
      child_stream_id: string;
      weight: string;
      created_at: number;
      group_sequence: number;
      start_time: number;
    }[];

    const result = await this.call<TaxonomyRawResult>(
      "list_taxonomies_by_height",
      {
        $from_height: params.fromHeight ?? null,
        $to_height: params.toHeight ?? null,
        $limit: params.limit ?? null,
        $offset: params.offset ?? null,
        $latest_only: params.latestOnly ?? null,
      },
    );

    return result
      .mapRight((records) => 
        records.map(record => ({
          dataProvider: EthereumAddress.fromString(record.data_provider).throw(),
          streamId: StreamId.fromString(record.stream_id).throw(),
          childDataProvider: EthereumAddress.fromString(record.child_data_provider).throw(),
          childStreamId: StreamId.fromString(record.child_stream_id).throw(),
          weight: record.weight,
          createdAt: record.created_at,
          groupSequence: record.group_sequence,
          startTime: record.start_time,
        }))
      )
      .throw();
  }

  /**
   * Gets taxonomies for specific streams in batch.
   * Useful for validating taxonomy data for known streams.
   * 
   * @param params Stream locators and filtering options
   * @returns Promise resolving to taxonomy query results
   * 
   * @example
   * ```typescript
   * const taxonomies = await composedAction.getTaxonomiesForStreams({
   *   streams: [
   *     { dataProvider: provider1, streamId: streamId1 },
   *     { dataProvider: provider2, streamId: streamId2 }
   *   ],
   *   latestOnly: true
   * });
   * ```
   */
  public async getTaxonomiesForStreams(
    params: GetTaxonomiesForStreamsParams,
  ): Promise<TaxonomyQueryResult[]> {
    // Validate input
    if (!params.streams || params.streams.length === 0) {
      return [];
    }

    const dataProviders = params.streams.map(s => s.dataProvider.getAddress());
    const streamIds = params.streams.map(s => s.streamId.getId());

    type TaxonomyRawResult = {
      data_provider: string;
      stream_id: string;
      child_data_provider: string;
      child_stream_id: string;
      weight: string;
      created_at: number;
      group_sequence: number;
      start_time: number;
    }[];

    const result = await this.call<TaxonomyRawResult>(
      "get_taxonomies_for_streams",
      {
        $data_providers: dataProviders,
        $stream_ids: streamIds,
        $latest_only: params.latestOnly ?? null,
      },
    );

    return result
      .mapRight((records) => 
        records.map(record => ({
          dataProvider: EthereumAddress.fromString(record.data_provider).throw(),
          streamId: StreamId.fromString(record.stream_id).throw(),
          childDataProvider: EthereumAddress.fromString(record.child_data_provider).throw(),
          childStreamId: StreamId.fromString(record.child_stream_id).throw(),
          weight: record.weight,
          createdAt: record.created_at,
          groupSequence: record.group_sequence,
          startTime: record.start_time,
        }))
      )
      .throw();
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
