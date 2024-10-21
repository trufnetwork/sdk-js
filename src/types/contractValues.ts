import { EthereumAddress } from "../util/types";

export type StreamType = "composed" | "primitive";

export type MetadataKey =
    | "readonly_key"
    | "stream_owner"
    | "type"
    | "compose_visibility"
    | "read_visibility"
    | "allow_read_wallet"
    | "allow_compose_stream";

export type MetadataType = "int" | "bool" | "float" | "string" | "ref";

export interface MetadataValue {
    value: number | boolean | string | EthereumAddress[];
}