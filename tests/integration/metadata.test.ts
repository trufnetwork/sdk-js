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

      if (result.length === 0) return;

      // If we have results, verify structure
      const firstResult = result[0];
      expect(firstResult).toHaveProperty('streamId');
      expect(firstResult).toHaveProperty('dataProvider');
      expect(firstResult).toHaveProperty('rowId');
      expect(firstResult).toHaveProperty('valueInt');
      expect(firstResult).toHaveProperty('valueFloat');
      expect(firstResult).toHaveProperty('valueBoolean');
      expect(firstResult).toHaveProperty('valueString');
      expect(firstResult).toHaveProperty('valueRef');
      expect(firstResult).toHaveProperty('createdAt');
    },
  );

  test('listMetadataByHeight handles pagination parameters', async () => {
    const page1 = await action.listMetadataByHeight({
      key: "read_visibility",
      limit: 5,
      offset: 0
    });
    
    const page2 = await action.listMetadataByHeight({
      key: "read_visibility",
      limit: 5,
      offset: 5
    });

    expect(page1.length).toBeLessThanOrEqual(5);
    expect(page2.length).toBeLessThanOrEqual(5);
  });

  test('listMetadataByHeight handles height range filtering', async () => {
    // Use a fixed height range that we know has data
    const filteredResults = await action.listMetadataByHeight({
      key: "read_visibility",
      fromHeight: 180000,
      toHeight: 185000,
      limit: 10
    });
    
    expect(Array.isArray(filteredResults)).toBe(true);
    
    // If we have results, verify they're in range
    for (const result of filteredResults) {
      const height = Number(result.createdAt); // Handle string/number conversion
      expect(height).toBeGreaterThanOrEqual(180000);
      expect(height).toBeLessThanOrEqual(185000);
    }
  });

  test('client high-level methods work correctly', async () => {
    const clientResult = await client.listMetadataByHeight({
      key: "read_visibility",
      limit: 10
    });
    expect(Array.isArray(clientResult)).toBe(true);
    
    const actionResult = await action.listMetadataByHeight({
      key: "read_visibility",
      limit: 10
    });
    expect(clientResult.length).toBe(actionResult.length);
  });

  test('error handling works for invalid parameters', async () => {
    const result = await action.listMetadataByHeight({
      key: "read_visibility",
      fromHeight: 10,
      toHeight: 5
    });
    
    // Should return empty array for non-existent height range
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('handle null/undefined parameters gracefully', async () => {
    // Test with minimal parameters
    const result = await action.listMetadataByHeight({});
    expect(Array.isArray(result)).toBe(true);
  });
});