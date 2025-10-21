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
export { deployStream } from "./contracts-api/deployStream";
export { deleteStream } from "./contracts-api/deleteStream";

// Utility classes
export { StreamId } from "./util/StreamId";
export { EthereumAddress } from "./util/EthereumAddress";
export { visibility } from "./util/visibility";

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

// Visibility types
export type { VisibilityEnum } from "./util/visibility";