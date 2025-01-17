import { KwilSigner, NodeKwil, WebKwil } from "@kwilteam/kwil-js";
import { ActionInput } from "@kwilteam/kwil-js/dist/core/action";
import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";
import { StreamType } from "./contractValues";
import { StreamLocator } from "../types/stream";
import { Stream } from "./stream";

const ErrorStreamNotPrimitive = "stream is not a primitive stream";

export class PrimitiveStream extends Stream {
  constructor(
    kwilClient: WebKwil | NodeKwil,
    kwilSigner: KwilSigner,
    locator: StreamLocator,
  ) {
    super(kwilClient, kwilSigner, locator);
  }

  /**
   * Checks if the stream is a valid primitive stream.
   * A valid primitive stream must be:
   * - initialized
   * - of type primitive
   */
  private async checkValidPrimitiveStream(): Promise<void> {
    // First check if initialized
    await this.checkInitialized(StreamType.Primitive);

    // Then check if is primitive
    const streamType = await this.getType();
    if (streamType !== StreamType.Primitive) {
      throw new Error(ErrorStreamNotPrimitive);
    }
  }

  /**
   * Executes a method after checking if the stream is a valid primitive stream
   * @param method The method name to execute
   * @param inputs The inputs for the action
   * @returns A generic response containing the transaction receipt
   */
  private async checkedPrimitiveExecute(
    method: string,
    inputs: ActionInput[],
  ): Promise<GenericResponse<TxReceipt>> {
    await this.checkValidPrimitiveStream();
    return this.execute(method, inputs);
  }

  /**
   * Inserts records into the stream
   * @param inputs Array of records to insert
   * @returns Transaction receipt
   */
  public async insertRecords(
    inputs: InsertRecordInput[],
  ): Promise<GenericResponse<TxReceipt>> {
    await this.checkValidPrimitiveStream();

    const actionInputs = inputs.map((input) =>
      ActionInput.fromObject({
        $date_value: input.dateValue,
        $value: input.value,
      }),
    );

    return await this.checkedPrimitiveExecute("insert_record", actionInputs);
  }

  /**
   * Creates a PrimitiveStream from a base Stream
   * @param stream The base stream to convert
   * @returns A Promise that resolves to a PrimitiveStream instance
   */
  public static fromStream(stream: Stream): PrimitiveStream {
    const primitiveStream = new PrimitiveStream(
      stream["kwilClient"],
      stream["kwilSigner"],
      stream["locator"],
    );

    return primitiveStream;
  }
}
export interface InsertRecordInput {
  dateValue: string | number;
  // value is a string to support arbitrary precision
  value: string;
}
