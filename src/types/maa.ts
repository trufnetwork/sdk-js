/**
 * Modular Agent Address (MAA / "agent wallet") types.
 *
 * An MAA lets a token holder (the unrestricted owner/funder) delegate a limited set of actions to an
 * agent key (the restricted creator) that can operate the wallet but provably cannot move funds out. A
 * creator registers a rule once (immutable); any funder joins that rule to obtain a distinct,
 * deterministically-derived wallet address. Result fields mirror the on-chain getter columns
 * (migration 048): addresses and hashes are 0x-prefixed lowercase hex as returned by the node.
 */

import { Types } from "@trufnetwork/kwil-js";
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

/**
 * Parameters for joinAndFundAgentAddress (on-chain maa_join_and_fund): join a rule and fund the
 * derived wallet in one atomic transaction. The caller (signer) must already hold `amount` of the
 * bridged token on TN; both the join and the funding transfer commit together or not at all.
 */
export interface MAAJoinAndFundInput {
  /** 32-byte rule_id to join, as 0x-hex or raw bytes. */
  ruleId: MAABytesLike;
  /** Bridge identifier the funds are held under (e.g. "eth_truf" on mainnet, "hoodi_tt" on dev). */
  bridge: string;
  /** Funding amount in the token's base units, as a decimal string (must be greater than 0). */
  amount: string;
}

/**
 * Parameters for executeAgentAction (a maa_exec transaction: run an inner action AS the agent wallet).
 *
 * The signer is either the rule's restricted agent (running a delegated, allow-listed action) or the
 * unrestricted owner (e.g. withdrawing); the node rewrites @caller to maaAddress after checking the
 * rule's role and allow-list.
 */
export interface MAAExecuteInput {
  /** 20-byte agent-wallet (MAA) address to act as, as 0x-hex or raw bytes. */
  maaAddress: MAABytesLike;
  /** Inner action name to run as the wallet (must be allow-listed for the wallet's rule). */
  action: string;
  /** Positional arguments for the inner action (a single call). Omit for a no-arg action. */
  args?: Types.ValueType[];
  /** Inner action namespace; defaults to "main". */
  namespace?: string;
  /**
   * Optional per-argument type overrides, parallel to args. A maa_exec payload is not schema-validated
   * before broadcast, so NUMERIC/UUID/BYTEA arguments that can't be inferred from a plain JS value need
   * an explicit type (e.g. Utils.DataType.Numeric(...)). Omit to let each type be inferred from the value.
   */
  types?: Types.MAAExecBody["types"];
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
