import { describe, expect } from "vitest";
import { createTestContexts, setupTrufNetwork } from "./utils";
import { MANAGER_PRIVATE_KEY } from "./trufnetwork.setup";
import { StreamId } from "../../src/util/StreamId";

// -----------------------------------------------------------------------------
// Test wallets
// -----------------------------------------------------------------------------
// "manager" is assumed to already possess the `system:network_writers_manager`
// role as bootstrapped by the test migration process, which allows it to grant
// and revoke the `system:network_writer` role for other wallets.  The
// `newWriter` wallet will be granted / revoked in the tests, while `randomUser`
// never receives any role membership.
// -----------------------------------------------------------------------------
const ROLE_TEST_WALLETS = {
  manager: MANAGER_PRIVATE_KEY,
  newWriter: "0x2222222222222222222222222222222222222222222222222222222222222222",
  randomUser: "0x3333333333333333333333333333333333333333333333333333333333333333",
} as const;

const roleTest = createTestContexts(ROLE_TEST_WALLETS, { autoGrantNetworkWriter: false });

describe.sequential("Role Management", { timeout: 120000 }, () => {
  // Spin up/tear down the local TN+Postgres containers once for this suite.
  setupTrufNetwork();

  roleTest(
    "should grant, revoke and validate the system:network_writer role",
    async ({ managerClient, newWriterClient, randomUserClient }) => {
      // ---------------------------------------------------------------------
      // Helper wrappers
      // ---------------------------------------------------------------------
      const managerAddress = managerClient.address();
      const newWriterAddress = newWriterClient.address();
      const randomUserAddress = randomUserClient.address();

      // Initially, the manager wallet should NOT belong to `system:network_writer`.
      // It only has `system:network_writers_manager`, which grants the ability
      // to manage writer memberships.
      expect(
        await managerClient.isMemberOf({
          owner: "system",
          roleName: "network_writer",
          wallet: managerAddress,
        }),
      ).toBe(false);

      expect(
        await newWriterClient.isMemberOf({
          owner: "system",
          roleName: "network_writer",
          wallet: newWriterAddress,
        }),
      ).toBe(false);

      expect(
        await randomUserClient.isMemberOf({
          owner: "system",
          roleName: "network_writer",
          wallet: randomUserAddress,
        }),
      ).toBe(false);

      // -------------------------------------------------------------------
      // Grant role to `newWriter` (performed by the manager)
      // -------------------------------------------------------------------
      const grantTxHash = await managerClient.grantRole({
        owner: "system",
        roleName: "network_writer",
        wallets: newWriterAddress,
      });
      await managerClient.waitForTx(grantTxHash);

      // Validate membership after grant
      expect(
        await newWriterClient.isMemberOf({
          owner: "system",
          roleName: "network_writer",
          wallet: newWriterAddress,
        }),
      ).toBe(true);

      // -------------------------------------------------------------------
      // `newWriter` should now be able to deploy a primitive stream
      // -------------------------------------------------------------------
      const grantedStreamId = await StreamId.generate("role-test-granted");
      const deployResGranted = await newWriterClient.deployStream(
        grantedStreamId,
        "primitive",
        true,
      );
      expect(deployResGranted.status).toBe(200);

      // Clean-up the stream so the test node stays tidy
      await newWriterClient.destroyStream(
        {
          streamId: grantedStreamId,
          dataProvider: newWriterAddress,
        },
        true,
      );

      // -------------------------------------------------------------------
      // Revoke role from `newWriter`
      // -------------------------------------------------------------------
      const revokeTxHash = await managerClient.revokeRole({
        owner: "system",
        roleName: "network_writer",
        wallets: newWriterAddress,
      });
      await managerClient.waitForTx(revokeTxHash);

      // Validate membership after revoke
      expect(
        await newWriterClient.isMemberOf({
          owner: "system",
          roleName: "network_writer",
          wallet: newWriterAddress,
        }),
      ).toBe(false);

      // -------------------------------------------------------------------
      // Deployment should now fail for `newWriter` since the role was revoked
      // -------------------------------------------------------------------
      const revokedStreamId = await StreamId.generate("role-test-revoked");
      await expect(
        newWriterClient.deployStream(revokedStreamId, "primitive", true),
      ).rejects.toThrow();

      // -------------------------------------------------------------------
      // `randomUser` (never granted) should also fail to deploy
      // -------------------------------------------------------------------
      const randomStreamId = await StreamId.generate("role-test-random");
      await expect(
        randomUserClient.deployStream(randomStreamId, "primitive", true),
      ).rejects.toThrow();
    },
  );
}); 