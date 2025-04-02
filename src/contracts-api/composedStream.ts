import { KwilSigner, NodeKwil, WebKwil } from "@kwilteam/kwil-js";
import { ActionInput } from "@kwilteam/kwil-js/dist/core/action";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { DateString } from "../types/other";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { StreamId } from "../util/StreamId";
import { StreamType } from "./contractValues";
import { Stream } from "./stream";

export const ErrorStreamNotComposed = "stream is not a composed stream";

export interface TaxonomySet {
  taxonomyItems: TaxonomyItem[];
  startDate: DateString | number;
}

export interface TaxonomyItem {
  childStream: StreamLocator;
  weight: string;
}

export interface DescribeTaxonomiesParams {
  /**
   * if true, will return the latest version of the taxonomy only
   */
  latestVersion: boolean;
}

export class ComposedStream extends Stream {
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ) {
    super(kwilClient, kwilSigner);
  }

  /**
   * Checks if the stream is a valid composed stream.
   * A valid composed stream must be:
   * - initialized
   * - of type composed
   */
  private async checkValidComposedStream(): Promise<void> {
    // First check if initialized
    await this.checkInitialized(StreamType.Composed);

    // Then check if is composed
    const streamType = await this.getType();
    if (streamType !== StreamType.Composed) {
      throw new Error(ErrorStreamNotComposed);
    }
  }

  /**
   * Executes a method after checking if the stream is a valid composed stream
   * @param method The method name to execute
   * @param inputs The inputs for the action
   * @returns A generic response containing the transaction receipt
   */
  private async checkedComposedExecute(
    method: string,
    inputs: ActionInput[],
  ): Promise<GenericResponse<TxReceipt>> {
    await this.checkValidComposedStream();
    return this.executeWithNamedParams(method, inputs);
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
      child_stream_id: string;
      child_data_provider: string;
      weight: string;
      created_at: number;
      version: number;
      start_date: string | number;
    }[];

    const result = await this.call<TaxonomyResult>("describe_taxonomies", [
      ActionInput.fromObject({ $latest_version: params.latestVersion }),
    ]);

    return result
      .mapRight((records) => {
        const taxonomyItems: Map<DateString, TaxonomyItem[]> = records.reduce(
          (acc, record) => {
            const currentArray = acc.get(<string>record.start_date) || [];
            currentArray.push({
              childStream: {
                streamId: StreamId.fromString(record.child_stream_id).throw(),
                dataProvider: EthereumAddress.fromString(
                  record.child_data_provider,
                ).throw(),
              },
              weight: record.weight,
            });
            acc.set(<string>record.start_date, currentArray);
            return acc;
          },
          new Map<DateString, TaxonomyItem[]>(),
        );

        let startDate: string | number;
        if (records.length > 0 && records[0].start_date) {
          startDate = records[0].start_date;
        }

        return Array.from(taxonomyItems.entries()).map(
          ([startDate, taxonomyItems]) => ({
            startDate,
            taxonomyItems,
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
    const dataProviders: string[] = [];
    const streamIds: string[] = [];
    const weights: string[] = [];
    const startDate = taxonomy.startDate;

    for (const item of taxonomy.taxonomyItems) {
      const dataProviderHex = item.childStream.dataProvider
        .getAddress()
        .slice(2); // Remove 0x prefix
      dataProviders.push(dataProviderHex);
      streamIds.push(item.childStream.streamId.getId());
      weights.push(item.weight.toString());
    }

    return this.checkedComposedExecute("set_taxonomy", [
      ActionInput.fromObject({
        $data_providers: dataProviders,
        $stream_ids: streamIds,
        $weights: weights,
        $start_date: startDate,
      }),
    ]);
  }

  /**
   * Creates a ComposedStream from a base Stream
   * @param stream The base stream to convert
   * @returns A ComposedStream instance
   */
  public static fromStream(stream: Stream): ComposedStream {
    return new ComposedStream(
      stream["kwilClient"],
      stream["kwilSigner"],
    );
  }
}
