/**
 * Gateway session tokens (JavaScript/TypeScript SDK).
 *
 * A dapp opened in a wallet's in-app browser loses the gateway's session cookie, because Android
 * WebView and iOS WKWebView drop it as a third-party cookie. A gateway that supports session tokens
 * also returns the session as a token at sign-in, and the SDK sends it with that signer's reads as
 * "Authorization: Bearer <token>". This program walks through the cycle against a live TRUF.NETWORK
 * gateway, with a new wallet and no funds:
 *
 *   1. reads that need no session (markets, order book): no sign-in;
 *   2. a read that needs a session: the client signs in once, and onSessionToken saves the token;
 *   3. a NEW client started from the saved tokens reads without signing in, as after a page reload;
 *   4. setSessionToken hands the token to a client that is already built;
 *   5. logout ends the session, and the old token is refused afterwards.
 *
 * The wallet counts its signatures, so you can see that only step 2 asks for one.
 *
 *     cd examples/session_token_example
 *     npm install
 *     npm start
 *
 * PROVIDER_URL picks the gateway (default: testnet). PRIVATE_KEY is optional; without it the run
 * uses a new random wallet. Both can also come from a .env file next to this program. See README.md
 * for what success looks like.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeTNClient } from "@trufnetwork/sdk-js";
import { Wallet } from "ethers";

// A wallet that counts its signatures, so each step shows whether it asked the wallet to sign.
let signatures = 0;
class CountingWallet extends Wallet {
  override async signMessage(message: string | Uint8Array): Promise<string> {
    signatures += 1;
    return super.signMessage(message);
  }
}

// Stands in for the page's sessionStorage: the tokens as one JSON string, keyed by signer.
let storage = "{}";

async function run(): Promise<void> {
  // --- load .env (zero-dependency; real environment variables take precedence) ---
  const here = dirname(fileURLToPath(import.meta.url));
  loadDotenv(join(process.cwd(), ".env"));
  loadDotenv(join(here, ".env")); // also look next to this source file; the cwd .env, loaded first, wins

  const providerURL = process.env.PROVIDER_URL || "https://gateway.testnet.truf.network";
  const key = process.env.PRIVATE_KEY || Wallet.createRandom().privateKey;
  const wallet = new CountingWallet(key.startsWith("0x") ? key : `0x${key}`);

  const chainId = await NodeTNClient.getDefaultChainId(providerURL);
  if (!chainId) {
    throw new Error(`could not read the chain id from ${providerURL}`);
  }
  const options = {
    endpoint: providerURL,
    signerInfo: { address: wallet.address, signer: wallet },
    chainId,
  };
  console.log(`gateway ${providerURL} (chain ${chainId})`);
  console.log(`wallet  ${wallet.address}\n`);

  // --- 1. reads that need no session ---
  const client = new NodeTNClient({
    ...options,
    // save every change, as a page would to sessionStorage
    onSessionToken: (identifier: string, token: string | undefined) => {
      const saved: Record<string, string> = JSON.parse(storage);
      if (token) saved[identifier] = token;
      else delete saved[identifier];
      storage = JSON.stringify(saved);
    },
  });
  const orderbook = client.loadOrderbookAction();
  const markets = await orderbook.listMarkets({ settledFilter: false, limit: 3 });
  console.log(`1. listMarkets: ${markets.length} open markets`);
  if (markets.length === 0) {
    throw new Error("the gateway lists no open market, so there is no order book to read");
  }
  const book = await orderbook.getOrderBook(markets[0].id, true);
  console.log(`   getOrderBook(${markets[0].id}): ${book.length} orders`);
  console.log(`   signatures: ${signatures}\n`);
  expectSignatures(0);

  // --- 2. a read that needs a session: one sign-in, and the token is saved ---
  const positions = await orderbook.getUserPositions();
  const token = client.getSessionToken();
  if (!token) {
    throw new Error("the gateway returned no session token; it does not support session tokens");
  }
  console.log(`2. getUserPositions: ${positions.length} positions, after one sign-in`);
  console.log(`   session token held (${token.length} chars), saved by onSessionToken`);
  console.log(`   signatures: ${signatures}\n`);
  expectSignatures(1);

  // --- 3. a new client started from the saved tokens, as on the next page load ---
  const reloaded = new NodeTNClient({ ...options, sessionTokens: JSON.parse(storage) });
  await reloaded.loadOrderbookAction().getUserPositions();
  console.log("3. a new client started from the saved tokens: getUserPositions answered");
  console.log(`   signatures: ${signatures} (no new sign-in)\n`);
  expectSignatures(1);

  // --- 4. hand the token to a client that is already built ---
  const handed = new NodeTNClient(options);
  handed.setSessionToken(token);
  await handed.loadOrderbookAction().getUserPositions();
  console.log("4. a client given the token by setSessionToken: getUserPositions answered");
  console.log(`   signatures: ${signatures} (no new sign-in)\n`);
  expectSignatures(1);

  // --- 5. logout ends the session; the old token no longer works ---
  await handed.getKwilClient().auth.logoutKGW(handed.getKwilSigner());
  console.log(`5. logoutKGW: done, token still held: ${handed.getSessionToken() ? "yes" : "no"}`);
  const stale = new NodeTNClient({ ...options, sessionTokens: JSON.parse(storage), autoAuthenticate: false });
  let refusal = "";
  try {
    await stale.loadOrderbookAction().getUserPositions();
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  // the gateway answers a call without a live session with HTTP 401
  if (!refusal.endsWith(": 401")) {
    throw new Error(`expected the old token to be refused with 401, got: ${refusal || "an answer"}`);
  }
  console.log(`   the old token is refused (${refusal})`);
  console.log("   with autoAuthenticate off, the client does not sign in again");
  console.log(`   signatures: ${signatures}\n`);
  expectSignatures(1);

  console.log("OK: one sign-in served every read, and the saved token carried the session.");
}

function expectSignatures(want: number): void {
  if (signatures !== want) {
    throw new Error(`expected ${want} wallet signatures so far, got ${signatures}`);
  }
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

run().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
