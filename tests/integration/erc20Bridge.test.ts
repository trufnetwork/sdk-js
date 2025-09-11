import { describe, expect } from "vitest";
import { setupTrufNetwork, testWithDefaultWallet } from "./utils";
import { StreamId } from "../../src/util/StreamId";

describe.sequential("ERC20 Bridge Tests", { timeout: 90000 }, () => {
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

  testWithDefaultWallet(
    "should get wallet balance",
    async ({ defaultClient }) => {
      const balance = defaultClient.getWalletBalance("sepolia", "0x9160BBD07295b77BB168FF6295D66C74E575B5BE")

      expect(balance).toBeGreaterThanOrEqual(0n)
    }
  )
});