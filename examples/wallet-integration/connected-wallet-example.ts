/**
 * Connected Wallet Example
 * 
 * This example demonstrates using TNClient with a connected wallet service
 * through the ConnectedWalletSigner adapter. This is the RECOMMENDED approach
 * for production applications as it never exposes private keys.
 */

import { NodeTNClient } from '@trufnetwork/sdk-js';
import { Wallet } from 'ethers';
import { ConnectedWalletSigner, MockWalletService } from './ConnectedWalletSigner';

// Test private key - used only to simulate a wallet service
const TEST_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

async function testWithConnectedWallet() {
  console.log('========================================');
  console.log('Connected Wallet Example');
  console.log('✅ RECOMMENDED: Using wallet service adapter');
  console.log('========================================\n');

  try {
    // Step 1: Simulate a connected wallet service
    // In a real application, this would be MetaMask, WalletConnect, etc.
    const testWallet = new Wallet(TEST_PRIVATE_KEY);
    const mockWalletService = new MockWalletService(testWallet);
    
    console.log('Simulating connected wallet service...');
    console.log('Wallet address:', testWallet.address);

    // Step 2: Create the ConnectedWalletSigner adapter
    const connectedSigner = new ConnectedWalletSigner(
      mockWalletService,
      testWallet.address
    );
    console.log('✅ ConnectedWalletSigner created');

    // Step 3: Initialize TNClient with the connected wallet signer
    const client = new NodeTNClient({
      endpoint: 'https://gateway.mainnet.truf.network',
      signerInfo: {
        address: testWallet.address,
        signer: connectedSigner, // Using our adapter instead of the raw wallet
      },
      chainId: 'tn-v2.1',
      timeout: 30000,
    });

    console.log('✅ TNClient initialized with ConnectedWalletSigner');

    // Step 4: Test the whoami action
    const action = client.loadAction();
    console.log('\n----------------------------------------');
    console.log('Testing whoami action with connected wallet...');
    
    try {
      const callerAddress = await action.whoami();
      console.log('✅ whoami response:', callerAddress);
      console.log('Caller address from TN:', callerAddress);
      
      // Verify it matches our connected wallet
      if (callerAddress.toLowerCase() === testWallet.address.toLowerCase()) {
        console.log('✅ Address verification successful!');
        console.log('   The connected wallet is properly authenticated with TN!');
      } else {
        console.log('⚠️  Address mismatch!');
        console.log('  Expected:', testWallet.address);
        console.log('  Received:', callerAddress);
      }
    } catch (error) {
      console.error('❌ Error calling whoami:', error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    console.error('❌ Error in connected wallet example:', error);
  }
}


// Run the example
if (require.main === module) {
  testWithConnectedWallet()
    .then(() => {
      console.log('\n✅ Connected wallet example completed successfully!');
      console.log('\n💡 This demonstrates that any wallet service can be used with TNClient');
      console.log('   without exposing private keys!\n');
      
      
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

export { testWithConnectedWallet };