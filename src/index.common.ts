// Core client types
export type { TNClientOptions } from "./client/client";
export type { SignerInfo as EthProvider } from "./client/client";

// Stream types and interfaces
export type { StreamLocator } from "./types/stream";
export type { StreamRecord } from "./contracts-api/stream";
export type { GetRecordInput, GetFirstRecordInput } from "./contracts-api/stream";
export type { InsertRecordInput } from "./contracts-api/primitiveStream";
export type { TaxonomySet, TaxonomyItem } from "./contracts-api/composedStream";

// Utility types and classes
export { StreamId } from "./util/StreamId";
export { EthereumAddress } from "./util/EthereumAddress";
export { visibility } from "./util/visibility";
export type { VisibilityEnum } from "./util/visibility";

// Stream type constants
export { StreamType } from "./contracts-api/contractValues";

// Base classes
export { Stream } from "./contracts-api/stream";
export { PrimitiveStream } from "./contracts-api/primitiveStream";
export { ComposedStream } from "./contracts-api/composedStream";

