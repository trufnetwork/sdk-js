import { describe, expect } from "vitest";
import { testWithDefaultWallet } from "./utils";

describe.sequential("Get Database Size", { timeout: 90000 }, () => {
  testWithDefaultWallet.skipIf(process.env.CI)(
    "should get database size",
    async ({ defaultClient }) => {
      const actions = defaultClient.loadAction()
      const databaseSize = await actions.getDatabaseSize()

      expect(databaseSize).toBeGreaterThan(0)
    }
  )
});