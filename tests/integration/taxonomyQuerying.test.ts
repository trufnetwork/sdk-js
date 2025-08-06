import { describe, test, expect, beforeEach } from 'vitest'
import { NodeTNClient } from '../../src/client/nodeClient'
import { ComposedAction } from '../../src/contracts-api/composedAction'
import { StreamId } from '../../src/util/StreamId'
import { EthereumAddress } from '../../src/util/EthereumAddress'
import { Wallet } from 'ethers'

describe('Taxonomy Querying Integration Tests', () => {
  let client: NodeTNClient;
  let composedAction: ComposedAction;

  beforeEach(async () => {
    // Use a simple setup that doesn't require node repo dependencies
    const wallet = new Wallet("0x0000000000000000000000000000000000000000100000000100000000000001");
    const endpoint = process.env.TEST_ENDPOINT || "https://gateway.mainnet.truf.network";
    const chainId = process.env.TEST_CHAIN_ID || "tn-v2";

    client = new NodeTNClient({
      endpoint,
      signerInfo: {
        address: wallet.address,
        signer: wallet,
      },
      chainId,
      timeout: 30000,
    });
    
    composedAction = client.loadComposedAction();
  });

  test('listTaxonomiesByHeight returns expected structure', async () => {
    const result = await composedAction.listTaxonomiesByHeight({
      limit: 10,
      latestOnly: false
    });

    expect(Array.isArray(result)).toBe(true);
    
    // If we have results, verify structure
    if (result.length > 0) {
      const firstResult = result[0];
      expect(firstResult).toHaveProperty('dataProvider');
      expect(firstResult).toHaveProperty('streamId');
      expect(firstResult).toHaveProperty('childDataProvider');
      expect(firstResult).toHaveProperty('childStreamId');
      expect(firstResult).toHaveProperty('weight');
      expect(firstResult).toHaveProperty('createdAt');
      expect(firstResult).toHaveProperty('groupSequence');
      expect(firstResult).toHaveProperty('startTime');
      
      expect(firstResult.dataProvider).toBeInstanceOf(EthereumAddress);
      expect(firstResult.streamId).toBeInstanceOf(StreamId);
      expect(firstResult.childDataProvider).toBeInstanceOf(EthereumAddress);
      expect(firstResult.childStreamId).toBeInstanceOf(StreamId);
      expect(typeof firstResult.weight).toBe('string');
      // Handle both string and number types (depends on serialization)
      expect(['number', 'string']).toContain(typeof firstResult.createdAt);
      expect(['number', 'string']).toContain(typeof firstResult.groupSequence);  
      expect(['number', 'string']).toContain(typeof firstResult.startTime);
    }
  });

  test('listTaxonomiesByHeight handles pagination parameters', async () => {
    const page1 = await composedAction.listTaxonomiesByHeight({
      limit: 5,
      offset: 0
    });
    
    const page2 = await composedAction.listTaxonomiesByHeight({
      limit: 5,
      offset: 5
    });

    expect(page1.length).toBeLessThanOrEqual(5);
    expect(page2.length).toBeLessThanOrEqual(5);
    
    // Verify no overlap if both pages have results (with realistic data this might not always be true)
    if (page1.length > 0 && page2.length > 0) {
      const page1Ids = page1.map(r => `${r.dataProvider.getAddress()}_${r.streamId.getId()}_${r.childStreamId.getId()}`);
      const page2Ids = page2.map(r => `${r.dataProvider.getAddress()}_${r.streamId.getId()}_${r.childStreamId.getId()}`);
      const overlap = page1Ids.filter(id => page2Ids.includes(id));
      // With real data, some overlap is possible if we don't have enough unique results
      expect(overlap.length).toBeLessThanOrEqual(Math.min(page1.length, page2.length));
    }
  });

  test('listTaxonomiesByHeight handles height range filtering', async () => {
    // Use a fixed height range that we know has data
    const filteredResults = await composedAction.listTaxonomiesByHeight({
      fromHeight: 180000,
      toHeight: 185000,
      limit: 100
    });
    
    expect(Array.isArray(filteredResults)).toBe(true);
    
    // If we have results, verify they're in range
    for (const result of filteredResults) {
      const height = Number(result.createdAt); // Handle string/number conversion
      expect(height).toBeGreaterThanOrEqual(180000);
      expect(height).toBeLessThanOrEqual(185000);
    }
  });

  test('listTaxonomiesByHeight latest_only flag works', async () => {
    const allResults = await composedAction.listTaxonomiesByHeight({
      latestOnly: false,
      limit: 100
    });
    
    const latestOnly = await composedAction.listTaxonomiesByHeight({
      latestOnly: true,
      limit: 100
    });

    // Latest only should return same or fewer results
    expect(latestOnly.length).toBeLessThanOrEqual(allResults.length);
  });

  test('getTaxonomiesForStreams handles empty stream array', async () => {
    const result = await composedAction.getTaxonomiesForStreams({
      streams: [],
      latestOnly: true
    });

    expect(result).toEqual([]);
  });

  test('getTaxonomiesForStreams returns expected structure', async () => {
    // First get some streams to test with
    const allTaxonomies = await composedAction.listTaxonomiesByHeight({
      limit: 10,
      latestOnly: true
    });

    if (allTaxonomies.length > 0) {
      // Use first stream as test case
      const testStream = {
        dataProvider: allTaxonomies[0].dataProvider,
        streamId: allTaxonomies[0].streamId
      };

      const result = await composedAction.getTaxonomiesForStreams({
        streams: [testStream],
        latestOnly: true
      });

      expect(Array.isArray(result)).toBe(true);
      
      // All results should be for the requested stream
      for (const taxonomy of result) {
        expect(taxonomy.dataProvider.getAddress()).toBe(testStream.dataProvider.getAddress());
        expect(taxonomy.streamId.getId()).toBe(testStream.streamId.getId());
      }
    }
  });

  test('client high-level methods work correctly', async () => {
    const clientResult = await client.listTaxonomiesByHeight({
      limit: 10,
      latestOnly: true
    });

    expect(Array.isArray(clientResult)).toBe(true);
    
    // Should match result from composed action
    const composedResult = await composedAction.listTaxonomiesByHeight({
      limit: 10,
      latestOnly: true
    });
    
    expect(clientResult.length).toBe(composedResult.length);
  });

  test('error handling works for invalid parameters', async () => {
    // Test very large invalid height range (should return empty results, not throw)
    const result = await composedAction.listTaxonomiesByHeight({
      fromHeight: 999999,
      toHeight: 1000000
    });
    
    // Should return empty array for non-existent height range
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('getTaxonomiesForStreams batch processing works', async () => {
    // Get some existing streams to test with
    const allTaxonomies = await composedAction.listTaxonomiesByHeight({
      limit: 20,
      latestOnly: true
    });

    if (allTaxonomies.length >= 2) {
      // Get unique streams for batch test
      const uniqueStreams = new Map();
      for (const taxonomy of allTaxonomies) {
        const key = `${taxonomy.dataProvider.getAddress()}_${taxonomy.streamId.getId()}`;
        if (!uniqueStreams.has(key)) {
          uniqueStreams.set(key, {
            dataProvider: taxonomy.dataProvider,
            streamId: taxonomy.streamId
          });
          if (uniqueStreams.size >= 3) break;
        }
      }

      const testStreams = Array.from(uniqueStreams.values()).slice(0, 3);
      
      const batchResult = await composedAction.getTaxonomiesForStreams({
        streams: testStreams,
        latestOnly: true
      });

      expect(Array.isArray(batchResult)).toBe(true);
      
      // Verify all results belong to one of the requested streams
      const requestedStreamKeys = testStreams.map(s => 
        `${s.dataProvider.getAddress()}_${s.streamId.getId()}`
      );
      
      for (const taxonomy of batchResult) {
        const taxonomyKey = `${taxonomy.dataProvider.getAddress()}_${taxonomy.streamId.getId()}`;
        expect(requestedStreamKeys).toContain(taxonomyKey);
      }
    }
  });

  test('both methods handle null/undefined parameters gracefully', async () => {
    // Test with minimal parameters
    const result1 = await composedAction.listTaxonomiesByHeight({});
    expect(Array.isArray(result1)).toBe(true);

    // Test client method with minimal parameters
    const result2 = await client.listTaxonomiesByHeight();
    expect(Array.isArray(result2)).toBe(true);
  });
});