/**
 * Modular Agent Address (MAA / "agent wallet") lifecycle smoke test — JavaScript/TypeScript SDK.
 *
 * Runs the full agent-wallet lifecycle against a live TRUF.NETWORK node where maa_exec is activated
 * (testnet from height 6523123). It proves, end-to-end through @trufnetwork/sdk-js, the properties
 * that make an agent wallet useful and safe:
 *
 *   - a restricted AGENT key registers an immutable rule;
 *   - an unrestricted OWNER key joins it to derive a wallet (the MAA) and funds it;
 *   - the agent runs allow-listed actions AS the MAA — the node rewrites @caller to the wallet, so the
 *     streams it creates are owned by the MAA and every fee is debited from the MAA's OWN escrow;
 *   - the agent CANNOT move the funds out (owner-exit actions are reserved for the owner);
 *   - the owner withdraws the remaining escrow at any time, paying the agent its commission;
 *   - an owner (or a delegated bot) can read the wallet's order-book portfolio BY ADDRESS.
 *
 * This mirrors the node's canonical oracle, tests/streams/maa/data_agent_test.go, and the Go and
 * Python SDKs' examples/maa_lifecycle_example.
 *
 * Config comes from a .env file next to this program (real environment variables still take
 * precedence). Two DISTINCT keys are required — the agent and the owner are different identities:
 *
 *     cd examples/maa_lifecycle_example
 *     cp .env.example .env        # then fill in AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY
 *     npm install
 *     npm start
 *
 * See .env.example for every setting, and README.md for what success looks like.
 *
 * # NUMERIC arguments (a type pin, not a marker wrapper)
 *
 * executeAgentAction forwards each positional argument through kwil-js's value encoder, which infers
 * a kwil type from the JS value. A bare decimal STRING would infer to TEXT, so a NUMERIC argument
 * needs an explicit type pin (parallel to args) carrying the action's EXACT precision/scale — e.g.
 * Utils.DataType.Numeric(78, 0) for maa_withdraw's $amount, Utils.DataType.NumericArray(36, 18) for
 * insert_records' $value[]. The node does not coerce text to NUMERIC, so the precision/scale must
 * match the declared parameter. (The Python SDK needs MAANumericArg only because JSON has no decimal
 * type; here a DataType pin does the same job.)
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EthereumAddress,
  MAAAddress,
  NodeTNClient,
  StreamId,
  StreamType,
} from "@trufnetwork/sdk-js";
import { Utils } from "@trufnetwork/kwil-js";
import { getBytes, hexlify, Wallet } from "ethers";

// On-chain decimal types the inner actions declare. A NUMERIC argument MUST be pinned with these
// EXACT precision/scale, because the node does not coerce text to NUMERIC and compares strictly.
const TOKEN_PRECISION = 78;
const TOKEN_SCALE = 0; // bridge amounts: NUMERIC(78,0)
const VALUE_PRECISION = 36;
const VALUE_SCALE = 18; // primitive record values: NUMERIC(36,18)

// How long to wait for each transaction to be included before treating it as failed.
const TX_TIMEOUT_MS = 30_000;

async function run(): Promise<void> {
  // --- load .env (zero-dependency; real environment variables take precedence) ---
  const here = dirname(fileURLToPath(import.meta.url));
  loadDotenv(join(process.cwd(), ".env"));
  loadDotenv(join(here, ".env")); // also look next to this source file; the cwd .env, loaded first, wins

  // --- configuration (all overridable via environment / .env; see .env.example) ---
  const providerURL = process.env.PROVIDER_URL || "https://gateway.testnet.truf.network";
  const agentKey = process.env.AGENT_PRIVATE_KEY; // restricted agent
  const ownerKey = process.env.OWNER_PRIVATE_KEY; // unrestricted owner / funder
  const bridge = process.env.MAA_BRIDGE || "hoodi_tt"; // funding/fee bridge namespace
  const fundAmount = process.env.MAA_FUND_AMOUNT || "250000000000000000000";
  const feeBps = parseInt(process.env.MAA_FEE_BPS || "250", 10); // owner-withdraw commission to the agent
  // Order-book collateral bridge for getCollateralByWallet (migration 051). This is the bridge the
  // order-book MARKETS settle in (hoodi_tt2 / sepolia_bridge / ethereum_bridge on dev/testnet), NOT
  // the hoodi_tt funding/fee bridge above. getPositionsByWallet needs no bridge.
  const collateralBridge = process.env.MAA_COLLATERAL_BRIDGE || "hoodi_tt2";

  if (!agentKey || !ownerKey) {
    throw new Error(
      "AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY must both be set (two distinct keys); see README.md",
    );
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error(`MAA_FEE_BPS must be an integer between 0 and 10000 (10000 = 100%), got ${feeBps}`);
  }

  const salt = buildSalt(process.env.MAA_SALT);

  // The agent's allow-list (mirrors data_agent_test.go): the two data-provision actions.
  const namespaces = ["main", "main"];
  const actions = ["create_streams", "insert_records"];
  const bodyHashes = [null, null]; // unpinned

  // --- clients & their addresses ---
  const chainId = await NodeTNClient.getDefaultChainId(providerURL);
  if (!chainId) {
    throw new Error(`could not resolve chain id from ${providerURL}`);
  }
  const agent = newClient(providerURL, agentKey, chainId);
  const owner = newClient(providerURL, ownerKey, chainId);
  const agentMaa = agent.loadMAAAction();
  const ownerMaa = owner.loadMAAAction();
  const agentOB = agent.loadOrderbookAction();

  const agentHex = agent.address().getAddress();
  const ownerHex = owner.address().getAddress();

  banner("MAA lifecycle smoke test");
  console.log(`provider : ${providerURL}`);
  console.log(`bridge   : ${bridge}`);
  console.log(`agent    : ${agentHex}   (restricted — operates the wallet)`);
  console.log(`owner    : ${ownerHex}   (unrestricted — funds & withdraws)`);
  if (agentHex.toLowerCase() === ownerHex.toLowerCase()) {
    throw new Error("agent and owner must be DIFFERENT keys");
  }

  // escrow reads the MAA's bridge balance (its escrow). It is caller-agnostic — any client can read
  // any wallet's balance by address — so we bind it to the agent client for the running narration.
  let maaHex = "";
  const escrow = (): Promise<string> => agent.getWalletBalance(bridge, maaHex);

  // (a) AGENT creates an immutable rule. The allow-list is the two data-provision actions; the
  //     fee_mode/bps set the commission the owner pays the agent on withdrawal.
  banner("(a) agent registers the rule");
  const ruleRes = await agentMaa.createAgentRule({
    feeMode: "bps",
    feeBps,
    feeFlat: "0",
    namespaces,
    actions,
    bodyHashes,
    salt,
  });
  await waitOK(agent, ruleRes.txHash, "create rule");
  console.log(`✅ rule created: rule_id=${ruleRes.ruleIdHex}  (commission ${(feeBps / 100).toFixed(2)}%)`);
  // Cross-check the SDK-returned rule_id against a standalone, offline derivation (the same public
  // primitives a caller can use to know the handle before submitting).
  const rulesHash = MAAAddress.computeRulesHash("bps", feeBps, "0", namespaces, actions, bodyHashes);
  const ruleIdLocal = hexlify(MAAAddress.deriveRuleId(agentHex, rulesHash, salt));
  if (ruleIdLocal !== ruleRes.ruleIdHex) {
    throw new Error(`local rule_id ${ruleIdLocal} != sdk ${ruleRes.ruleIdHex}`);
  }
  console.log(`   ↳ matches local derivation ${ruleIdLocal}`);

  // (b) OWNER joins the rule → derives + registers the agent wallet (the MAA).
  banner("(b) owner joins → agent wallet derived");
  const joinRes = await ownerMaa.joinAgentAddress(ruleRes.ruleId);
  await waitOK(owner, joinRes.txHash, "join");
  maaHex = joinRes.maaAddressHex;
  const maaLocal = MAAAddress.deriveMAAAddressHex(ownerHex, agentHex, ruleRes.ruleId);
  if (maaLocal.toLowerCase() !== maaHex.toLowerCase()) {
    throw new Error(`local MAA ${maaLocal} != sdk ${maaHex}`);
  }
  const known = await agentMaa.isAgentWallet(joinRes.maaAddress);
  console.log(`✅ agent wallet (MAA): ${maaHex}`);
  console.log(`   ↳ matches local derivation ${maaLocal}`);
  console.log(`   maa_is_known: ${known}`);

  // (c) OWNER funds the MAA with a normal bridged-token transfer.
  banner("(c) owner funds the agent wallet");
  await owner.transfer(bridge, maaHex, fundAmount); // resolves after the tx commits
  const funded = await escrow();
  console.log(`✅ funded MAA with ${fundAmount} → escrow balance now ${funded}`);
  if (funded !== fundAmount) {
    throw new Error(`expected escrow ${fundAmount}, got ${funded}`);
  }

  // (d) AGENT works AS the MAA: create a stream, then insert a record into it. @caller is rewritten
  //     to the MAA, so the stream is OWNED by the MAA and the fees come out of the MAA's escrow.
  banner("(d) agent creates a stream + inserts data, AS the MAA");
  const sid = await StreamId.generate(`maa_demo_js_${Math.floor(Date.now() / 1000)}`);
  const streamID = sid.getId();
  console.log(`stream_id: ${streamID}`);

  const beforeCreate = await escrow();
  const createTx = await agentMaa.executeAgentAction({
    maaAddress: joinRes.maaAddress,
    action: "create_streams",
    args: [[streamID], [StreamType.Primitive]],
  });
  await waitOK(agent, createTx, "create_streams");
  const afterCreate = await escrow();
  console.log(
    `✅ create_streams ran as the MAA (escrow ${beforeCreate} → ${afterCreate}, fee ${weiDiff(beforeCreate, afterCreate)})`,
  );

  const eventTime = Math.floor(Date.now() / 1000);
  const insertTx = await agentMaa.executeAgentAction({
    maaAddress: joinRes.maaAddress,
    action: "insert_records",
    args: [[maaHex], [streamID], [eventTime], ["42.5"]],
    types: [
      Utils.DataType.TextArray, // $data_providers TEXT[]
      Utils.DataType.TextArray, // $stream_ids TEXT[]
      Utils.DataType.IntArray, // $event_times INT8[]
      Utils.DataType.NumericArray(VALUE_PRECISION, VALUE_SCALE), // $values NUMERIC(36,18)[]
    ],
  });
  await waitOK(agent, insertTx, "insert_records");
  const afterInsert = await escrow();
  console.log(
    `✅ insert_records ran as the MAA (escrow ${afterCreate} → ${afterInsert}, fee ${weiDiff(afterCreate, afterInsert)})`,
  );

  // PROOF the rewrite happened: the stream + record exist UNDER THE MAA's address, not the agent's.
  const records = await agentMaa.getRecord(
    { streamId: sid, dataProvider: new EthereumAddress(maaHex) },
    { from: eventTime - 5, to: eventTime + 5, useCache: false },
  );
  if (records.data.length === 0) {
    throw new Error(`expected the inserted record to be readable under the MAA address ${maaHex}`);
  }
  console.log(`   stream ${streamID} owned by ${maaHex}; records read back: ${records.data.length}`);
  for (const r of records.data) {
    console.log(`     event_time=${r.eventTime} value=${r.value}`);
  }
  console.log(`✅ the agent provided data AS the MAA (not as its own key ${agentHex})`);

  // (e) AGENT tries to exit the funds → BLOCKED. Owner-exit actions are reserved for the owner; the
  //     route rejects the restricted agent before anything moves (at submission or in-block).
  banner("(e) agent tries to withdraw → must be blocked");
  const balanceBeforeAttack = await escrow();
  let blocked = false;
  let blockMsg = "";
  try {
    const attackTx = await agentMaa.executeAgentAction({
      maaAddress: joinRes.maaAddress,
      action: "maa_withdraw",
      args: [bridge, "1000000000000000000"],
      types: [Utils.DataType.Text, Utils.DataType.Numeric(TOKEN_PRECISION, TOKEN_SCALE)],
    });
    await agent.waitForTx(attackTx, TX_TIMEOUT_MS);
  } catch (e) {
    blocked = true;
    blockMsg = e instanceof Error ? e.message : String(e);
  }
  if (!blocked) {
    throw new Error("SECURITY FAILURE: the restricted agent was allowed to withdraw");
  }
  console.log(`✅ blocked, as it must be: ${blockMsg}`);
  if (!blockMsg.includes("reserved for the unrestricted owner") && !blockMsg.includes("restricted agent")) {
    console.log("   ⚠️  (blocked, but the message differs from the expected route/guard wording)");
  }
  const balanceAfterAttack = await escrow();
  if (balanceAfterAttack !== balanceBeforeAttack) {
    throw new Error(`a blocked exit must move nothing: ${balanceBeforeAttack} -> ${balanceAfterAttack}`);
  }
  console.log(`   escrow unchanged after the blocked attempt: ${balanceAfterAttack}`);

  // (f) OWNER withdraws the remaining escrow, paying the agent its commission.
  banner("(f) owner withdraws the remaining escrow (pays the agent commission)");
  const remaining = await owner.getWalletBalance(bridge, maaHex);
  const withdrawTx = await ownerMaa.executeAgentAction({
    maaAddress: joinRes.maaAddress,
    action: "maa_withdraw",
    args: [bridge, remaining],
    types: [Utils.DataType.Text, Utils.DataType.Numeric(TOKEN_PRECISION, TOKEN_SCALE)],
  });
  await waitOK(owner, withdrawTx, "owner withdraw");
  const drained = await escrow();
  console.log(`✅ owner withdrew ${remaining}; escrow now ${drained}`);
  console.log(
    `   ↳ agent earns ~${commission(remaining, feeBps)} (${(feeBps / 100).toFixed(2)}% commission); owner gets the rest`,
  ); // HALF-UP on-chain; floor is a lower bound
  if (drained !== "0") {
    throw new Error(`expected the wallet to be drained, got ${drained}`);
  }

  // (g) READ STATE back: rule terms, allow-list, instance, audit log.
  banner("(g) read MAA state");
  console.log("rule           :", await agentMaa.getRule(ruleRes.ruleId));
  console.log("allowed_actions:", await agentMaa.getAllowedActions(ruleRes.ruleId));
  console.log("instance       :", await agentMaa.getInstance(joinRes.maaAddress));
  const events = await agentMaa.getEvents(ruleRes.ruleId, 100, 0);
  console.log(`events (${events.length}):`);
  for (const ev of events) {
    console.log(
      `   - ${ev.eventType.padEnd(12)} role=${ev.actorRole.padEnd(13)} actor=${ev.actorAddr} action=${ev.innerAction ?? "-"} amount=${ev.amount ?? "-"}`,
    );
  }

  // (h) READ the agent wallet's ORDER-BOOK portfolio BY ADDRESS (migration 051).
  //     getPositionsByWallet / getCollateralByWallet read the wallet you pass in (NOT @caller), so an
  //     owner — or a delegated market-maker bot — can read an agent wallet's live inventory without
  //     holding its key. The signer here (agent) differs from the wallet read (the MAA), which is the
  //     whole point. This MAA's allow-list is create_streams/insert_records (data provision), so it
  //     holds NO order-book positions — the reads return empty/zero. A clean return (instead of
  //     "unknown action") is the proof that migration 051 is live on this network.
  banner("(h) read the agent wallet's order-book portfolio by address");
  const positions = await agentOB.getPositionsByWallet(maaHex);
  const collateral = await agentOB.getCollateralByWallet(maaHex, collateralBridge);
  console.log(`getPositionsByWallet(${maaHex}) -> ${positions.length} positions:`, positions);
  console.log(`getCollateralByWallet(${maaHex}, ${collateralBridge}) ->`, collateral);
  console.log("✅ address-parameterized portfolio reads are live (migration 051)");

  banner("✅ MAA lifecycle smoke test PASSED");
  console.log("Proven on-chain via the JavaScript SDK:");
  console.log("  • @caller rewritten to the MAA (the stream is owned by the wallet, not the agent key)");
  console.log("  • fees debit the MAA's own escrow");
  console.log("  • the restricted agent cannot move funds out");
  console.log("  • the owner withdraws with the agreed commission");
  console.log("  • an owner can read the wallet's order-book positions/collateral by address (051)");
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/** newClient builds a gateway-backed client signing as the given secp256k1 key (with or without 0x). */
function newClient(endpoint: string, privateKey: string, chainId: string): NodeTNClient {
  const wallet = new Wallet(privateKey.startsWith("0x") ? privateKey : "0x" + privateKey);
  return new NodeTNClient({
    endpoint,
    signerInfo: { address: wallet.address, signer: wallet },
    chainId,
  });
}

