/**
 * Test Wallet Example
 * 
 * This example demonstrates using TNClient with a test wallet (private key).
 * This approach uses a hardcoded private key and should ONLY be used for testing!
 * Never use this pattern in production code.
 */

import { NodeTNClient } from '@trufnetwork/sdk-js';
import { Wallet } from 'ethers';

// Test private key - NEVER use in production!
const TEST_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000001';

async function testWithPrivateKey() {
  console.log('========================================');
  console.log('Test Wallet Example (Private Key)');
  console.log('========================================\n');

  try {
    // Create a wallet from the test private key
    const wallet = new Wallet(TEST_PRIVATE_KEY);
    console.log('Test wallet address:', wallet.address);

    // Initialize TNClient with the test wallet
    const client = new NodeTNClient({
      endpoint: 'https://gateway.mainnet.truf.network',
      signerInfo: {
        address: wallet.address,
        signer: wallet, // Wallet implements the EthSigner interface
      },
      chainId: 'tn-v2.1',
      timeout: 30000,
    });

    console.log('TNClient initialized successfully');

    // Load the action API and call whoami
    const action = client.loadAction();
    
    console.log('\nCalling whoami action...');
    try {
      const callerAddress = await action.whoami();
      console.log('✅ whoami response:', callerAddress);
      console.log('Caller address from TN:', callerAddress);
      
      // Verify it matches our test wallet
      if (callerAddress.toLowerCase() === wallet.address.toLowerCase()) {
        console.log('✅ Address verification successful!');
      } else {
        console.log('⚠️  Address mismatch!');
        console.log('  Expected:', wallet.address);
        console.log('  Received:', callerAddress);
      }
    } catch (error) {
      console.error('❌ Error calling whoami:', error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    console.error('❌ Error in test wallet example:', error);
  }
}

// Run the example
if (require.main === module) {
  testWithPrivateKey()
    .then(() => {
      console.log('\n✅ Test wallet example completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

export { testWithPrivateKey };