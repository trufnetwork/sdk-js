import { GenericResponse } from "@kwilteam/kwil-js/dist/core/resreq";
import { IStream } from "./stream";
import { TxReceipt } from "@kwilteam/kwil-js/dist/core/tx";

export interface IPrimitiveStream extends IStream {
    /**
     * inserts records into the stream
     */
    insertRecords(inputs: InsertRecordInput[]): Promise<GenericResponse<TxReceipt>>;
}

export interface InsertRecordInput {
    dateValue: Date;
    // value is a string to support arbitrary precision
    value: string;
}

