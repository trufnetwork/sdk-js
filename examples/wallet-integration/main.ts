/**
 * Main Example Runner
 * 
 * This file demonstrates multiple approaches to using TNClient:
 * 1. Test wallet with private key
 * 2. Connected wallet with signer adapter
 * 3. Viem wallet client integration (as used by truf-claim-page)
 */

import { testWithPrivateKey } from './test-wallet-example';
import { testWithConnectedWallet } from './connected-wallet-example';
import { testWithViemWallet } from './viem-wallet-example';

async function runAllExamples() {
  console.log('================================================');
  console.log('TN SDK Wallet Integration Examples');
  console.log('================================================\n');
  console.log('This demonstration shows three approaches to wallet integration:\n');
  console.log('1. Test Wallet (with private key)');
  console.log('2. Connected Wallet (with adapter)');
  console.log('3. Viem Wallet Client - REAL-WORLD EXAMPLE (truf-claim-page)\n');
  console.log('All examples will call the whoami action to verify the integration.\n');

  // Run test wallet example
  console.log('Running Example 1: Test Wallet\n');
  await testWithPrivateKey();
  
  console.log('\n\n================================================\n\n');
  
  // Run connected wallet example
  console.log('Running Example 2: Connected Wallet\n');
  await testWithConnectedWallet();
  
  console.log('\n\n================================================\n\n');
  
  // Run viem wallet example
  console.log('Running Example 3: Viem Wallet Client\n');
  await testWithViemWallet();

  console.log('\n================================================');
  console.log('Summary');
  console.log('================================================\n');
  console.log('✅ All examples successfully demonstrated wallet integration with TNClient');
  console.log('✅ The whoami action confirmed wallet authentication in all cases');
}

// Run all examples
if (require.main === module) {
  runAllExamples()
    .then(() => {
      console.log('\n✅ All examples completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error running examples:', error);
      process.exit(1);
    });
}

export { runAllExamples };