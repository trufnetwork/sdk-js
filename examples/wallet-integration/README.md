# Wallet Integration Examples for TN SDK

This directory contains examples demonstrating how to integrate different types of wallets with the TN SDK's `TNClient`.

## Overview

The TN SDK requires a signer that implements the `EthSigner` interface:

```typescript
interface EthSigner {
  signMessage: (message: string | Uint8Array) => Promise<string>;
}
```

**Important:** We define this interface ourselves - we don't import it from `@trufnetwork/kwil-js`. This demonstrates that ANY wallet service can be integrated with TNClient.

This repository demonstrates three approaches:

1. **Test Wallet** (using private key) - ⚠️ FOR TESTING ONLY
2. **Connected Wallet** (using adapter pattern) - ✅ RECOMMENDED
3. **Viem Wallet Client** (real-world example) - ✅ USED BY TRUF-CLAIM-PAGE

## Files

- `ConnectedWalletSigner.ts` - Adapter class for integrating ANY wallet service (viem, wagmi, ethers, etc.)
- `test-wallet-example.ts` - Example using a test private key
- `connected-wallet-example.ts` - Example using the ConnectedWalletSigner adapter
- `viem-wallet-example.ts` - Example using viem's WalletClient (as used by wagmi/truf-claim-page)
- `main.ts` - Runs all examples for comparison

## Running the Examples

### Prerequisites

```bash
# Install dependencies
npm install @trufnetwork/sdk-js ethers viem wagmi
```

### Run Individual Examples

```bash
# Run test wallet example
npx ts-node test-wallet-example.ts

# Run connected wallet example  
npx ts-node connected-wallet-example.ts

# Run viem wallet example (real-world)
npx ts-node viem-wallet-example.ts

# Run all examples
npx ts-node main.ts
```

## Example 1: Test Wallet (NOT for Production)

```typescript
import { Wallet } from 'ethers';
import { NodeTNClient } from '@trufnetwork/sdk-js';

// ⚠️ NEVER use in production!
const TEST_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

const wallet = new Wallet(TEST_PRIVATE_KEY);

const client = new NodeTNClient({
  endpoint: 'https://gateway.mainnet.truf.network',
  signerInfo: {
    address: wallet.address,
    signer: wallet, // Wallet implements EthSigner
  },
  chainId: 'tn-v2.1',
});
```

**Problems with this approach:**
- Exposes private key in code
- Not suitable for browser environments
- Security risk if key is compromised

## Example 2: Connected Wallet Adapter (RECOMMENDED)

```typescript
import { ConnectedWalletSigner } from './ConnectedWalletSigner';
import { BrowserTNClient } from '@trufnetwork/sdk-js';

// walletService could be MetaMask, WalletConnect, etc.
const connectedSigner = new ConnectedWalletSigner(walletService, address);

const client = new BrowserTNClient({
  endpoint: 'https://gateway.mainnet.truf.network',
  signerInfo: {
    address: address,
    signer: connectedSigner, // Using adapter
  },
  chainId: 'tn-v2.1',
});
```

**Benefits of this approach:**
- Never exposes private keys
- Works with any wallet provider
- Suitable for production use
- User controls signing through wallet UI

## Testing with whoami Action

Both examples use the `whoami` action to verify wallet integration:

```typescript
const action = client.loadAction();
const result = await action.call('whoami', {});

if (result.isRight()) {
  const response = result.unwrap();
  // response[0].caller should match the wallet address
}
```

The `whoami` action returns the caller's wallet address, confirming that:
1. The wallet is properly connected
2. Message signing works correctly
3. TN recognizes the authenticated wallet

## Example 3: Viem Wallet Client (REAL-WORLD)

This is what `truf-claim-page` actually uses:

```typescript
import { createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';
import { ConnectedWalletSigner } from './ConnectedWalletSigner';

// Create viem wallet client (in browser with MetaMask)
const viemWalletClient = createWalletClient({
  chain: mainnet,
  transport: custom(window.ethereum),
});

const [address] = await viemWalletClient.getAddresses();

// Create adapter - NO kwil-js import needed!
const connectedSigner = new ConnectedWalletSigner(
  viemWalletClient,
  address
);

const client = new BrowserTNClient({
  endpoint: 'https://gateway.mainnet.truf.network',
  signerInfo: {
    address: address,
    signer: connectedSigner,
  },
  chainId: 'tn-v2.1',
});
```

## Integration with React/wagmi (truf-claim-page style)

For React applications using wagmi (like truf-claim-page):

```typescript
import { useAccount } from 'wagmi';
import { getWalletClient } from 'wagmi/actions';

function useTNClient() {
  const { address, isConnected } = useAccount();
  const [client, setClient] = useState(null);

  useEffect(() => {
    if (isConnected && address) {
      getWalletClient().then((walletClient) => {
        const signer = new ConnectedWalletSigner(walletClient, address);
        
        const tnClient = new BrowserTNClient({
          endpoint: 'https://gateway.mainnet.truf.network',
          signerInfo: {
            address: address,
            signer: signer,
          },
          chainId: 'tn-v2.1',
        });

        setClient(tnClient);
      });
    }
  }, [isConnected, address]);

  return client;
}
```

## Security Best Practices

### ✅ DO:
- Use `ConnectedWalletSigner` or similar adapters
- Let users control signing through their wallet UI
- Validate addresses before use
- Handle wallet disconnection gracefully

### ❌ DON'T:
- Hardcode private keys in production code
- Store private keys in localStorage or cookies
- Bypass wallet approval for transactions
- Trust client-side addresses without verification

## ConnectedWalletSigner API

The `ConnectedWalletSigner` class provides a secure adapter for any wallet service:

```typescript
class ConnectedWalletSigner implements EthSigner {
  constructor(walletService: any, address: string)
  signMessage(message: string | Uint8Array): Promise<string>
  getAddress(): string
}
```

### Requirements for walletService:
- Must have a `signMessage` method
- Method should return a Promise<string> with the signature
- Should trigger wallet UI for user approval

### Compatible with:
- **Viem WalletClient** (used by truf-claim-page)
- **Wagmi** (wrapper around viem)
- MetaMask (via ethers.js or viem)
- WalletConnect
- Coinbase Wallet  
- Safe (Gnosis Safe)
- Any wallet service that has a `signMessage` method

## Troubleshooting

### "No wallet client available"
Ensure the wallet is connected before initializing TNClient.

### "Failed to sign message"
Check that the wallet service has a proper `signMessage` method.

### Address mismatch in whoami
Verify that the address passed to TNClient matches the connected wallet.

### Timeout errors
Increase the timeout in TNClient configuration or check network connectivity.

## Additional Resources

- [TN SDK Documentation](https://docs.truf.network/sdk)
- [wagmi Documentation](https://wagmi.sh)
- [ethers.js Documentation](https://docs.ethers.io)
- [viem Documentation](https://viem.sh)

## License

MIT