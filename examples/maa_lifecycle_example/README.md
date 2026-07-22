# MAA Lifecycle Smoke Test (JavaScript / TypeScript)

A runnable, end-to-end proof of **Modular Agent Addresses** ("agent wallets") through the JS/TS SDK,
against a live TRUF.NETWORK node where `maa_exec` is activated (testnet from height `6523123`).

An MAA lets a token holder (the **owner**) hand a constrained **agent** key a wallet it can *operate*
but provably cannot *drain*. This example drives the whole lifecycle and asserts the properties that
make that safe, mirroring the node's canonical oracle `tests/streams/maa/data_agent_test.go` and the
Go and Python SDKs' `examples/maa_lifecycle_example`.

## What it proves

1. **`@caller` rewrite** — the agent runs `create_streams` / `insert_records` *as the MAA*, so the
   stream it creates is owned by the **MAA address**, not the agent's own key. The example reads the
   record back under the MAA address to confirm.
2. **Fees debit the MAA's own escrow** — each action's fee comes out of the wallet's bridge balance
   (printed before/after every step).
3. **The agent cannot exfiltrate** — when the restricted agent attempts `maa_withdraw`, the node
   rejects it ("reserved for the unrestricted owner") and the escrow is unchanged.
4. **The owner withdraws with commission** — the owner drains the remaining escrow; the agent earns
   the rule's `fee_bps` commission.
5. **Local derivation matches the chain** — `rule_id` and the MAA address are derived offline
   (`MAAAddress.computeRulesHash` / `deriveRuleId` / `deriveMAAAddressHex`) and asserted equal to what
   the SDK returns.
6. **Portfolio reads by address** — `getPositionsByWallet` / `getCollateralByWallet` (migration 051)
   read the agent wallet's order-book inventory *by address* — the signer is not the wallet being read
   — so an owner or a delegated market-maker bot can monitor an agent wallet it does not sign for. This
   MAA does data provision (not order-book trading), so the reads return empty/zero; a clean return is
   the proof that 051 is live.

## Two identities (required)

The agent and the owner are **different keys**:

| Role | Env var | Signs | Becomes |
|------|---------|-------|---------|
| **Restricted agent** | `AGENT_PRIVATE_KEY` | `createAgentRule`, runs allow-listed actions as the MAA | the `restricted` address baked into `rule_id` |
| **Unrestricted owner** | `OWNER_PRIVATE_KEY` | `joinAgentAddress`, funds, withdraws | the `unrestricted` address; controls the funds |

## Atomic join + fund (one transaction)

This example funds in two steps — `joinAgentAddress`, then a separate `client.transfer` — which is the
general flow and the one to use for topping up a wallet that already exists. To activate a **new**
wallet in a single signed transaction, use `joinAndFundAgentAddress`: it joins the rule and moves the
funding from the owner's balance into the derived wallet atomically, so a failure can never leave a
joined-but-unfunded wallet.

```ts
const { maaAddressHex, txHash } = await ownerMaa.joinAndFundAgentAddress({
  ruleId,
  bridge: "eth_truf",              // the bridge the funds are held under
  amount: "250000000000000000000", // positive base-10 string in base units, fits NUMERIC(78,0) (≤ 78 digits)
});
```

The owner must already hold the funds on TN; bringing tokens in from L1 is a separate bridge deposit.
Requires the on-chain `maa_join_and_fund` action (node migration 054) on the target network.

## Run

Configuration is read from a `.env` file next to the program (real environment variables still take
precedence, so you can override any value with a shell `export`). `.env` is gitignored.

The example depends on the SDK via `file:../..`, so build the SDK once from the repo root first:

```bash
# from the repo root: build @trufnetwork/sdk-js so the local dependency resolves
npm install && npm run build
```

Then run the example:

```bash
cd examples/maa_lifecycle_example
cp .env.example .env        # then edit .env: fill in AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY

npm install
npm start
```

Each run uses a fresh salt by default, so it registers a new rule/MAA and can be re-run without
colliding with a previous run. Set `MAA_SALT` (64 hex chars) to pin a reproducible rule_id.

### Environment variables (see `.env.example`)

