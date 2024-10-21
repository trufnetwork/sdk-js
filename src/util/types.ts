
export type VisibilityEnum = number & { __brand: "VisibilityEnum" };

export const PublicVisibility: VisibilityEnum = 0 as VisibilityEnum;
export const PrivateVisibility: VisibilityEnum = 1 as VisibilityEnum;

export type EthereumAddress = string & { __brand: "EthereumAddress" };
export type StreamId = string & { __brand: "StreamId" };
