/**
 * Modular Agent Address (MAA / "agent wallet") action wrappers.
 *
 * These wrap the on-chain rule store (migration 048). The two write actions (createAgentRule,
 * joinAgentAddress) derive their result address OFF-CHAIN with the shared keccak derivation
 * (util/MAAAddress.ts), so the caller learns the rule_id / wallet address immediately — before the
 * wallet is funded — rather than waiting on the transaction. The read methods expose the public
 * transparency surface (rule terms, allow-list, the wallet's two component keys, audit log).
 */

import { KwilSigner, NodeKwil, Types, Utils, WebKwil } from "@trufnetwork/kwil-js";
import { getBytes, hexlify } from "ethers";
import { Action } from "./action";
import { MAAAddress, MAABytesLike } from "../util/MAAAddress";
import {
  MAAAllowedAction,
  MAACreateRuleInput,
  MAACreateRuleResult,
  MAAEvent,
  MAAExecuteInput,
  MAAInstance,
  MAAJoinAndFundInput,
  MAAJoinResult,
  MAAOwnedWallet,
  MAARule,
  MAARuleRef,
  MAARuleWallet,
} from "../types/maa";

function toBytes(value: MAABytesLike | null | undefined): Uint8Array {
  if (value == null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  let hex = value.trim();
  if (hex === "") return new Uint8Array(0);
  if (!hex.startsWith("0x") && !hex.startsWith("0X")) hex = "0x" + hex;
  return getBytes(hex);
}

const asText = (v: any): string => (v === null || v === undefined ? "" : String(v));
const asTextOrNull = (v: any): string | null => (v === null || v === undefined ? null : String(v));
const asNumber = (v: any): number => (typeof v === "number" ? v : parseInt(String(v), 10));
const asBool = (v: any): boolean => v === true || v === "true";

export class MAAAction extends Action {
  /** The caller's own 0x-hex address; supplied by the client so writes can derive their result locally. */
  private readonly callerAddress?: string;

  constructor(kwilClient: WebKwil | NodeKwil, kwilSigner: KwilSigner, callerAddress?: string) {
    super(kwilClient, kwilSigner);
    this.callerAddress = callerAddress;
  }

  /**
   * createAgentRule registers an agent-wallet rule. The caller (signer) becomes the restricted agent.
   * Returns the locally-derived rule_id (the handle a funder passes to joinAgentAddress) and the
   * submission tx hash. The rule is immutable once created; no funds move here.
   */
  async createAgentRule(input: MAACreateRuleInput): Promise<MAACreateRuleResult> {
    if (input.feeMode !== "bps" && input.feeMode !== "flat") {
      throw new Error("feeMode must be 'bps' or 'flat'");
    }
    const feeBps = input.feeBps ?? 0;
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
      throw new Error(`feeBps must be between 0 and 10000 (10000 = 100%), got ${feeBps}`);
    }
    const feeFlat = input.feeFlat ?? "0";
    const namespaces = input.namespaces ?? [];
    const actions = input.actions ?? [];

    // Build the body_hashes array parallel to namespaces/actions: an empty Uint8Array element is the
    // kwil-js encoding for a NULL (unpinned) bytea element, matching the on-chain "unpinned" entry.
    const bodyHashesIn = input.bodyHashes ?? [];
    const bodyHashes: Uint8Array[] =
      namespaces.length === 0 ? [] : namespaces.map((_, i) => toBytes(bodyHashesIn[i]));

    // Derive the rule_id locally from the same inputs the chain hashes (caller = restricted agent).
    const restricted = this.ownerBytes();
    const rulesHash = MAAAddress.computeRulesHash(input.feeMode, feeBps, feeFlat, namespaces, actions, bodyHashes);
    const ruleId = MAAAddress.deriveRuleId(restricted, rulesHash, input.salt ?? null);

    const params: Types.NamedParams[] = [
      {
        $salt: toBytes(input.salt),
        $fee_mode: input.feeMode,
        $fee_bps: feeBps,
        $fee_flat: feeFlat,
        $namespaces: namespaces,
        $actions: actions,
        $body_hashes: bodyHashes,
      },
    ];
    const types = { $fee_flat: Utils.DataType.Numeric(78, 0) };

    const result = await this.executeWithNamedParams("maa_create_rule", params, types);
    const txHash = result.data?.tx_hash;
    if (!txHash) {
      throw new Error("createAgentRule: no transaction hash returned");
    }
    return { txHash, ruleId, ruleIdHex: hexlify(ruleId) };
  }

  /**
   * joinAgentAddress joins an existing rule as the unrestricted owner/funder. The caller (signer) becomes
   * the owner. Returns the locally-derived MAA address (the wallet to fund) and the submission tx hash.
   * The rule's restricted creator is looked up on-chain to derive the address.
   */
  async joinAgentAddress(ruleId: MAABytesLike): Promise<MAAJoinResult> {
    const idBytes = toBytes(ruleId);
    if (idBytes.length !== 32) {
      throw new Error(`rule_id must be 32 bytes, got ${idBytes.length}`);
    }
    const unrestricted = this.ownerBytes();

    // Resolve the rule's restricted creator so the wallet can be derived locally (also validates the rule).
    const rule = await this.getRule(idBytes);
    if (!rule) {
      throw new Error("unknown rule_id");
    }
    const maaAddress = MAAAddress.deriveMAAAddress(unrestricted, rule.restricted, idBytes);

    const result = await this.executeWithNamedParams("maa_join", [{ $rule_id: idBytes }]);
    const txHash = result.data?.tx_hash;
    if (!txHash) {
      throw new Error("joinAgentAddress: no transaction hash returned");
    }
    return { txHash, maaAddress, maaAddressHex: hexlify(maaAddress) };
  }

  /**
   * joinAndFundAgentAddress joins a rule and funds the derived agent wallet in one atomic transaction:
   * the caller (signer) becomes the owner and, in the same on-chain action, transfers `amount` of the
   * chosen bridged token from their own balance into the new wallet. Either both legs commit or neither
   * does, so activation cannot strand a joined-but-unfunded wallet — unlike a joinAgentAddress followed
   * by a separate transfer. Returns the locally-derived MAA address and the submission tx hash.
   *
   * The caller must already hold at least `amount` of `bridge` on TN (funds arriving from L1 are a
   * bridge deposit, which is a separate cross-chain step). Requires the on-chain maa_join_and_fund
   * action (node migration 054) to be deployed on the target network.
   */
  async joinAndFundAgentAddress(input: MAAJoinAndFundInput): Promise<MAAJoinResult> {
    const idBytes = toBytes(input.ruleId);
    if (idBytes.length !== 32) {
      throw new Error(`rule_id must be 32 bytes, got ${idBytes.length}`);
    }
    if (!input.bridge || input.bridge.trim() === "") {
      throw new Error("bridge is required");
    }
    // Same positive-integer-base-units contract as the bridged-token transfer.
    if (!/^[0-9]+$/.test(input.amount) || BigInt(input.amount) <= 0n) {
      throw new Error(`Invalid amount: ${input.amount}. Amount must be greater than 0.`);
    }
    const unrestricted = this.ownerBytes();

    // Resolve the rule's restricted creator so the wallet can be derived locally (also validates the rule).
    const rule = await this.getRule(idBytes);
    if (!rule) {
      throw new Error("unknown rule_id");
    }
    const maaAddress = MAAAddress.deriveMAAAddress(unrestricted, rule.restricted, idBytes);

    // $amount is NUMERIC(78,0) on-chain; pin it so a plain JS string isn't inferred as text.
    const result = await this.executeWithNamedParams(
      "maa_join_and_fund",
      [{ $rule_id: idBytes, $bridge: input.bridge, $amount: input.amount }],
      { $amount: Utils.DataType.Numeric(78, 0) },
    );
    const txHash = result.data?.tx_hash;
    if (!txHash) {
      throw new Error("joinAndFundAgentAddress: no transaction hash returned");
    }
    return { txHash, maaAddress, maaAddressHex: hexlify(maaAddress) };
  }

  /**
   * executeAgentAction runs one allow-listed action AS the agent wallet (a maa_exec transaction). The
   * signer is the rule's restricted agent (a delegated action) or the unrestricted owner (e.g. a
   * withdrawal); the node rewrites @caller to the wallet after verifying the rule's role and allow-list.
   * Returns the submission tx hash (parity with createAgentRule/joinAgentAddress and the Go/Python SDKs).
   *
   * The network must have activated maa_exec; before activation the node rejects the payload with an
   * "unknown payload type" error, surfaced verbatim.
   */
  async executeAgentAction(input: MAAExecuteInput): Promise<string> {
    const maaAddress = toBytes(input.maaAddress);
    if (maaAddress.length !== 20) {
      throw new Error(`maa_address must be 20 bytes, got ${maaAddress.length}`);
    }
    if (!input.action) {
      throw new Error("action must not be empty");
    }

    const result = await this.kwilClient.maaExec(
      {
        maaAddress,
        namespace: input.namespace ?? "main",
        action: input.action,
        inputs: input.args ?? [],
        types: input.types,
      },
      this.kwilSigner,
    );

    const txHash = result.data?.tx_hash;
    if (!txHash) {
      throw new Error("executeAgentAction: no transaction hash returned");
    }
    return txHash;
  }

  /** getRule returns a rule's terms (maa_get_rule), or null if no such rule exists. */
  async getRule(ruleId: MAABytesLike): Promise<MAARule | null> {
    const rows = await this.callRows("maa_get_rule", { $rule_id: toBytes(ruleId) });
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      ruleId: asText(r.rule_id),
      restricted: asText(r.restricted_addr),
      rulesHash: asText(r.rules_hash),
      feeMode: asText(r.fee_mode),
      feeBps: asNumber(r.fee_bps),
      feeFlat: asText(r.fee_flat),
      createdAt: asNumber(r.created_at),
    };
  }

  /** getAllowedActions returns a rule's allow-list (maa_get_allowed_actions), in canonical order. */
  async getAllowedActions(ruleId: MAABytesLike): Promise<MAAAllowedAction[]> {
    const rows = await this.callRows("maa_get_allowed_actions", { $rule_id: toBytes(ruleId) });
    return rows.map((r) => ({
      namespace: asText(r.namespace),
      action: asText(r.action),
      bodyHash: asTextOrNull(r.body_hash),
    }));
  }

  /** getInstance returns an agent wallet and its two component keys (maa_get_instance), or null if unknown. */
  async getInstance(maaAddress: MAABytesLike): Promise<MAAInstance | null> {
    const rows = await this.callRows("maa_get_instance", { $maa_address: toBytes(maaAddress) });
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      maaAddress: asText(r.maa_address),
      ruleId: asText(r.rule_id),
      restricted: asText(r.restricted_addr),
      unrestricted: asText(r.unrestricted_addr),
      createdAt: asNumber(r.created_at),
    };
  }

  /** listRulesByRestricted lists the rules an agent created (maa_list_by_restricted). agent is a 0x-hex address. */
  async listRulesByRestricted(agent: string, limit = 100, offset = 0): Promise<MAARuleRef[]> {
    const rows = await this.callRows("maa_list_by_restricted", { $agent: agent, $limit: limit, $offset: offset });
    return rows.map((r) => ({ ruleId: asText(r.rule_id), createdAt: asNumber(r.created_at) }));
  }

  /** listWalletsByOwner lists the wallets an owner funded (maa_list_by_unrestricted). owner is a 0x-hex address. */
  async listWalletsByOwner(owner: string, limit = 100, offset = 0): Promise<MAAOwnedWallet[]> {
    const rows = await this.callRows("maa_list_by_unrestricted", { $owner: owner, $limit: limit, $offset: offset });
    return rows.map((r) => ({
      maaAddress: asText(r.maa_address),
      ruleId: asText(r.rule_id),
      createdAt: asNumber(r.created_at),
    }));
  }

  /** listWalletsByRule lists every wallet funded under a rule (maa_list_instances_by_rule). */
  async listWalletsByRule(ruleId: MAABytesLike, limit = 100, offset = 0): Promise<MAARuleWallet[]> {
    const rows = await this.callRows("maa_list_instances_by_rule", {
      $rule_id: toBytes(ruleId),
      $limit: limit,
      $offset: offset,
    });
    return rows.map((r) => ({
      maaAddress: asText(r.maa_address),
      unrestricted: asText(r.unrestricted_addr),
      createdAt: asNumber(r.created_at),
    }));
  }

  /** getEvents returns a rule's append-only audit log (maa_get_events). */
  async getEvents(ruleId: MAABytesLike, limit = 100, offset = 0): Promise<MAAEvent[]> {
    const rows = await this.callRows("maa_get_events", { $rule_id: toBytes(ruleId), $limit: limit, $offset: offset });
    return rows.map((r) => ({
      id: asNumber(r.id),
      maaAddress: asTextOrNull(r.maa_address),
      eventType: asText(r.event_type),
      actorRole: asText(r.actor_role),
      actorAddr: asText(r.actor_addr),
      innerNamespace: asTextOrNull(r.inner_namespace),
      innerAction: asTextOrNull(r.inner_action),
      amount: asTextOrNull(r.amount),
      txHash: asText(r.tx_hash),
      blockHeight: asNumber(r.block_height),
      blockTimestamp: asNumber(r.block_timestamp),
    }));
  }

  /** isAgentWallet reports whether an address is a known (joined) agent wallet (maa_is_known). */
  async isAgentWallet(maaAddress: MAABytesLike): Promise<boolean> {
    const rows = await this.callRows("maa_is_known", { $maa_address: toBytes(maaAddress) });
    if (rows.length === 0) return false;
    return asBool(rows[0].known);
  }

  /** callRows calls a VIEW action and unwraps the row array (throws on a non-200 status). */
  private async callRows(method: string, inputs: Types.NamedParams): Promise<any[]> {
    const result = await this.call<any[]>(method, inputs);
    if (result.isLeft()) {
      throw new Error(`${method} failed: HTTP status ${(result as any).value}`);
    }
    const rv: any = typeof (result as any).value === "function" ? (result as any).value() : (result as any).value;
    return Array.isArray(rv) ? rv : [];
  }

  /** ownerBytes resolves the caller's 20-byte address for local derivation of write results. */
  private ownerBytes(): Uint8Array {
    const id: any = this.callerAddress ?? (this.kwilSigner as any)?.identifier;
    if (id instanceof Uint8Array && id.length === 20) return id;
    if (typeof id === "string" && id.length > 0) {
      return getBytes(id.startsWith("0x") ? id : "0x" + id);
    }
    throw new Error("cannot determine caller address; construct MAAAction with a callerAddress");
  }
}
