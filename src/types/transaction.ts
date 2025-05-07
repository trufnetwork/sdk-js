export interface LastTransaction {
    /** Block height */
    blockHeight: number;
    /** Which action was taken */
    method: string;
    /** Address that sent the on‐chain tx */
    sender: string;
    /** Hash of the on‐chain transaction */
    transactionHash: string;
}
