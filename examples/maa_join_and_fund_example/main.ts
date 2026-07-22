/**
 * Atomic MAA activation smoke test — join + fund in one transaction (JavaScript/TypeScript SDK).
 *
 * The general agent-wallet flow joins a rule and then funds the derived wallet in two separate
 * transactions (see ../maa_lifecycle_example). This program exercises the one-call alternative,
 * joinAndFundAgentAddress, which does both in a SINGLE on-chain transaction: either the join and the
 * funding transfer both commit, or neither does. It proves, end-to-end through @trufnetwork/sdk-js,
 * against a live TRUF.NETWORK node:
 *
 *   - a restricted AGENT key registers an immutable rule (fund-free);
 *   - an unrestricted OWNER key joins that rule AND funds the derived wallet in ONE transaction —
 *     one tx hash covers both legs;
 *   - after that single tx: the wallet is registered (the join committed) AND holds exactly the
 *     funding amount, which was debited from the owner (the transfer committed) — atomicity proven;
 *   - the funded wallet is immediately usable: the owner withdraws it back out, draining the escrow.
 *
 * Requires the on-chain maa_join_and_fund action (node migration 054) on the target network.
 *
 * Config comes from a .env file next to this program (real environment variables take precedence).
 * Two DISTINCT keys are required — the agent and the owner are different identities. The OWNER must
 * hold at least MAA_FUND_AMOUNT of the funding bridge token on TN.
 *
 *     cd examples/maa_join_and_fund_example
 *     cp .env.example .env        # then fill in AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY
 *     npm install
 *     npm start
 *
 * See .env.example for every setting, and README.md for what success looks like.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAAAddress, NodeTNClient } from "@trufnetwork/sdk-js";
import { Utils } from "@trufnetwork/kwil-js";
import { getBytes, Wallet } from "ethers";

// Bridge amounts are NUMERIC(78,0); pin maa_withdraw's $amount with this EXACT precision/scale.
const TOKEN_PRECISION = 78;
const TOKEN_SCALE = 0;

// How long to wait for each transaction to be included before treating it as failed.
const TX_TIMEOUT_MS = 30_000;

async function run(): Promise<void> {
  // --- load .env (zero-dependency; real environment variables take precedence) ---
  const here = dirname(fileURLToPath(import.meta.url));
  loadDotenv(join(process.cwd(), ".env"));
  loadDotenv(join(here, ".env")); // also look next to this source file; the cwd .env, loaded first, wins

  // --- configuration (all overridable via environment / .env; see .env.example) ---
  const providerURL = process.env.PROVIDER_URL || "https://gateway.testnet.truf.network";
  const agentKey = process.env.AGENT_PRIVATE_KEY; // restricted agent (creates the rule)
  const ownerKey = process.env.OWNER_PRIVATE_KEY; // unrestricted owner / funder
  const bridge = process.env.MAA_BRIDGE || "hoodi_tt"; // funding bridge namespace
  const fundAmount = process.env.MAA_FUND_AMOUNT || "10000000000000000000"; // 10 tokens (base units)
  const feeBps = parseInt(process.env.MAA_FEE_BPS || "250", 10); // owner-withdraw commission to the agent

  if (!agentKey || !ownerKey) {
    throw new Error(
      "AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY must both be set (two distinct keys); see README.md",
    );
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new Error(`MAA_FEE_BPS must be an integer between 0 and 10000 (10000 = 100%), got ${feeBps}`);
  }
  if (!/^[0-9]{1,78}$/.test(fundAmount) || BigInt(fundAmount) <= 0n) {
    throw new Error(`MAA_FUND_AMOUNT must be a positive base-10 integer in base units, got ${fundAmount}`);
  }

  const salt = buildSalt(process.env.MAA_SALT);

  // The rule's allow-list is irrelevant to join+fund; use the data-provision actions for a realistic rule.
  const namespaces = ["main", "main"];
  const actions = ["create_streams", "insert_records"];
  const bodyHashes = [null, null];

  // --- clients & their addresses ---
  const chainId = await NodeTNClient.getDefaultChainId(providerURL);
  if (!chainId) {
    throw new Error(`could not resolve chain id from ${providerURL}`);
  }
  const agent = newClient(providerURL, agentKey, chainId);
  const owner = newClient(providerURL, ownerKey, chainId);
  const agentMaa = agent.loadMAAAction();
  const ownerMaa = owner.loadMAAAction();

  const agentHex = agent.address().getAddress();
  const ownerHex = owner.address().getAddress();

  banner("Atomic MAA activation smoke test (join + fund in one tx)");
  console.log(`provider : ${providerURL}`);
  console.log(`bridge   : ${bridge}`);
  console.log(`agent    : ${agentHex}   (restricted — creates the rule)`);
  console.log(`owner    : ${ownerHex}   (unrestricted — joins + funds)`);
  console.log(`fund     : ${fundAmount} (base units)`);
  if (agentHex.toLowerCase() === ownerHex.toLowerCase()) {
    throw new Error("agent and owner must be DIFFERENT keys");
  }

  // The owner must already hold the funding amount on TN (funds from L1 are a separate bridge deposit).
  const ownerStart = await owner.getWalletBalance(bridge, ownerHex);
  console.log(`owner ${bridge} balance: ${ownerStart}`);
  if (BigInt(ownerStart) < BigInt(fundAmount)) {
    throw new Error(
      `owner holds ${ownerStart} ${bridge}, needs at least ${fundAmount} to fund the wallet`,
    );
  }

  // (a) AGENT creates an immutable rule (fund-free).
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

  // (b) OWNER joins AND funds in ONE transaction. This is the whole point: a single tx hash covers
  //     both the join (registering the wallet) and the funding transfer (owner → wallet).
  banner("(b) owner joins + funds the wallet — one transaction");
  const res = await ownerMaa.joinAndFundAgentAddress({
    ruleId: ruleRes.ruleId,
    bridge,
    amount: fundAmount,
  });
  const maaHex = res.maaAddressHex;
  console.log(`join_and_fund tx: ${res.txHash}`);
  console.log(`agent wallet (MAA): ${maaHex}`);

  // The wallet address is derived locally before the tx even commits — cross-check it.
  const maaLocal = MAAAddress.deriveMAAAddressHex(ownerHex, agentHex, ruleRes.ruleId);
  if (maaLocal.toLowerCase() !== maaHex.toLowerCase()) {
    throw new Error(`local MAA ${maaLocal} != sdk ${maaHex}`);
  }
  console.log(`   ↳ matches local derivation ${maaLocal}`);

  await waitOK(owner, res.txHash, "join_and_fund");

  // (c) After that SINGLE tx, prove BOTH legs committed:
  banner("(c) verify the single tx did both — atomicity");

  //   join leg: the wallet is now a registered instance.
  const known = await agentMaa.isAgentWallet(res.maaAddress);
  if (!known) {
    throw new Error("join leg did not commit: the wallet is not a known instance");
  }
  console.log(`✅ join leg committed — maa_is_known: ${known}`);

  //   fund leg: the wallet's escrow holds exactly the funding amount...
  const escrow = await owner.getWalletBalance(bridge, maaHex);
  if (escrow !== fundAmount) {
    throw new Error(`fund leg mismatch: escrow ${escrow}, expected ${fundAmount}`);
  }
  console.log(`✅ fund leg committed — wallet escrow: ${escrow}`);

  //   ...and it came out of the owner's balance (debited by exactly the funding amount).
  const ownerAfter = await owner.getWalletBalance(bridge, ownerHex);
  const debited = (BigInt(ownerStart) - BigInt(ownerAfter)).toString();
  if (debited !== fundAmount) {
    throw new Error(`owner debit mismatch: debited ${debited}, expected ${fundAmount}`);
  }
  console.log(`✅ owner debited exactly the funding amount: ${ownerStart} → ${ownerAfter} (−${debited})`);

  //   the join is audited exactly as a plain join would be.
  const events = await agentMaa.getEvents(ruleRes.ruleId, 100, 0);
  const joinEvent = events.find((e) => e.eventType === "JOIN");
  console.log(`   audit: ${events.length} event(s); JOIN recorded: ${joinEvent ? "yes" : "no"}`);

  // (d) The freshly activated wallet is immediately usable — the owner withdraws it back out, paying
  //     the agent its commission and draining the escrow (so the smoke leaves nothing stranded).
  banner("(d) owner withdraws the escrow (proves the wallet works; cleans up)");
  const withdrawTx = await ownerMaa.executeAgentAction({
    maaAddress: res.maaAddress,
    action: "maa_withdraw",
    args: [bridge, escrow],
    types: [Utils.DataType.Text, Utils.DataType.Numeric(TOKEN_PRECISION, TOKEN_SCALE)],
  });
  await waitOK(owner, withdrawTx, "owner withdraw");
  const drained = await owner.getWalletBalance(bridge, maaHex);
  if (drained !== "0") {
    throw new Error(`expected the wallet to be drained, got ${drained}`);
  }
  console.log(`✅ owner withdrew ${escrow}; escrow now ${drained}`);
  console.log(
    `   ↳ agent earns ~${commission(escrow, feeBps)} (${(feeBps / 100).toFixed(2)}% commission); owner gets the rest`,
  );

  banner("✅ atomic join + fund smoke test PASSED");
  console.log("Proven on-chain via the JavaScript SDK:");
  console.log("  • one transaction both joined the rule and funded the derived wallet");
  console.log("  • the wallet is registered AND holds exactly the funded amount (both legs committed)");
  console.log("  • the funding was debited from the owner");
  console.log("  • the activated wallet is immediately operable (owner withdrew it back out)");
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

/** newClient builds a client signing as the given secp256k1 key (with or without 0x). */
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
 * buildSalt returns the 32-byte rule salt. With MAA_SALT set (64 hex chars, optional 0x) it is pinned
 * for a reproducible rule_id; otherwise a fresh random salt makes each run register a new rule/MAA, so
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
