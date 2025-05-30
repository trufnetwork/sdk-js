import {KwilSigner, NodeKwil, WebKwil} from "@kwilteam/kwil-js";
import { ActionBody } from '@kwilteam/kwil-js/dist/core/action';
import {NamedParams} from "@kwilteam/kwil-js/dist/core/action";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { Either } from "monads-io";
import { DateString } from "../types/other";
import { StreamLocator } from "../types/stream";
import { EthereumAddress } from "../util/EthereumAddress";
import { head } from "../util/head";
import { StreamId } from "../util/StreamId";
import { toVisibilityEnum, VisibilityEnum } from "../util/visibility";
import {
  MetadataKey,
  MetadataKeyValueMap,
  MetadataTableKey,
  MetadataValueTypeForKey,
  StreamType,
} from "./contractValues";
import {ValueType} from "@kwilteam/kwil-js/dist/utils/types";

export interface GetRecordInput {
  stream: StreamLocator;
  from?: number;
  to?: number;
  frozenAt?: number;
  baseTime?: DateString | number;
}

export interface GetFirstRecordInput {
  stream: StreamLocator;
  after?: number;
  frozenAt?: number;
}

export interface StreamRecord {
  eventTime: number;
  value: string;
}

export interface GetIndexChangeInput extends GetRecordInput {
  timeInterval: number;
}

