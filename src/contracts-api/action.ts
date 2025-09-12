import {KwilSigner, NodeKwil, WebKwil} from "@trufnetwork/kwil-js";
import { ActionBody } from '@trufnetwork/kwil-js/dist/core/action';
import {NamedParams} from "@trufnetwork/kwil-js/dist/core/action";
import { GenericResponse } from "@trufnetwork/kwil-js/dist/core/resreq";
import { TxReceipt } from "@trufnetwork/kwil-js/dist/core/tx";
import { Either } from "monads-io";
import { DateString } from "../types/other";
import { StreamLocator } from "../types/stream";
import { CacheAwareResponse, GetRecordOptions, GetIndexOptions, GetIndexChangeOptions, GetFirstRecordOptions } from "../types/cache";
import { EthereumAddress } from "../util/EthereumAddress";
import { head } from "../util/head";
import { StreamId } from "../util/StreamId";
import { toVisibilityEnum, VisibilityEnum } from "../util/visibility";
import { CacheMetadataParser } from "../util/cacheMetadataParser";
import { CacheValidation } from "../util/cacheValidation";
import {
  MetadataKey,
  MetadataKeyValueMap,
  MetadataTableKey,
  MetadataValueTypeForKey,
  StreamType,
} from "./contractValues";
import {ValueType} from "@trufnetwork/kwil-js/dist/utils/types";

export interface GetRecordInput {
  stream: StreamLocator;
  from?: number;
  to?: number;
  frozenAt?: number;
  baseTime?: DateString | number;
  prefix?: string;
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

export interface ListMetadataByHeightParams {
  /** Key reference filter. Default: empty string */
  key?: string;
  /** Value reference filter. Default: null */
  value?: string;
  /** Start height (inclusive). If null, uses earliest available. */
  fromHeight?: number;
  /** End height (inclusive). If null, uses current height. */
  toHeight?: number;
  /** Maximum number of results to return. Default: 1000 */
  limit?: number;
  /** Number of results to skip for pagination. Default: 0 */
  offset?: number;
}

export interface MetadataQueryResult {
  streamId: string;
  dataProvider: string;
  rowId: string;
  valueInt: number | null;
  valueFloat: string | null;
  valueBoolean: boolean | null;
  valueString: string | null;
  valueRef: string | null;
  createdAt: number;
}

export class Action {
  protected kwilClient: WebKwil | NodeKwil;
  protected kwilSigner: KwilSigner;
  /** Track if deprecation warnings were already emitted */
  private static _legacyWarnEmitted: Record<string, boolean> = {
    getRecord: false,
    getIndex: false,
    getFirstRecord: false,
    getIndexChange: false,
  };
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
   * @deprecated Use getRecord(stream, options?) to leverage cache support and future-proof parameter handling.
   */
  public async getRecord(input: GetRecordInput): Promise<StreamRecord[]>;
  public async getRecord(stream: StreamLocator, options?: GetRecordOptions): Promise<CacheAwareResponse<StreamRecord[]>>;
  public async getRecord(
    inputOrStream: GetRecordInput | StreamLocator,
    options?: GetRecordOptions
  ): Promise<StreamRecord[] | CacheAwareResponse<StreamRecord[]>> {
    // Handle backward compatibility
    if ('stream' in inputOrStream) {
      // Legacy call format
      const input = inputOrStream as GetRecordInput;
      // emit deprecation warning once
      if (!Action._legacyWarnEmitted.getRecord) {
        Action._legacyWarnEmitted.getRecord = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[TN SDK] Deprecated signature: getRecord(input). Use getRecord(stream, options?) instead.');
        }
      }
      const prefix = input.prefix ? input.prefix : ""
      const result = await this.call<{ event_time: number; value: string }[]>(
          prefix + "get_record",
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
    
    // New cache-aware call format
    const stream = inputOrStream as StreamLocator;
    
    // Validate options if provided
    if (options) {
      CacheValidation.validateGetRecordOptions(options);
      CacheValidation.validateTimeRange(options.from, options.to);
    }
    
    const prefix = options?.prefix ? options.prefix : ""
    const params: any = {
      $data_provider: stream.dataProvider.getAddress(),
      $stream_id: stream.streamId.getId(),
      $from: options?.from,
      $to: options?.to,
      $frozen_at: options?.frozenAt,
    };
    
    if (options?.useCache !== undefined) {
      params.$use_cache = options.useCache;
    }
    
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: prefix + "get_record",
        inputs: params,
      },
      this.kwilSigner,
    );
    
