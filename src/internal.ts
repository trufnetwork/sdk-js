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
export { TransactionAction } from "./contracts-api/transactionAction";
export { MAAAction } from "./contracts-api/maaActions";
export { deployStream } from "./contracts-api/deployStream";
export { deleteStream } from "./contracts-api/deleteStream";
export { LocalActions, type LocalActionsOptions } from "./contracts-api/localActions";

// Utility classes
export { StreamId } from "./util/StreamId";
export { EthereumAddress } from "./util/EthereumAddress";
export { MAAAddress } from "./util/MAAAddress";
export type { MAABytesLike } from "./util/MAAAddress";
export { visibility } from "./util/visibility";

// Attestation encoding/decoding utilities
export {
  parseAttestationPayload,
  decodeActionArgs,
  decodeQueryComponents,
  isBinaryAction,
} from "./util/AttestationEncoding";

export type {
  DecodedRow,
  ParsedAttestationPayload
} from "./util/AttestationEncoding";

// Transaction payload decoding
export { decodeTransactionPayload } from "./util/TransactionPayload";
export type { DecodedTransactionPayload } from "./util/TransactionPayload";

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
export type {
  WithdrawalProof,
  BridgeHistory,
  BalanceToken,
  OrderedBalancesOptions,
  TokenBalance,
} from "./types/bridge";

// Transaction ledger types
export type {
  LastTransaction,
  FeeDistribution,
  TransactionEvent,
  GetTransactionEventInput,
  TransactionFeeMode,
  ListTransactionFeesInput,
  TransactionFeeEntry,
} from "./types/transaction";

// Agent-wallet (Modular Agent Address) types
export type {
  MAACreateRuleInput,
  MAACreateRuleResult,
  MAAJoinResult,
  MAAJoinAndFundInput,
  MAAExecuteInput,
  MAARule,
  MAAAllowedAction,
  MAAInstance,
  MAARuleRef,
  MAAOwnedWallet,
  MAARuleWallet,
  MAAEvent,
} from "./types/maa";

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
  WalletPosition,
  DepthLevel,
  BestPrices,
  ConsolidatedLevel,
  ConsolidatedOrderBook,
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
  decodeMarketData,
  decodeCreateMarketPayload,
} from "./util/orderbookHelpers";

export type {
  MarketData,
  DecodedMarketData,
  CreateMarketPayload,
} from "./util/orderbookHelpers";

// Market forecasting: the single value a market's bucket order books imply.
export {
  bucketProbability,
  bucketEstimateFromDepth,
  typicalHalfSpread,
  forecastFromBuckets,
  forecastFromDepth,
  consolidatedBids,
  consolidatedAsks,
  bestView,
  usableBid,
  usableAsk,
  forecastToJSON,
  DEPTH_MIN_SIDE_NOTIONAL_USD,
  LOW_TOTAL_NOTIONAL_WARN_USD,
  MIN_QUOTE_NOTIONAL_CENT_SHARES,
  PEAK_PROMINENCE,
} from "./util/forecast";

export type {
  BookLevel,
  BucketBook,
  BucketDepth,
  BucketEstimate,
  BucketQuoteEstimate,
  BucketDepthEstimate,
  MarketForecast,
  MarketForecastJSON,
  ForecastBasis,
  ForecastMethod,
} from "./util/forecast";

export { bucketBoundsFromMarketData } from "./util/marketBuckets";
export type { BucketBounds } from "./util/marketBuckets";

// Consolidating a market's two outcome books into one executable ladder.
export {
  consolidateSide,
  inversePrice,
  depthBids,
  depthAsks,
} from "./util/consolidatedBook";
export type { BookSide } from "./util/consolidatedBook";

// Local actions types
export type {
  ILocalActions,
  LocalCreateStreamInput,
  LocalInsertRecordsInput,
  LocalInsertTaxonomyInput,
  LocalGetRecordInput,
  LocalGetIndexInput,
  LocalDeleteStreamInput,
  LocalDisableTaxonomyInput,
  LocalRecordOutput,
  LocalIndexOutput,
  LocalStreamInfo,
} from "./types/localActions";

// Admin transport (re-exported from kwil-js for local stream operations).
// Browser bundles ignore AdminClient — it throws if instantiated outside Node.
export { AdminClient } from "@trufnetwork/kwil-js";
import type { Types as KwilTypes } from "@trufnetwork/kwil-js";
export type AdminClientConfig = KwilTypes.AdminClientConfig;