export class Action {
  protected kwilClient: WebKwil | NodeKwil;
  protected kwilSigner: KwilSigner;
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ) {
    this.kwilClient = kwilClient;
    this.kwilSigner = kwilSigner;
  }

  /**
   * Executes a method on the stream
   */
  protected async executeWithNamedParams(
    method: string,
    inputs: NamedParams[],
  ): Promise<GenericResponse<TxReceipt>> {
    return this.kwilClient.execute({
          namespace: "main",
          name: method,
          inputs,
          description: `TN SDK - Executing method on stream: ${method}`,
        },
        this.kwilSigner,
        );
  }

    /**
     * Executes a method on the stream
     */
    protected async executeWithActionBody(
        inputs: ActionBody,
        synchronous: boolean = false,
    ): Promise<GenericResponse<TxReceipt>> {
        return this.kwilClient.execute(inputs, this.kwilSigner, synchronous);
    }

  /**
   * Calls a method on the stream
   */
  protected async call<T>(
    method: string,
    inputs: NamedParams,
  ): Promise<Either<number, T>> {
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: method,
        inputs: inputs,
      },
      this.kwilSigner,
    );

    if (result.status !== 200) {
      return Either.left(result.status);
    }

    return Either.right(result.data?.result as T);
  }

  /**
   * Returns the records of the stream within the given date range
   */
  public async getRecord(input: GetRecordInput): Promise<StreamRecord[]> {
    const result = await this.call<{ event_time: number; value: string }[]>(
        "get_record",
        {
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $from: input.from,
          $to: input.to,
          $frozen_at: input.frozenAt,
        }
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          eventTime: row.event_time,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * Returns the index of the stream within the given date range
   */
  public async getIndex(input: GetRecordInput): Promise<StreamRecord[]> {
    const result = await this.call<{ event_time: number; value: string }[]>(
      "get_index",
        {
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $from: input.from,
          $to: input.to,
          $frozen_at: input.frozenAt,
          $base_time: input.baseTime,
        }
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          eventTime: row.event_time,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * Returns the type of the stream
   */
  public async getType(
      stream: StreamLocator,
  ): Promise<StreamType> {
    const result = await this.getMetadata(
        stream,
        MetadataKey.TypeKey);

    if (!result) {
      throw new Error("Failed to get stream type");
    }

    const type = head(result).unwrapOrElse(() => {
      throw new Error(
        "Failed to get stream type. Check if the stream is initialized.",
      );
    });

    const validTypes = [StreamType.Primitive, StreamType.Composed];

    if (!validTypes.includes(type.value as StreamType)) {
      throw new Error(`Invalid stream type: ${type.value}`);
    }

    return type.value as StreamType;
  }

  /**
   * Returns the first record of the stream
   */
  public async getFirstRecord(
    input: GetFirstRecordInput,
  ): Promise<StreamRecord | null> {
    const result = await this.call<{ event_time: number; value: string }[]>(
      "get_first_record",
        {
            $data_provider: input.stream.dataProvider.getAddress(),
            $stream_id: input.stream.streamId.getId(),
            $after: input.after,
            $frozen_at: input.frozenAt,
        }
    );

    return result
      .mapRight(head)
      .mapRight((result) =>
        result
          .map((result) => ({
            eventTime: result.event_time,
            value: result.value,
          }))
          .unwrapOr(null),
      )
      .throw();
  }

  protected async setMetadata<K extends MetadataKey>(
    stream: StreamLocator,
    key: K,
    value: MetadataValueTypeForKey<K>,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.executeWithNamedParams("insert_metadata", [{
        $data_provider: stream.dataProvider.getAddress(),
        $stream_id: stream.streamId.getId(),
        $key: key,
        $value: value,
        $val_type: MetadataKeyValueMap[key],
        },
    ]);
  }

  protected async getMetadata<K extends MetadataKey>(
    stream: StreamLocator,
    key: K,
    // onlyLatest: boolean = true,
    filteredRef?: string,
    limit?: number,
    offset?: number,
    orderBy?: string,
  ): Promise<
    { rowId: string; value: MetadataValueTypeForKey<K>; createdAt: number }[]
  > {
    const result = await this.call<
      {
        row_id: string;
        value_i: number;
        value_f: string;
        value_b: boolean;
        value_s: string;
        value_ref: string;
        created_at: number;
      }[]
    >("get_metadata", {
        $data_provider: stream.dataProvider.getAddress(),
        $stream_id: stream.streamId.getId(),
        $key: key,
        $ref: filteredRef,
        $limit: limit,
        $offset: offset,
        $order_by: orderBy,
        },
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          rowId: row.row_id,
          value: row[
            MetadataTableKey[MetadataKeyValueMap[key as MetadataKey]]
          ] as MetadataValueTypeForKey<K>,
          createdAt: row.created_at,
        })),
      )
      .throw();
  }

  /**
   * Sets the read visibility of the stream
   */
  public async setReadVisibility(
    stream: StreamLocator,
    visibility: VisibilityEnum,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
        stream,
      MetadataKey.ReadVisibilityKey,
      visibility.toString(),
    );
  }

  /**
   * Returns the read visibility of the stream
   */
  public async getReadVisibility(
      stream: StreamLocator,
  ): Promise<VisibilityEnum | null> {
    const result = await this.getMetadata(
        stream,
        MetadataKey.ReadVisibilityKey);

    return head(result)
      .map((row) => toVisibilityEnum(row.value))
      .unwrapOr(null);
  }

  /**
   * Sets the compose visibility of the stream
   */
  public async setComposeVisibility(
    stream: StreamLocator,
    visibility: VisibilityEnum,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      stream,
      MetadataKey.ComposeVisibilityKey,
      visibility.toString(),
    );
  }

  /**
   * Returns the compose visibility of the stream
   */
  public async getComposeVisibility(
      stream: StreamLocator,
  ): Promise<VisibilityEnum | null> {
    const result = await this.getMetadata(
      stream,
      MetadataKey.ComposeVisibilityKey);

    return head(result)
      .map((row) => toVisibilityEnum(row.value))
      .unwrapOr(null);
  }

  /**
   * Allows a wallet to read the stream
   */
  public async allowReadWallet(
    stream: StreamLocator,
    wallet: EthereumAddress,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      stream,
      MetadataKey.AllowReadWalletKey,
      wallet.getAddress(),
    );
  }

  /**
   * Disables a wallet from reading the stream
   */
  public async disableReadWallet(
    stream: StreamLocator,
    wallet: EthereumAddress,
  ): Promise<GenericResponse<TxReceipt>> {
    const result = await this.getMetadata(
      stream,
      MetadataKey.AllowReadWalletKey,
      wallet.getAddress(),
    );

    const row_id = head(result)
      .map((row) => row.rowId)
      .unwrapOr(null);

    if (!row_id) {
      throw new Error("Wallet not found in allowed list");
    }

    return await this.disableMetadata(stream, row_id);
  }

  /**
   * Allows a stream to use this stream as child
   */
  public async allowComposeStream(
    stream: StreamLocator,
    wallet: StreamLocator,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      stream,
      MetadataKey.AllowComposeStreamKey,
      wallet.streamId.getId(),
    );
  }

  /**
   * Disables a stream from using this stream as child
   */
  public async disableComposeStream(
    stream: StreamLocator,
    wallet: StreamLocator,
  ): Promise<GenericResponse<TxReceipt>> {
    const result = await this.getMetadata(
      stream,
      MetadataKey.AllowComposeStreamKey,
      wallet.toString(),
    );

    const row_id = head(result)
      .map((row) => row.rowId)
      .unwrapOr(null);

    if (!row_id) {
      throw new Error("Stream not found in allowed list");
    }

    return await this.disableMetadata(stream, row_id);
  }

  protected async disableMetadata(
    stream: StreamLocator,
    rowId: string,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.executeWithNamedParams("disable_metadata", [{
            $data_provider: stream.dataProvider.getAddress(),
            $stream_id: stream.streamId.getId(),
            $row_id: rowId,
    }]);
  }

  /**
   * Returns the wallets allowed to read the stream
   */
  public async getAllowedReadWallets(
    stream: StreamLocator,
  ): Promise<EthereumAddress[]> {
    const result = await this.getMetadata(
        stream,
        MetadataKey.AllowReadWalletKey);

    return result
      .filter((row) => row.value)
      .map((row) => new EthereumAddress(row.value));
  }

  /**
   * Returns the streams allowed to compose the stream
   */
  public async getAllowedComposeStreams(
    stream: StreamLocator,
  ): Promise<StreamLocator[]> {
    const result = await this.getMetadata(
        stream,
        MetadataKey.AllowComposeStreamKey);

    return result
      .filter((row) => row.value)
      .map((row) => {
        const [streamId, dataProvider] = row.value.split(":");
        return {
          streamId: StreamId.fromString(streamId).throw(),
          dataProvider: new EthereumAddress(dataProvider),
        };
      });
  }

  /**
   * Returns the index change of the stream within the given date range
   */
  public async getIndexChange(
    input: GetIndexChangeInput,
  ): Promise<StreamRecord[]> {
    const result = await this.call<{ event_time: number; value: string }[]>(
      "get_index_change", 
        {
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $from: input.from,
          $to: input.to,
          $frozen_at: input.frozenAt,
          $base_time: input.baseTime,
          $time_interval: input.timeInterval,
        }
    );

    return result
      .mapRight((result) =>
        result.map((row) => ({
          eventTime: row.event_time,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * A custom method that accepts the procedure name and the input of GetRecordInput
   * Returns the result of the procedure in the same format as StreamRecord
   * I.e. a custom procedure named "get_price" that returns a list of date_value and value
   * can be called with customGetProcedure("get_price", { dateFrom: "2021-01-01", dateTo: "2021-01-31" })
   */
  public async customGetProcedure(
    procedure: string,
    input: GetRecordInput,
  ): Promise<StreamRecord[]> {
    const result = await this.call<{ event_time: number; value: string }[]>(
      procedure,
        {
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $from: input.from,
          $to: input.to,
          $frozen_at: input.frozenAt
        }
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          eventTime: row.event_time,
          value: row.value,
        })),
      )
      .throw();
  }


  /**
   * A custom method that accepts the procedure name and custom input of type Record<string, any>
   * Returns the result of the procedure in the same format as StreamRecord
   * I.e. a custom procedure named "get_custom_index" that returns a list of date_value and value
   * can be called with customProcedureWithArgs("get_custom_index", { $customArg1: "value1", $customArg2: "value2" })
   * where $customArg1 and $customArg2 are the arguments of the procedure
   * @param procedure
   * @param args
   */
  public async customProcedureWithArgs(
    procedure: string,
    args: Record<string, ValueType | ValueType[]>,
  ){
      const result = await this.call<{ event_time: number; value: string }[]>(
          procedure,
          args
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          eventTime: row.event_time,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * Returns the size of database
   */
  public async getDatabaseSize(): Promise<BigInt> {
    const result = await this.call<{ database_size: BigInt }[]>("get_database_size", {})
    return result
      .map((rows) => {
        const raw = rows[0].database_size;
        const asBigInt = BigInt(raw.toString());
        return asBigInt;
      }).throw();
  }
}
