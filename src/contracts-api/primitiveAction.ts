import {KwilSigner, NodeKwil, Utils, WebKwil} from "@kwilteam/kwil-js";
import {GenericResponse} from "@kwilteam/kwil-js/dist/core/resreq";
import {TxReceipt} from "@kwilteam/kwil-js/dist/core/tx";
import {StreamType} from "./contractValues";
import {Action} from "./action";
import {StreamLocator} from "../types/stream";
import DataType = Utils.DataType;

const ErrorStreamNotPrimitive = "stream is not a primitive stream";

export class PrimitiveAction extends Action {
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
  ) {
    super(kwilClient, kwilSigner);
  }

  /**
   * Insert a record into the stream
   * @param input of a single record to insert
   * @returns Transaction receipt
   */
  public async insertRecord(
      input: InsertRecordInput,
  ): Promise<GenericResponse<TxReceipt>> {
    return await this.executeWithActionBody({
          namespace: 'main',
          name: 'insert_record',
          inputs: [{
            $data_provider: input.stream.dataProvider.getAddress(),
            $stream_id: input.stream.streamId.getId(),
            $event_time: input.eventTime,
            $value: input.value
          }],
          types: {
            $data_provider: DataType.Text,
            $stream_id: DataType.Text,
            $event_time: DataType.Int,
            $value: DataType.Numeric(36, 18)
          }
    })
  }

    /**
     * Inserts records into the stream
     * @param inputs Array of records to insert
     * @param synchronous If true, the transaction will be executed synchronously
     * @returns Transaction receipt
     */
    public async insertRecords(
        inputs: InsertRecordInput[],
        synchronous?: boolean,
    ): Promise<GenericResponse<TxReceipt>> {
      return await this.executeWithActionBody({
        namespace: 'main',
        name: 'insert_records',
        inputs: inputs.map((input) => ({
          $data_provider: input.stream.dataProvider.getAddress(),
          $stream_id: input.stream.streamId.getId(),
          $event_time: input.eventTime,
          $value: input.value
        })),
        types: {
          $data_provider: DataType.TextArray,
          $stream_id: DataType.TextArray,
          $event_time: DataType.IntArray,
          $value: DataType.NumericArray(36, 18)
        }
      }, synchronous)
    }

  /**
   * Creates a PrimitiveStream from a base Stream
   * @param stream The base stream to convert
   * @returns A Promise that resolves to a PrimitiveStream instance
   */
  public static fromStream(stream: Action): PrimitiveAction {
    return new PrimitiveAction(
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
