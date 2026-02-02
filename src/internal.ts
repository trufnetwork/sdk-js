/**
 * Internal module to manage exports and break circular dependencies
 * This centralizes all exports to prevent circular import issues
 */

// Base client and types
export { BaseTNClient } from "./client/client";
export type { TNClientOptions, SignerInfo, ListStreamsInput, GetLastTransactionsInput } from "./client/client";

// Contract APIs
export { Action } from "./contracts-api/action";
export { PrimitiveAction } from "./contracts-api/primitiveAction";
export { ComposedAction } from "./contracts-api/composedAction";
export { RoleManagement } from "./contracts-api/roleManagement";
export { AttestationAction } from "./contracts-api/attestationAction";
export { OrderbookAction } from "./contracts-api/orderbookAction";
export { deployStream } from "./contracts-api/deployStream";
export { deleteStream } from "./contracts-api/deleteStream";

// Utility classes
export { StreamId } from "./util/StreamId";
export { EthereumAddress } from "./util/EthereumAddress";
export { visibility } from "./util/visibility";

// Attestation encoding/decoding utilities
export {
  parseAttestationPayload
} from "./util/AttestationEncoding";

export type {
  DecodedRow,
  ParsedAttestationPayload
} from "./util/AttestationEncoding";

// Contract values and types
export { StreamType } from "./contracts-api/contractValues";

// Stream types
export type { StreamLocator } from "./types/stream";

// Action types
export type {
  StreamRecord,
  ListMetadataByHeightParams,
  MetadataQueryResult,
  GetRecordInput,
  GetFirstRecordInput
} from "./contracts-api/action";

// Primitive action types
export type { InsertRecordInput } from "./contracts-api/primitiveAction";

// Composed action types
export type {
  TaxonomySet,
  TaxonomyItem,
  ListTaxonomiesByHeightParams,
  GetTaxonomiesForStreamsParams,
  TaxonomyQueryResult
} from "./contracts-api/composedAction";

// Role management types
export type {
  GrantRoleInput,
  RevokeRoleInput,
  AreMembersOfInput,
  WalletMembership
} from "./types/role";

// Attestation types
export type {
  RequestAttestationInput,
  RequestAttestationResult,
  GetSignedAttestationInput,
  SignedAttestationResult,
  ListAttestationsInput,
  AttestationMetadata
} from "./types/attestation";

// Bridge types
export type { WithdrawalProof } from "./types/bridge";

// Visibility types
export type { VisibilityEnum } from "./util/visibility";

// Orderbook types
export type {
  BridgeIdentifier,
  MarketInfo,
  MarketSummary,
  MarketValidation,
  OrderBookEntry,
  UserPosition,
  DepthLevel,
  BestPrices,
  UserCollateral,
  DistributionSummary,
  LPRewardDetail,
  RewardHistory,
  CreateMarketInput,
  PlaceOrderInput,
  PlaceSplitLimitOrderInput,
  CancelOrderInput,
  ChangeBidInput,
  ChangeAskInput,
  ListMarketsInput,
  BaseBinaryMarketInput,
  CreatePriceThresholdMarketInput,
  CreateValueInRangeMarketInput,
  CreateValueEqualsMarketInput,
} from "./types/orderbook";

// Orderbook helper utilities
export {
  encodeActionArgs,
  encodeQueryComponents,
  encodeRangeActionArgs,
  encodeEqualsActionArgs,
  hexToBytes,
  bytesToHex,
} from "./util/orderbookHelpers";