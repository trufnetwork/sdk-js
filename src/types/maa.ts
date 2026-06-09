/**
 * Modular Agent Address (MAA / "agent wallet") types.
 *
 * An MAA lets a token holder (the unrestricted owner/funder) delegate a limited set of actions to an
 * agent key (the restricted creator) that can operate the wallet but provably cannot move funds out. A
 * creator registers a rule once (immutable); any funder joins that rule to obtain a distinct,
 * deterministically-derived wallet address. Result fields mirror the on-chain getter columns
 * (migration 048): addresses and hashes are 0x-prefixed lowercase hex as returned by the node.
 */

import { MAABytesLike } from "../util/MAAAddress";

/** Parameters for createAgentRule (on-chain maa_create_rule). */
export interface MAACreateRuleInput {
  /** Rule nonce; may be omitted. Lets one creator register several distinct rules. */
  salt?: MAABytesLike | null;
  /** "bps" or "flat". */
  feeMode: "bps" | "flat";
  /** 0..10000 (10000 = 100%); used when feeMode === "bps". Defaults to 0. */
  feeBps?: number;
  /** Base-unit decimal string; used when feeMode === "flat". Defaults to "0". */
  feeFlat?: string;
  /** Allow-list: parallel arrays with actions and bodyHashes. */
  namespaces?: string[];
  actions?: string[];
  /** Optional per-entry body-hash pins; a null/omitted element is unpinned. */
  bodyHashes?: (MAABytesLike | null)[] | null;
}

/** Result of createAgentRule: the locally-derived rule_id plus the submission tx hash. */
export interface MAACreateRuleResult {
  txHash: string;
  ruleId: Uint8Array;
  ruleIdHex: string;
}

/** Result of joinAgentAddress: the locally-derived MAA address (to fund) plus the submission tx hash. */
export interface MAAJoinResult {
  txHash: string;
  maaAddress: Uint8Array;
  maaAddressHex: string;
}

/** A rule's terms (maa_get_rule). */
export interface MAARule {
  ruleId: string;
  restricted: string;
  rulesHash: string;
  feeMode: string;
  feeBps: number;
  feeFlat: string;
  createdAt: number;
}

/** One allow-list entry (maa_get_allowed_actions). bodyHash is null when unpinned. */
export interface MAAAllowedAction {
  namespace: string;
  action: string;
  bodyHash: string | null;
}

/** An agent wallet and its two component keys (maa_get_instance). */
export interface MAAInstance {
  maaAddress: string;
  ruleId: string;
  restricted: string;
  unrestricted: string;
  createdAt: number;
}

/** A rule created by an agent (maa_list_by_restricted). */
export interface MAARuleRef {
  ruleId: string;
  createdAt: number;
}

/** A wallet an owner funded (maa_list_by_unrestricted). */
export interface MAAOwnedWallet {
  maaAddress: string;
  ruleId: string;
  createdAt: number;
}

/** A wallet under a rule (maa_list_instances_by_rule). */
export interface MAARuleWallet {
  maaAddress: string;
  unrestricted: string;
  createdAt: number;
}

/** One append-only audit row (maa_get_events). */
export interface MAAEvent {
  id: number;
  maaAddress: string | null;
  eventType: string;
  actorRole: string;
  actorAddr: string;
  innerNamespace: string | null;
  innerAction: string | null;
  amount: string | null;
  txHash: string;
  blockHeight: number;
  blockTimestamp: number;
}