| Variable | Default | Notes |
|----------|---------|-------|
| `PROVIDER_URL` | `https://gateway.testnet.truf.network` | The testnet RPC/gateway. The chain id is auto-discovered from it. **Confirm the real URL for your network.** |
| `AGENT_PRIVATE_KEY` | — (required) | Restricted agent key (with or without `0x`). |
| `OWNER_PRIVATE_KEY` | — (required) | Unrestricted owner key (with or without `0x`); must hold ≥ `MAA_FUND_AMOUNT` + fees of bridged token. |
| `MAA_BRIDGE` | `hoodi_tt` | Funding/fee bridge namespace. dev = `hoodi_tt`/`hoodi_tt2`, mainnet = `eth_truf`/`eth_usdc`. |
| `MAA_FUND_AMOUNT` | `250000000000000000000` (250 TRUF) | Must cover the action fees (`create_streams` may cost 100 TRUF where the fee is active). |
| `MAA_FEE_BPS` | `250` (2.5%) | Owner-withdraw commission paid to the agent. |
| `MAA_COLLATERAL_BRIDGE` | `hoodi_tt2` | Order-book bridge for `getCollateralByWallet` (migration 051) — the bridge the markets settle in, **not** the `hoodi_tt` fee bridge. |
| `MAA_SALT` | _(fresh per run)_ | Optional 64-hex salt to pin a reproducible rule_id across runs. |

## Open items to confirm before the first run

These can't be derived from code — set them for your testnet:

1. **Provider URL** — the public testnet RPC/gateway endpoint.
2. **Two funded keys** — the owner key in particular needs enough bridged token to fund the MAA.
3. **Bridge namespace** — which of `hoodi_tt` / `eth_truf` / … is registered on this network.
4. **Fee schedule** — whether the 100-TRUF `create_streams` fee is active (drives `MAA_FUND_AMOUNT`).
   The program reads balances around each step, so it works whether or not fees are active.

## NUMERIC arguments (a type pin, not a marker wrapper)

`executeAgentAction` forwards each positional argument through kwil-js's value encoder, which infers a
kwil type from the JS value. A bare decimal **string** would infer to `TEXT`, so a `NUMERIC` argument
needs an explicit **type pin** (parallel to `args`) carrying the action's **exact** precision/scale.
(The Python SDK needs `MAANumericArg` only because JSON has no decimal type; here a `Utils.DataType`
pin does the same job.) The node does **not** coerce text to `NUMERIC`, so the precision/scale must
match the declared parameter.

```ts
import { Utils } from "@trufnetwork/kwil-js";

// maa_withdraw($bridge TEXT, $amount NUMERIC(78,0))
await maa.executeAgentAction({
  maaAddress,
  action: "maa_withdraw",
  args: ["hoodi_tt", "110000000000000000000"],
  types: [Utils.DataType.Text, Utils.DataType.Numeric(78, 0)],
});

// insert_records($data_providers TEXT[], $stream_ids TEXT[], $event_times INT8[], $values NUMERIC(36,18)[])
await maa.executeAgentAction({
  maaAddress,
  action: "insert_records",
  args: [[provider], [streamId], [eventTime], ["42.5"]],
  types: [
    Utils.DataType.TextArray,
    Utils.DataType.TextArray,
    Utils.DataType.IntArray,
    Utils.DataType.NumericArray(36, 18),
  ],
});
```

Array arguments whose elements are plain strings or integers (`create_streams`' `TEXT[]` args) infer
correctly and need no pin.

## Transactions are asynchronous

SDK write methods return once the transaction enters the mempool, not when it commits. Each step that
depends on the previous one (join reads the rule on-chain; exec needs funded escrow) waits for
inclusion with `client.waitForTx` and checks the result before continuing. (`client.transfer` /
`client.withdraw` wait internally.)

## What success looks like

Each step prints a `✅`, balances move as expected, the agent's withdrawal is blocked, the owner's
succeeds, and the run ends with `✅ MAA lifecycle smoke test PASSED`. A non-zero exit or a missing `✅`
means a step failed — the raw node error is printed inline.

## Oracle

The Go equivalents exercised directly against the engine live in the node repo:
`tests/streams/maa/data_agent_test.go`, `withdraw_test.go`, `lp_vault_test.go`,
`tests/streams/order_book/portfolio_by_wallet_test.go`, and `docs/modular-agent-addresses.md`.
