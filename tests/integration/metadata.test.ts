import { describe, test, expect, beforeEach } from 'vitest'
import { NodeTNClient } from '../../src/client/nodeClient'
import { Action } from "../../src";
import { Wallet } from 'ethers'

describe('Metadata Tests', () => {
  let client: NodeTNClient;
  let action: Action;

  beforeEach(async () => {
    // Use a simple setup that doesn't require node repo dependencies
    const wallet = new Wallet("0x0000000000000000000000000000000000000000100000000100000000000001");
    const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
    const chainId = process.env.TEST_CHAIN_ID || "tn-v2.1";

    client = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });
    
    action = client.loadAction();
  });

  test('listMetadataByHeight returns expected structure', async () => {
      const result = await client.listMetadataByHeight({
        key: "read_visibility",
        limit: 1
      })
      expect(Array.isArray(result)).toBe(true);

      // If we have results, verify structure
      const firstResult = result[0];
      expect(firstResult).toHaveProperty('streamRef');
      expect(firstResult).toHaveProperty('rowId');
      expect(firstResult).toHaveProperty('valueInt');
      expect(firstResult).toHaveProperty('valueFloat');
      expect(firstResult).toHaveProperty('valueBoolean');
      expect(firstResult).toHaveProperty('valueString');
      expect(firstResult).toHaveProperty('valueRef');
      expect(firstResult).toHaveProperty('createdAt');
    },
  );
});