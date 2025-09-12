/**
 * Viem Wallet Client Example
 * 
 * This example demonstrates using TNClient with viem's WalletClient,
 * which is what truf-claim-page uses for wallet connections.
 * 
 * This shows how to integrate viem/wagmi wallets with TNClient.
 */

import { NodeTNClient } from '@trufnetwork/sdk-js';
import { createWalletClient, custom, createTestClient, http, WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { ConnectedWalletSigner } from './ConnectedWalletSigner';

// Test private key - FOR TESTING ONLY!
const TEST_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Example 1: Using viem with a test private key
 * This simulates what a viem wallet client would look like
 */
async function testWithViemWallet() {
  console.log('========================================');
  console.log('Viem Wallet Client Example');
  console.log('Using viem to create a wallet client');
  console.log('========================================\n');

  try {
    // Create an account from the test private key
    const account = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`);
    console.log('Test account address:', account.address);

    // Create a viem wallet client
    // In a real app, this would use window.ethereum
    const viemWalletClient = createWalletClient({
      chain: mainnet,
      transport: http(),
      account,
    });

    // viem's wallet client has a signMessage method
    console.log('✅ Viem wallet client created');
    console.log('   Has signMessage:', typeof viemWalletClient.signMessage === 'function');

    // Create the ConnectedWalletSigner adapter
    const connectedSigner = new ConnectedWalletSigner(
      viemWalletClient,
      account.address
    );
    console.log('✅ ConnectedWalletSigner created with viem wallet');

    // Initialize TNClient with the viem-based signer
    const client = new NodeTNClient({
      endpoint: 'https://gateway.mainnet.truf.network',
      signerInfo: {
        address: account.address,
        signer: connectedSigner,
      },
      chainId: 'tn-v2.1',
      timeout: 30000,
    });

    console.log('✅ TNClient initialized with viem wallet client');

    // Test the whoami action
    const action = client.loadAction();
    console.log('\nCalling whoami action...');
    
    try {
      const callerAddress = await action.whoami();
      console.log('✅ whoami response:', callerAddress);
      console.log('Caller address from TN:', callerAddress);
      
      if (callerAddress.toLowerCase() === account.address.toLowerCase()) {
        console.log('✅ Viem wallet integration successful!');
      }
    } catch (error) {
      console.error('❌ Error calling whoami:', error instanceof Error ? error.message : String(error));
    }

  } catch (error) {
    console.error('❌ Error in viem wallet example:', error);
  }
}



// Run the example
if (require.main === module) {
  testWithViemWallet()
    .then(() => {
      console.log('\n✅ Viem wallet example completed!');
      console.log('\n💡 This demonstrates that viem wallet clients (used by wagmi)');
      console.log('   can be integrated with TNClient using the ConnectedWalletSigner adapter.');
      
      
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

export { testWithViemWallet };