// Core client types
export type { TNClientOptions } from "./client/client";
export type { SignerInfo as EthProvider } from "./client/client";

// Stream types and interfaces
export type { StreamLocator } from "./types/stream";
export type { StreamRecord } from "./contracts-api/action";
export type { GetRecordInput, GetFirstRecordInput } from "./contracts-api/action";
export type { InsertRecordInput } from "./contracts-api/primitiveAction";
export type { TaxonomySet, TaxonomyItem } from "./contracts-api/composedAction";

// Utility types and classes
export { StreamId } from "./util/StreamId";
export { EthereumAddress } from "./util/EthereumAddress";
export { visibility } from "./util/visibility";
export type { VisibilityEnum } from "./util/visibility";

// Stream type constants
export { StreamType } from "./contracts-api/contractValues";

// Base classes
export { Action } from "./contracts-api/action";
export { PrimitiveAction } from "./contracts-api/primitiveAction";
export { ComposedAction } from "./contracts-api/composedAction";

