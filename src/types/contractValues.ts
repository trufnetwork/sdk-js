import { EthereumAddress } from "../util/EthereumAddress";


export const StreamType = {
    Composed: "composed",
    Primitive: "primitive",
} as const;
export type StreamType = typeof StreamType[keyof typeof StreamType];

export const MetadataKey = {
    ReadonlyKey: "readonly_key",
    StreamOwner: "stream_owner",
    TypeKey: "type",
    ComposeVisibilityKey: "compose_visibility",
    ReadVisibilityKey: "read_visibility",
    AllowReadWalletKey: "allow_read_wallet",
    AllowComposeStreamKey: "allow_compose_stream",
} as const;
export type MetadataKey = typeof MetadataKey[keyof typeof MetadataKey];

export const MetadataType = {
    Int: "int",
    Bool: "bool",
    Float: "float",
    String: "string",
    Ref: "ref",
} as const;
export type MetadataType = typeof MetadataType[keyof typeof MetadataType];

export interface MetadataValue {
    value: number | boolean | string | EthereumAddress[];
}