    if (result.status !== 200) {
      throw new Error(`Failed to get record: ${result.status}`);
    }
    
    const data = (result.data?.result as { event_time: number; value: string }[]).map((row) => ({
      eventTime: row.event_time,
      value: row.value,
    }));
    
    let cache = CacheMetadataParser.extractFromResponse(result);
    
    // Enhance cache metadata with SDK-provided context
    if (cache) {
      cache = {
        ...cache,
        streamId: stream.streamId.getId(),
        dataProvider: stream.dataProvider.getAddress(),
        from: options?.from,
        to: options?.to,
        frozenAt: options?.frozenAt,
        rowsServed: data.length
      };
    }
    
    return {
      data,
      cache: cache || undefined,
      logs: result.data?.logs ? CacheMetadataParser.parseLogsForMetadata(result.data.logs) : undefined,
    };
  }

  /**
   * Returns the index of the stream within the given date range
   * @deprecated Use getIndex(stream, options?) to leverage cache support and future-proof parameter handling.
   */
  public async getIndex(input: GetRecordInput): Promise<StreamRecord[]>;
  public async getIndex(stream: StreamLocator, options?: GetIndexOptions): Promise<CacheAwareResponse<StreamRecord[]>>;
  public async getIndex(
    inputOrStream: GetRecordInput | StreamLocator,
    options?: GetIndexOptions
  ): Promise<StreamRecord[] | CacheAwareResponse<StreamRecord[]>> {
    // Handle backward compatibility
    if ('stream' in inputOrStream) {
      // Legacy call format
      const input = inputOrStream as GetRecordInput;
      if (!Action._legacyWarnEmitted.getIndex) {
        Action._legacyWarnEmitted.getIndex = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[TN SDK] Deprecated signature: getIndex(input). Use getIndex(stream, options?) instead.');
        }
      }
      const prefix = input.prefix ? input.prefix : ""
      const result = await this.call<{ event_time: number; value: string }[]>(
        prefix + "get_index",
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
    
    // New cache-aware call format
    const stream = inputOrStream as StreamLocator;
    
    // Validate options if provided
    if (options) {
      CacheValidation.validateGetIndexOptions(options);
      CacheValidation.validateTimeRange(options.from, options.to);
    }
    
    const prefix = options?.prefix ? options.prefix : ""
    const params: any = {
      $data_provider: stream.dataProvider.getAddress(),
      $stream_id: stream.streamId.getId(),
      $from: options?.from,
      $to: options?.to,
      $frozen_at: options?.frozenAt,
      $base_time: options?.baseTime,
    };
    
    if (options?.useCache !== undefined) {
      params.$use_cache = options.useCache;
    }
    
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: prefix + "get_index",
        inputs: params,
      },
      this.kwilSigner,
    );
    
    if (result.status !== 200) {
      throw new Error(`Failed to get index: ${result.status}`);
    }
    
    const data = (result.data?.result as { event_time: number; value: string }[]).map((row) => ({
      eventTime: row.event_time,
      value: row.value,
    }));
    
    let cache = CacheMetadataParser.extractFromResponse(result);
    
    // Enhance cache metadata with SDK-provided context
    if (cache) {
      cache = {
        ...cache,
        streamId: stream.streamId.getId(),
        dataProvider: stream.dataProvider.getAddress(),
        from: options?.from,
        to: options?.to,
        frozenAt: options?.frozenAt,
        rowsServed: data.length
      };
    }
    
