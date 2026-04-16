import { describe, expect, it } from "vitest";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";

describe.sequential(
  "Transaction History Integration Tests",
  { timeout: 360000 },
  () => {
    // Spin up/tear down the local TN+Postgres containers once for this suite.
    setupTrufNetwork();

    testWithDefaultWallet(
      "should return empty history for new wallet",
      async ({ defaultClient }) => {
        const walletAddress = defaultClient.address().getAddress();
        
        // Test with different bridge identifiers
        const bridges = ["hoodi_tt", "hoodi_tt2", "sepolia"];
        
        for (const bridge of bridges) {
            console.log(`Testing history for bridge: ${bridge}`);
            const history = await defaultClient.getHistory(bridge, walletAddress, 10, 0);
            
            expect(Array.isArray(history)).toBe(true);
            expect(history.length).toBe(0);
            console.log(`✅ History for ${bridge} is empty as expected`);
        }
      }
    );

    testWithDefaultWallet(
      "should accept pagination parameters",
      async ({ defaultClient }) => {
        const walletAddress = defaultClient.address().getAddress();
        
        // This should not throw
        const history = await defaultClient.getHistory("hoodi_tt2", walletAddress, 5, 10);
        expect(Array.isArray(history)).toBe(true);
        console.log(`✅ Pagination parameters accepted`);

        console.log("Sleeping for 60s to allow log inspection...");
        await new Promise(r => setTimeout(r, 60000));
      }
    );
  }
);
