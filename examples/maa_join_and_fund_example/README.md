# Atomic MAA activation — join + fund in one transaction (JavaScript / TypeScript)

A runnable, end-to-end smoke test of `joinAndFundAgentAddress` through the JS/TS SDK, against a live
TRUF.NETWORK node. It joins a rule and funds the derived agent wallet in a **single** transaction,
then proves both legs committed together.

For the broader agent-wallet lifecycle (create → join → fund → operate → withdraw, with the two-step
funding), see [`../maa_lifecycle_example`](../maa_lifecycle_example). This example is focused on the
one-call atomic activation.

## What it proves

1. **One transaction, both legs** — `joinAndFundAgentAddress` returns a single tx hash that covers the
   join and the funding transfer.
2. **The join committed** — after that one tx, the derived wallet is a registered instance
   (`maa_is_known` is true).
3. **The funding committed** — the wallet's escrow holds exactly the funded amount, and the owner's
   balance dropped by exactly that amount.
4. **The wallet is immediately usable** — the owner withdraws the escrow back out (paying the agent
   its commission), so the run leaves nothing stranded.

Atomicity means these never disagree: you can't end up joined-but-unfunded or funded-but-unregistered.

## Requirements

- The on-chain `maa_join_and_fund` action (node migration **054**) deployed on the target network.
- Two **distinct** keys. The **owner** must already hold at least `MAA_FUND_AMOUNT` of the funding
  bridge token (`hoodi_tt` on dev/testnet) on TN — bringing tokens in from L1 is a separate bridge
  deposit, not part of this call.

## Run

```bash
# from the repo root: build @trufnetwork/sdk-js so the local dependency resolves
npm install && npm run build

cd examples/maa_join_and_fund_example
cp .env.example .env        # fill in AGENT_PRIVATE_KEY and OWNER_PRIVATE_KEY
npm install
npm start
```

See [`.env.example`](./.env.example) for every setting.

## What success looks like

Each step prints a `✅`, the wallet's escrow equals the funded amount after a single tx, the owner's
balance drops by exactly that amount, the withdrawal drains the escrow, and the run ends with
`✅ atomic join + fund smoke test PASSED`. A non-zero exit or a missing `✅` means a step failed.

## Source of truth

The on-chain action is `internal/migrations/054-maa-join-fund.sql` in `trufnetwork/node`; the node
integration tests are `tests/streams/maa/join_and_fund_test.go` (happy path, validation, atomicity,
duplicate join). The SDK method is `MAAAction.joinAndFundAgentAddress`.