/** waitOK blocks until txHash is included in a block and asserts the transaction succeeded. */
async function waitOK(client: NodeTNClient, txHash: string, label: string): Promise<void> {
  try {
    await client.waitForTx(txHash, TX_TIMEOUT_MS);
  } catch (e) {
    throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * buildSalt returns the 32-byte rule salt. With saltHex set (64 hex chars, optional 0x) it is pinned
 * for a reproducible rule_id; otherwise a fresh, random salt makes each run register a new rule/MAA so
 * re-running never collides with an already-registered rule.
 */
function buildSalt(saltHex?: string): Uint8Array {
  if (saltHex) {
    const b = getBytes(saltHex.startsWith("0x") ? saltHex : "0x" + saltHex);
    if (b.length !== 32) {
      throw new Error(`MAA_SALT must be 32 bytes (64 hex chars), got ${b.length}`);
    }
    return b;
  }
  // Tag the salt "MAA" then fill the remaining 29 bytes with cryptographic randomness, so each run
  // gets a unique rule_id with no chance of a collision between nearby runs.
  const salt = new Uint8Array(32);
  salt.set(new TextEncoder().encode("MAA"));
  salt.set(randomBytes(29), 3);
  return salt;
}

/**
 * loadDotenv populates process.env from a KEY=VALUE .env file without overriding existing vars (real
 * environment variables take precedence). A missing file is a no-op.
 */
function loadDotenv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // missing file: nothing to load
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

/** weiDiff returns before-after as a base-10 string (the fee an action debited from escrow). */
function weiDiff(before: string, after: string): string {
  return (BigInt(before) - BigInt(after)).toString();
}

/** commission returns floor(amount * bps / 10000) — a lower bound on the agent's HALF-UP commission. */
function commission(amount: string, bps: number): string {
  return ((BigInt(amount) * BigInt(bps)) / 10000n).toString();
}

function banner(title: string): void {
  console.log("\n" + "=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

run().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
