import {KwilSigner, NodeKwil, WebKwil, Types} from "@trufnetwork/kwil-js";
import { Either } from "monads-io";
import { WithdrawalProof } from "../types/bridge";
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
// ValueType is available as Types.ValueType

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
   * Executes a stream method with named parameters
   * @param method - The action name to execute
   * @param inputs - Named parameters for the action
   * @param types - Optional type specifications for parameters (e.g., NUMERIC)
   * @returns Transaction receipt
   */
  protected async executeWithNamedParams(
    method: string,
    inputs: Types.NamedParams[],
    types?: Record<string, any>,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.kwilClient.execute({
          namespace: "main",
          name: method,
          inputs,
          types,
          description: `TN SDK - Executing method on stream: ${method}`,
        },
        this.kwilSigner,
        );
  }

  /**
   * Executes a stream action with a complete ActionBody
   * @param inputs - Complete action body with all execution parameters
   * @param synchronous - Whether to wait for transaction to be mined
   * @returns Transaction receipt
   */
  protected async executeWithActionBody(
    inputs: Types.ActionBody,
    synchronous: boolean = false,
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    return this.kwilClient.execute(inputs, this.kwilSigner, synchronous);
  }

  /**
   * Calls a method on the stream
   */
  protected async call<T>(
    method: string,
    inputs: Types.NamedParams,
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
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
    args: Record<string, Types.ValueType | Types.ValueType[]>,
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
    const result = await this.call<{ database_size: BigInt }[]>("get_database_size_v2", {})
    return result
      .map((rows) => {
        const raw = rows[0].database_size;
        const asBigInt = BigInt(raw.toString());
        return asBigInt;
      }).throw();
  }

  /**
   * Returns the size of database in human-readable format (e.g., "22 GB", "1.5 TB")
   */
  public async getDatabaseSizePretty(): Promise<string> {
    const result = await this.call<{ database_size_pretty: string }[]>("get_database_size_v2_pretty", {})
    return result
      .map((rows) => rows[0].database_size_pretty)
      .throw();
  }

  /**
   * Gets the wallet balance for a specific bridge instance
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt", "ethereum")
   *                         This corresponds to the bridge instance name in TN (e.g., hoodi_tt for Hoodi Test Token bridge)
   * @param walletAddress The wallet address to check balance for
   * @returns Promise that resolves to the balance as a string (in wei), or throws on error
   * @example
   * ```typescript
   * // Simple case - identifier matches network name
   * const balance = await action.getWalletBalance("sepolia", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
   *
   * // Multi-token bridge - specify bridge instance explicitly
   * const balance = await action.getWalletBalance("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
   * ```
   */
  public async getWalletBalance(
    bridgeIdentifier: string,
    walletAddress: string
  ): Promise<string> {
    const result = await this.call<{ balance?: string; }[]>(
      `${bridgeIdentifier}_wallet_balance`,
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
   * Bridges tokens by initiating a withdrawal from TN to a blockchain network
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt", "ethereum")
   * @param amount The amount to bridge in wei (as string to preserve precision)
   * @param recipient The recipient address on the destination chain
   * @returns Promise that resolves to transaction receipt
   * @example
   * ```typescript
   * // Bridge 100 tokens from TN to Sepolia
   * const receipt = await action.bridgeTokens("sepolia", "100000000000000000000", "0x742d35Cc...");
   *
   * // Bridge from TN to Hoodi Test Token bridge
   * const receipt = await action.bridgeTokens("hoodi_tt", "50000000000000000000", "0x742d35Cc...");
   * ```
   */
  public async bridgeTokens(
    bridgeIdentifier: string,
    amount: string,
    recipient: string
  ): Promise<Types.GenericResponse<Types.TxReceipt>> {
    // Validate amount is greater than 0
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Amount must be greater than 0.`);
    }

    return await this.executeWithNamedParams(`${bridgeIdentifier}_bridge_tokens`, [{
      $recipient: recipient,
      $amount: amount
    }]);
  }

  /**
   * Lists wallet rewards for a specific bridge instance
   * @param bridgeIdentifier The bridge instance identifier (e.g., "sepolia", "hoodi_tt")
   * @param wallet The wallet address to list rewards for
   * @param withPending Whether to include pending rewards
   * @returns Promise that resolves to array of reward records
   * @deprecated This method uses the extension namespace directly. Most users should use getWithdrawalProof instead.
   */
  public async listWalletRewards(
    bridgeIdentifier: string,
    wallet: string,
    withPending: boolean
  ): Promise<any[]> {
    const result = await this.kwilClient.call(
      {
        namespace: `${bridgeIdentifier}_bridge`,
        name: "list_wallet_rewards",
        inputs: {
          $param_1: wallet,
          $param_2: withPending,
        },
      },
      this.kwilSigner,
    );

    if (result.status !== 200) {
      throw new Error(`Failed to list wallet rewards: ${result.status}`);
    }

    return result.data?.result || [];
  }

  /**
   * Gets withdrawal proof for a wallet address on a specific bridge instance
   * Returns merkle proofs and validator signatures needed for claiming withdrawals on the destination chain
   *
   * This method is used for non-custodial bridge withdrawals where users need to
   * manually claim their withdrawals by submitting proofs to the destination chain contract.
   *
   * @param bridgeIdentifier The bridge instance identifier (e.g., "hoodi_tt", "sepolia", "ethereum")
   * @param walletAddress The wallet address to get withdrawal proof for
   * @returns Promise that resolves to array of withdrawal proofs (empty array if no unclaimed withdrawals)
   *
   * @example
   * ```typescript
   * // Get withdrawal proofs for Hoodi Test Token bridge
   * const proofs = await action.getWithdrawalProof("hoodi_tt", "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb");
   * // Returns: [{ chain: "hoodi", recipient: "0x...", amount: "100000000000000000000", proofs: [...], signatures: [...] }]
   *
   * // Use the proofs to claim withdrawal on destination chain
   * if (proofs.length > 0) {
   *   const proof = proofs[0];
   *   await bridgeContract.claimWithdrawal(proof.recipient, proof.amount, proof.root, proof.proofs, proof.signatures);
   * }
   * ```
   *
   * @note This method has been tested via integration tests in the node repository.
   * See: https://github.com/trufnetwork/kwil-db/blob/main/node/exts/erc20-bridge/erc20/meta_extension_withdrawal_test.go
   */
  public async getWithdrawalProof(
    bridgeIdentifier: string,
    walletAddress: string
  ): Promise<WithdrawalProof[]> {
    const result = await this.call<WithdrawalProof[]>(
      `${bridgeIdentifier}_get_withdrawal_proof`,
      {
        $wallet_address: walletAddress,
      }
    );

    return result
      .mapRight((rows) => {
        // Return the array of withdrawal proofs
        // May be empty if no unclaimed withdrawals
        return rows || [];
      })
      .throw();
  }
}
