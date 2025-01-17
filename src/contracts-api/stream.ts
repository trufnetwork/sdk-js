import { KwilSigner, NodeKwil, WebKwil } from "@kwilteam/kwil-js";
import { ActionInput } from "@kwilteam/kwil-js/dist/core/action";
import { Database } from "@kwilteam/kwil-js/dist/core/database";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { generateDBID } from "@kwilteam/kwil-js/dist/utils/dbid";
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

export interface GetRecordInput {
  dateFrom?: DateString | number;
  dateTo?: DateString | number;
  frozenAt?: number;
  baseDate?: DateString | number;
}

export interface GetFirstRecordInput {
  afterDate?: DateString | number;
  frozenAt?: DateString | number;
}

export interface StreamRecord {
  dateValue: DateString | number;
  value: string;
}

export interface GetIndexChangeInput extends GetRecordInput {
  daysInterval: number;
}

export class Stream {
  protected kwilClient: WebKwil | NodeKwil;
  protected kwilSigner: KwilSigner;
  protected locator: StreamLocator;
  protected dbid: string;
  protected schema?: Database;
  protected deployed: boolean = false;
  protected initialized: boolean = false;
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
    locator: StreamLocator,
  ) {
    this.kwilClient = kwilClient;
    this.kwilSigner = kwilSigner;
    this.locator = locator;
    this.dbid = generateDBID(
      locator.dataProvider.getAddress(),
      locator.streamId.getId(),
    );
  }

  /**
   * Loads the schema for this stream from the network.
   * Throws if the stream is not deployed.
   */
  public async loadSchema(): Promise<void> {
    const response = await this.kwilClient.getSchema(this.dbid);
    if (response.status !== 200 || !response.data) {
      throw new Error(
        `Failed to load schema for stream ${this.locator.streamId.getId()}`,
      );
    }
    this.schema = response.data;
  }

  /**
   * Executes a method on the stream
   */
  protected async execute(
    method: string,
    inputs: ActionInput[],
  ): Promise<GenericResponse<TxReceipt>> {
    return this.kwilClient.execute(
      {
        dbid: this.dbid,
        name: method,
        inputs,
        description: `TN SDK - Executing method on stream: ${method}`,
      },
      this.kwilSigner,
    );
  }

  /**
   * Executes a method on the stream after checking if it's initialized
   */
  protected async checkedExecute(
    method: string,
    inputs: ActionInput[],
  ): Promise<GenericResponse<TxReceipt>> {
    await this.checkInitialized();
    return this.execute(method, inputs);
  }

  /**
   * Calls a method on the stream
   */
  protected async call<T>(
    method: string,
    inputs: ActionInput[],
  ): Promise<Either<number, T>> {
    const result = await this.kwilClient.call(
      {
        dbid: this.dbid,
        name: method,
        inputs,
      },
      this.kwilSigner,
    );

    if (result.status !== 200) {
      return Either.left(result.status);
    }

    return Either.right(result.data?.result as T);
  }

  /**
   * Checks if the stream is initialized
   */
  protected async checkInitialized(expectedType?: StreamType): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.checkDeployed();

    // check if is initialized by trying to get its type
    const type = await this.getType();

    // check if type is valid
    const expectedTypes = expectedType
      ? [expectedType]
      : [StreamType.Primitive, StreamType.Composed];
    if (!expectedTypes.includes(type)) {
      throw new Error(`Invalid stream type: ${type}`);
    }

    this.initialized = true;
  }

  /**
   * Checks if the stream is deployed
   */
  protected async checkDeployed(): Promise<void> {
    if (this.deployed) {
      return;
    }
    await this.loadSchema();
    this.deployed = true;
  }

  /**
   * Initializes the stream
   */
  public async initializeStream(): Promise<GenericResponse<TxReceipt>> {
    // shouldn't use checkedExecute, because it's not initialized yet
    return this.execute("init", []);
  }

  /**
   * Returns the records of the stream within the given date range
   */
  public async getRecord(input: GetRecordInput): Promise<StreamRecord[]> {
    // TODO: change value to string when kwil-js is updated
    const result = await this.call<{ date_value: string; value: string }[]>(
      "get_record",
      [
        ActionInput.fromObject({
          $date_from: input.dateFrom,
          $date_to: input.dateTo,
          $frozen_at: input.frozenAt,
          $base_date: input.baseDate,
        }),
      ],
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          dateValue: row.date_value,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * Returns the index of the stream within the given date range
   */
  public async getIndex(input: GetRecordInput): Promise<StreamRecord[]> {
    const result = await this.call<{ date_value: string; value: string }[]>(
      "get_index",
      [
        ActionInput.fromObject({
          $date_from: input.dateFrom,
          $date_to: input.dateTo,
          $frozen_at: input.frozenAt,
          $base_date: input.baseDate,
        }),
      ],
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          dateValue: row.date_value,
          value: row.value,
        })),
      )
      .throw();
  }

  /**
   * Returns the type of the stream
   */
  public async getType(): Promise<StreamType> {
    const result = await this.getMetadata(MetadataKey.TypeKey, true);

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
    const result = await this.call<{ date_value: string; value: string }[]>(
      "get_first_record",
      [
        ActionInput.fromObject({
          $after_date: input.afterDate,
          $frozen_at: input.frozenAt,
        }),
      ],
    );

    return result
      .mapRight(head)
      .mapRight((result) =>
        result
          .map((result) => ({
            dateValue: result.date_value,
            value: result.value,
          }))
          .unwrapOr(null),
      )
      .throw();
  }

  protected async setMetadata<K extends MetadataKey>(
    key: K,
    value: MetadataValueTypeForKey<K>,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.execute("insert_metadata", [
      ActionInput.fromObject({
        $key: key,
        $value: value,
        $val_type: MetadataKeyValueMap[key],
      }),
    ]);
  }

  protected async getMetadata<K extends MetadataKey>(
    key: K,
    onlyLatest: boolean = true,
    filteredRef?: string,
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
    >("get_metadata", [
      ActionInput.fromObject({
        $key: key,
        $only_latest: onlyLatest,
        $ref: filteredRef,
      }),
    ]);
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
    visibility: VisibilityEnum,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      MetadataKey.ReadVisibilityKey,
      visibility.toString(),
    );
  }

  /**
   * Returns the read visibility of the stream
   */
  public async getReadVisibility(): Promise<VisibilityEnum | null> {
    const result = await this.getMetadata(MetadataKey.ReadVisibilityKey, true);

    return head(result)
      .map((row) => toVisibilityEnum(row.value))
      .unwrapOr(null);
  }

  /**
   * Sets the compose visibility of the stream
   */
  public async setComposeVisibility(
    visibility: VisibilityEnum,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      MetadataKey.ComposeVisibilityKey,
      visibility.toString(),
    );
  }

  /**
   * Returns the compose visibility of the stream
   */
  public async getComposeVisibility(): Promise<VisibilityEnum | null> {
    const result = await this.getMetadata(
      MetadataKey.ComposeVisibilityKey,
      true,
    );

    return head(result)
      .map((row) => toVisibilityEnum(row.value))
      .unwrapOr(null);
  }

  /**
   * Allows a wallet to read the stream
   */
  public async allowReadWallet(
    wallet: EthereumAddress,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.setMetadata(
      MetadataKey.AllowReadWalletKey,
      wallet.getAddress(),
    );
  }

  /**
   * Disables a wallet from reading the stream
   */
  public async disableReadWallet(
    wallet: EthereumAddress,
  ): Promise<GenericResponse<TxReceipt>> {
    const result = await this.getMetadata(
      MetadataKey.AllowReadWalletKey,
      true,
      wallet.getAddress(),
    );

    const row_id = head(result)
      .map((row) => row.rowId)
      .unwrapOr(null);

    if (!row_id) {
      throw new Error("Wallet not found in allowed list");
    }

    return await this.disableMetadata(row_id);
  }

  /**
   * Allows a stream to use this stream as child
   */
  public async allowComposeStream(
    locator: StreamLocator,
  ): Promise<GenericResponse<TxReceipt>> {
    const streamDbId = generateDBID(
      locator.dataProvider.getAddress(),
      locator.streamId.getId(),
    );
    return await this.setMetadata(
      MetadataKey.AllowComposeStreamKey,
      streamDbId,
    );
  }

  /**
   * Disables a stream from using this stream as child
   */
  public async disableComposeStream(
    locator: StreamLocator,
  ): Promise<GenericResponse<TxReceipt>> {
    const result = await this.getMetadata(
      MetadataKey.AllowComposeStreamKey,
      true,
      locator.toString(),
    );

    const row_id = head(result)
      .map((row) => row.rowId)
      .unwrapOr(null);

    if (!row_id) {
      throw new Error("Stream not found in allowed list");
    }

    return await this.disableMetadata(row_id);
  }

  protected async disableMetadata(
    rowId: string,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.execute("disable_metadata", [
      ActionInput.fromObject({
        $row_id: rowId,
      }),
    ]);
  }

  /**
   * Returns the wallets allowed to read the stream
   */
  public async getAllowedReadWallets(): Promise<EthereumAddress[]> {
    const result = await this.getMetadata(MetadataKey.AllowReadWalletKey);

    return result
      .filter((row) => row.value)
      .map((row) => new EthereumAddress(row.value));
  }

  /**
   * Returns the streams allowed to compose the stream
   */
  public async getAllowedComposeStreams(): Promise<StreamLocator[]> {
    const result = await this.getMetadata(MetadataKey.AllowComposeStreamKey);

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
    const result = await this.call<{ date_value: string; value: string }[]>(
      "get_index_change",
      [
        ActionInput.fromObject({
          $date_from: input.dateFrom,
          $date_to: input.dateTo,
          $frozen_at: input.frozenAt,
          $base_date: input.baseDate,
          $days_interval: input.daysInterval,
        }),
      ],
    );

    return result
      .mapRight((result) =>
        result.map((row) => ({
          dateValue: row.date_value,
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
    const result = await this.call<{ date_value: string; value: string }[]>(
      procedure,
      [
        ActionInput.fromObject({
          $date_from: input.dateFrom,
          $date_to: input.dateTo,
          $frozen_at: input.frozenAt,
          $base_date: input.baseDate,
        }),
      ],
    );
    return result
      .mapRight((result) =>
        result.map((row) => ({
          dateValue: row.date_value,
          value: row.value,
        })),
      )
      .throw();
  }
}
