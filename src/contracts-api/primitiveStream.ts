import {KwilSigner, NodeKwil, WebKwil} from "@kwilteam/kwil-js";
import {ActionInput, NamedParams} from "@kwilteam/kwil-js/dist/core/action";
import {GenericResponse} from "@kwilteam/kwil-js/dist/core/resreq";
import {TxReceipt} from "@kwilteam/kwil-js/dist/core/tx";
import {StreamType} from "./contractValues";
import {Stream} from "./stream";
import {StreamLocator} from "../types/stream";

const ErrorStreamNotPrimitive = "stream is not a primitive stream";

export class PrimitiveStream extends Stream {
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ) {
    super(kwilClient, kwilSigner);
  }

  /**
   * Checks if the stream is a valid primitive stream.
   * A valid primitive stream must be:
   * - initialized
   * - of type primitive
   */
  private async checkValidPrimitiveStream(): Promise<void> {
    // Then check if is primitive
    const streamType = await this.getType();
    if (streamType !== StreamType.Primitive) {
      throw new Error(ErrorStreamNotPrimitive);
    }
  }

  /**
   * Insert a record into the stream
   * @param input of a single record to insert
   * @returns Transaction receipt
   */
  public async insertRecord(
      input: InsertRecordInput,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.execute("insert_record", [{
      $data_provider: input.stream.dataProvider.getAddress(),
      $stream_id: input.stream.streamId.getId(),
      $event_time: input.eventTime,
      $value: input.value
    }]);
  }

    /**
     * Inserts records into the stream
     * @param inputs Array of records to insert
     * @returns Transaction receipt
     */
    public async insertRecords(
        inputs: InsertRecordInput[],
    ): Promise<GenericResponse<TxReceipt>> {
        return await this.execute("insert_records", inputs.map((input) => ({
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $event_time: input.eventTime,
          $value: input.value,
        })));
  }

  /**
   * Creates a PrimitiveStream from a base Stream
   * @param stream The base stream to convert
   * @returns A Promise that resolves to a PrimitiveStream instance
   */
  public static fromStream(stream: Stream): PrimitiveStream {
    return new PrimitiveStream(
        stream["kwilClient"],
        stream["kwilSigner"],
    );
  }
}

export interface InsertRecordInput {
  stream: StreamLocator;
  eventTime: number;
  // value is a string to support arbitrary precision
  value: string;
}
