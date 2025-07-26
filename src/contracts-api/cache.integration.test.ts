import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Action } from './action';
import { EthereumAddress } from '../util/EthereumAddress';
import { StreamId } from '../util/StreamId';
import type { StreamLocator } from '../types/stream';
import { CacheMetadata } from '../types/cache';

// Mock Kwil client
const mockKwilClient = {
  call: vi.fn(),
  execute: vi.fn()
};

const mockKwilSigner = {};

describe('Cache Integration Tests', () => {
  let action: Action;
  let streamLocator: StreamLocator;

  beforeEach(() => {
    action = new Action(mockKwilClient as any, mockKwilSigner as any);
    streamLocator = {
      streamId: StreamId.fromString('test-stream').unwrap(),
      dataProvider: new EthereumAddress('0x1234567890123456789012345678901234567890')
    };
    
    // Reset mocks
    vi.clearAllMocks();
  });

  describe('getRecord cache functionality', () => {
    it('should handle cache-aware getRecord call', async () => {
      const mockResponse = {
        status: 200,
        data: {
          result: [
            { event_time: 1609459200, value: '100' },
            { event_time: 1609459260, value: '101' }
          ],
          logs: '1. cache_hit: true\n2. other log\n111. cache_miss: false'
        }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getRecord(streamLocator, {
        from: 1609459200,
        to: 1609459300,
        useCache: true
      });

      expect(mockKwilClient.call).toHaveBeenCalledWith(
        {
          namespace: 'main',
          name: 'get_record',
          inputs: {
            $data_provider: '0x1234567890123456789012345678901234567890',
            $stream_id: 'test-stream',
            $from: 1609459200,
            $to: 1609459300,
            $frozen_at: undefined,
            $use_cache: true
          }
        },
        mockKwilSigner
      );

      expect(result).toEqual({
        data: [
          { eventTime: 1609459200, value: '100' },
          { eventTime: 1609459260, value: '101' }
        ],
        cache: undefined,
        logs: ['cache_hit: true', 'other log', 'cache_miss: false']
      });
    });

    it('should handle cache-aware getRecord call with cache metadata', async () => {
      const mockResponse = {
        status: 200,
        data: {
          result: [
            { event_time: 1609459200, value: '100' }
          ],
          logs: '1. {"cache_hit":true,"cache_disabled":false,"cache_height":148670}'
        }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getRecord(streamLocator, {
        useCache: true
      });

      // Cache metadata extraction happens in the parser
      // We'll just verify the structure is correct
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('cache');
      expect(result).toHaveProperty('logs');
      expect(result.data).toEqual([
        { eventTime: 1609459200, value: '100' }
      ]);

      expect(result.cache).toMatchObject({
        hit: true,
        cacheDisabled: false,
        height: 148670,
        dataProvider: '0x1234567890123456789012345678901234567890',
        from: undefined,
        frozenAt: undefined,
        rowsServed: 1,
        streamId: 'test-stream',
        to: undefined
      } as CacheMetadata);

      expect(result.logs).toMatchObject(['{"cache_hit":true,"cache_disabled":false,"cache_height":148670}']);
    });

    it('should omit useCache parameter when not provided', async () => {
      const mockResponse = {
        status: 200,
        data: { result: [] }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      await action.getRecord(streamLocator, {
        from: 1609459200
      });

      expect(mockKwilClient.call).toHaveBeenCalledWith(
        {
          namespace: 'main',
          name: 'get_record',
          inputs: {
            $data_provider: '0x1234567890123456789012345678901234567890',
            $stream_id: 'test-stream',
            $from: 1609459200,
            $to: undefined,
            $frozen_at: undefined
          }
        },
        mockKwilSigner
      );
    });

    it('should handle error responses', async () => {
      mockKwilClient.call.mockResolvedValue({
        status: 500,
        data: null
      });

      await expect(action.getRecord(streamLocator, { useCache: true }))
        .rejects.toThrow('Failed to get record: 500');
    });
  });

  describe('getIndex cache functionality', () => {
    it('should handle cache-aware getIndex call', async () => {
      const mockResponse = {
        status: 200,
        data: {
          result: [
            { event_time: 1609459200, value: '100' }
          ]
        }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getIndex(streamLocator, {
        from: 1609459200,
        to: 1609459300,
        baseTime: 1609459180,
        useCache: true
      });

      expect(mockKwilClient.call).toHaveBeenCalledWith(
        {
          namespace: 'main',
          name: 'get_index',
          inputs: {
            $data_provider: '0x1234567890123456789012345678901234567890',
            $stream_id: 'test-stream',
            $from: 1609459200,
            $to: 1609459300,
            $frozen_at: undefined,
            $base_time: 1609459180,
            $use_cache: true
          }
        },
        mockKwilSigner
      );

      expect(result.data).toEqual([
        { eventTime: 1609459200, value: '100' }
      ]);
    });
  });

  describe('getFirstRecord cache functionality', () => {
    it('should handle cache-aware getFirstRecord call', async () => {
      const mockResponse = {
        status: 200,
        data: {
          result: [
            { event_time: 1609459200, value: '100' }
          ]
        }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getFirstRecord(streamLocator, {
        after: 1609459180,
        useCache: true
      });

      expect(mockKwilClient.call).toHaveBeenCalledWith(
        {
          namespace: 'main',
          name: 'get_first_record',
          inputs: {
            $data_provider: '0x1234567890123456789012345678901234567890',
            $stream_id: 'test-stream',
            $after: 1609459180,
            $frozen_at: undefined,
            $use_cache: true
          }
        },
        mockKwilSigner
      );

      expect(result.data).toEqual({
        eventTime: 1609459200,
        value: '100'
      });
    });

    it('should handle empty result for getFirstRecord', async () => {
      const mockResponse = {
        status: 200,
        data: { result: [] }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getFirstRecord(streamLocator, {
        useCache: true
      });

      expect(result.data).toBeNull();
    });
  });

  describe('getIndexChange cache functionality', () => {
    it('should handle cache-aware getIndexChange call', async () => {
      const mockResponse = {
        status: 200,
        data: {
          result: [
            { event_time: 1609459200, value: '5.2' }
          ]
        }
      };

      mockKwilClient.call.mockResolvedValue(mockResponse);

      const result = await action.getIndexChange(streamLocator, {
        from: 1609459200,
        to: 1609459300,
        timeInterval: 60,
        useCache: true
      });

      expect(mockKwilClient.call).toHaveBeenCalledWith(
        {
          namespace: 'main',
          name: 'get_index_change',
          inputs: {
            $data_provider: '0x1234567890123456789012345678901234567890',
            $stream_id: 'test-stream',
            $from: 1609459200,
            $to: 1609459300,
            $frozen_at: undefined,
            $base_time: undefined,
            $time_interval: 60,
            $use_cache: true
          }
        },
        mockKwilSigner
      );

      expect(result.data).toEqual([
        { eventTime: 1609459200, value: '5.2' }
      ]);
    });

    it('should require options parameter for getIndexChange', async () => {
      await expect((action.getIndexChange as any)(streamLocator))
        .rejects.toThrow('Options parameter is required for cache-aware getIndexChange');
    });
  });

  describe('parameter validation', () => {
    it('should validate cache parameters', async () => {
      await expect(action.getRecord(streamLocator, { useCache: 'true' as any }))
        .rejects.toThrow('Invalid useCache parameter: must be a boolean');

      await expect(action.getRecord(streamLocator, { from: -1 }))
        .rejects.toThrow('Invalid from parameter: must be a non-negative number');

      await expect(action.getRecord(streamLocator, { from: 100, to: 50 }))
        .rejects.toThrow('Invalid time range: from time cannot be greater than to time');
    });
  });
});