    return {
      data,
      cache: cache || undefined,
      logs: result.data?.logs ? CacheMetadataParser.parseLogsForMetadata(result.data.logs) : undefined
    };
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
   * @deprecated Use getFirstRecord(stream, options?) to leverage cache support and future-proof parameter handling.
   */
  public async getFirstRecord(
    input: GetFirstRecordInput,
  ): Promise<StreamRecord | null>;
  public async getFirstRecord(
    stream: StreamLocator,
    options?: GetFirstRecordOptions
  ): Promise<CacheAwareResponse<StreamRecord | null>>;
  public async getFirstRecord(
    inputOrStream: GetFirstRecordInput | StreamLocator,
    options?: GetFirstRecordOptions
  ): Promise<StreamRecord | null | CacheAwareResponse<StreamRecord | null>> {
    // Handle backward compatibility
    if ('stream' in inputOrStream) {
      // Legacy call format
      const input = inputOrStream as GetFirstRecordInput;
      if (!Action._legacyWarnEmitted.getFirstRecord) {
        Action._legacyWarnEmitted.getFirstRecord = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[TN SDK] Deprecated signature: getFirstRecord(input). Use getFirstRecord(stream, options?) instead.');
        }
      }
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
    
    // New cache-aware call format
    const stream = inputOrStream as StreamLocator;
    
    // Validate options if provided
    if (options) {
      CacheValidation.validateGetFirstRecordOptions(options);
    }
    
    const params: any = {
      $data_provider: stream.dataProvider.getAddress(),
      $stream_id: stream.streamId.getId(),
      $after: options?.after,
      $frozen_at: options?.frozenAt,
    };
    
    if (options?.useCache !== undefined) {
      params.$use_cache = options.useCache;
    }
    
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_first_record",
        inputs: params,
      },
      this.kwilSigner,
    );
    
    if (result.status !== 200) {
      throw new Error(`Failed to get first record: ${result.status}`);
    }
    
    const rawData = result.data?.result as { event_time: number; value: string }[];
    const data = rawData && rawData.length > 0 ? {
      eventTime: rawData[0].event_time,
      value: rawData[0].value,
    } : null;
    
    let cache = CacheMetadataParser.extractFromResponse(result);
    
    // Enhance cache metadata with SDK-provided context
    if (cache) {
      cache = {
        ...cache,
        streamId: stream.streamId.getId(),
        dataProvider: stream.dataProvider.getAddress(),
        frozenAt: options?.frozenAt,
        rowsServed: data ? 1 : 0
      };
    }
    
    return {
      data,
      cache: cache || undefined,
      logs: result.data?.logs ? CacheMetadataParser.parseLogsForMetadata(result.data.logs) : undefined
    };
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

  public async listMetadataByHeight<K extends MetadataKey>(
    params: ListMetadataByHeightParams = {},
  ): Promise<MetadataQueryResult[]> {
     type MetadataRawResult = {
        stream_id: string;
        data_provider: string;
        row_id: string;
        value_i: number | null;
        value_f: string | null;
        value_b: boolean | null;
        value_s: string | null;
        value_ref: string | null;
        created_at: number;
    }[];
    const result = await this.call<MetadataRawResult>(
      "list_metadata_by_height",
      {
        $key: params.key ?? "",
        $ref: params.value ?? null,
        $from_height: params.fromHeight ?? null,
        $to_height: params.toHeight ?? null,
        $limit: params.limit ?? null,
        $offset: params.offset ?? null,
      },
    );

    return result
      .mapRight((records) => 
        records.map(record => ({
          streamId: record.stream_id,
          dataProvider: record.data_provider,
          rowId: record.row_id,
          valueInt: record.value_i,
          valueFloat: record.value_f,
          valueBoolean: record.value_b,
          valueString: record.value_s,
          valueRef: record.value_ref,
          createdAt: record.created_at,
        }))
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
   * @deprecated Use getIndexChange(stream, options) to leverage cache support and future-proof parameter handling.
   */
  public async getIndexChange(
    input: GetIndexChangeInput,
  ): Promise<StreamRecord[]>;
  public async getIndexChange(
    stream: StreamLocator,
    options: GetIndexChangeOptions
  ): Promise<CacheAwareResponse<StreamRecord[]>>;
  public async getIndexChange(
    inputOrStream: GetIndexChangeInput | StreamLocator,
    options?: GetIndexChangeOptions
  ): Promise<StreamRecord[] | CacheAwareResponse<StreamRecord[]>> {
    // Handle backward compatibility
    if ('stream' in inputOrStream) {
      // Legacy call format
      const input = inputOrStream as GetIndexChangeInput;
      if (!Action._legacyWarnEmitted.getIndexChange) {
        Action._legacyWarnEmitted.getIndexChange = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[TN SDK] Deprecated signature: getIndexChange(input). Use getIndexChange(stream, options?) instead.');
        }
      }
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
    
    // New cache-aware call format
    const stream = inputOrStream as StreamLocator;
    if (!options) {
      throw new Error('Options parameter is required for cache-aware getIndexChange');
    }
    
    // Validate options
    CacheValidation.validateGetIndexChangeOptions(options);
    CacheValidation.validateTimeRange(options.from, options.to);
    
    const params: any = {
      $data_provider: stream.dataProvider.getAddress(),
      $stream_id: stream.streamId.getId(),
      $from: options.from,
      $to: options.to,
      $frozen_at: options.frozenAt,
      $base_time: options.baseTime,
      $time_interval: options.timeInterval,
    };
    
    if (options.useCache !== undefined) {
      params.$use_cache = options.useCache;
    }
    
    const result = await this.kwilClient.call(
      {
        namespace: "main",
        name: "get_index_change",
        inputs: params,
      },
      this.kwilSigner,
    );
    
    if (result.status !== 200) {
      throw new Error(`Failed to get index change: ${result.status}`);
    }
    
    const data = (result.data?.result as { event_time: number; value: string }[]).map((row) => ({
      eventTime: row.event_time,
      value: row.value,
    }));
    
    let cache = CacheMetadataParser.extractFromResponse(result);
    
    // Enhance cache metadata with SDK-provided context
    if (cache) {
      cache = {
        ...cache,
        streamId: stream.streamId.getId(),
        dataProvider: stream.dataProvider.getAddress(),
        from: options.from,
        to: options.to,
        frozenAt: options.frozenAt,
        rowsServed: data.length
      };
    }
    
    return {
      data,
      cache: cache || undefined,
      logs: result.data?.logs ? CacheMetadataParser.parseLogsForMetadata(result.data.logs) : undefined
    };
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

  /**
   * Gets the wallet balance on any supported blockchain network
   * @param chain The chain identifier (e.g., "sepolia", "mainnet", "polygon", etc.)
   * @param walletAddress The wallet address to check balance for
   * @returns Promise that resolves to the balance as a string, or throws on error
   */
  public async getWalletBalance(
    chain: string,
    walletAddress: string
  ): Promise<string> {
    const result = await this.call<{ balance?: string; }[]>(
      `${chain}_wallet_balance`,
      {
        $wallet_address: walletAddress,
      }
    );

    return result
      .mapRight((rows) => {
        if (rows.length === 0) {
          throw new Error("You don't have necessary permissions to execute this query");
        }
        
        const row = rows[0];
        
        if (row.balance === undefined) {
          throw new Error("No balance returned from wallet balance query");
        }
        
        return row.balance;
      })
      .throw();
  }

  /**
   * Calls the whoami action to get the caller's wallet address
   * This is useful for verifying wallet authentication with TN
   * @returns Promise that resolves to the caller's wallet address
   */
  public async whoami(): Promise<string> {
    const result = await this.call<{ caller: string }[]>(
      "whoami",
      {}
    );

    return result
      .mapRight((rows) => {
        if (rows.length === 0) {
          throw new Error("No response from whoami action");
        }
        
        const row = rows[0];
        
        if (!row.caller) {
          throw new Error("No caller address returned from whoami");
        }
        
        return row.caller;
      })
      .throw();
  }

  /**
   * Bridges tokens on a blockchain network
   * @param chain The chain identifier (e.g., "sepolia", "mainnet", "polygon", etc.)
   * @param amount The amount to bridge
   * @returns Promise that resolves to GenericResponse<TxReceipt>
   */
  public async bridgeTokens(
    chain: string,
    amount: string
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.executeWithNamedParams(`${chain}_admin_bridge_tokens`, [{
      $amount: amount,
    }]);
  }
}
