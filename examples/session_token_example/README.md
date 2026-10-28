# Gateway session tokens (JavaScript / TypeScript)

A runnable walk-through of gateway session tokens with the JS/TS SDK, against a live TRUF.NETWORK
gateway. It signs in once, saves the session token, and shows that later clients read with that
token alone, with no cookie and no new wallet signature.

This is what keeps a dapp signed in inside a wallet's in-app browser, where Android WebView and iOS
WKWebView drop the gateway's session cookie. The browser setup, with `BrowserTNClient` and
`sessionStorage`, is in the [Wallet In-App Browsers](../../README.md#wallet-in-app-browsers) section
of the main README. This example runs the same calls in Node, with a string standing in for the
page's storage.

## What it proves

1. **Public reads need no session.** `listMarkets` and `getOrderBook` are answered with no sign-in.
2. **One sign-in brings a token.** `getUserPositions` needs a session, so the client signs in once,
   and `onSessionToken` saves the token the gateway returns.
3. **A saved token carries the session.** A new client started with `sessionTokens` reads
   `getUserPositions` without signing in, as a page would after a reload.
4. **A token can be handed over.** A client given the token with `setSessionToken` reads the same
   way.
5. **Logout ends the session.** After `logoutKGW`, the client no longer holds the token, and a client
   that still sends it is refused with 401.

The wallet counts its signatures, and the run checks after each step that the total is still 1.

## Requirements

- A gateway that returns session tokens. The TRUF.NETWORK testnet and mainnet gateways do.
- No funds and no key: by default the run uses a new random wallet. Set `PRIVATE_KEY` to use your own.

## Run

```bash
# from the repo root: build @trufnetwork/sdk-js so the local dependency resolves
npm install && npm run build

cd examples/session_token_example
npm install
npm start

# against mainnet
PROVIDER_URL=https://gateway.mainnet.truf.network npm start
```

See [`.env.example`](./.env.example) for the settings.

## What success looks like

Steps 2 to 5 each print `signatures: 1`, step 5 prints `the old token is refused (... 401)`, and the
run ends with `OK: one sign-in served every read, and the saved token carried the session.` A run
that fails prints `FAILED:` with the reason and exits non-zero. Against a gateway without session
token support, it stops at step 2 with `the gateway returned no session token`.
