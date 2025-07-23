import { describe, it, expect } from 'vitest';
import { CacheError } from './cache';
import type { 
  CacheMetadata, 
  CacheAwareResponse, 
  CacheMetadataCollection,
  GetRecordOptions, 
  GetIndexOptions, 
  GetIndexChangeOptions, 
  GetFirstRecordOptions 
} from './cache';

describe('Cache Types', () => {
  describe('CacheMetadata', () => {
    it('should allow valid cache metadata', () => {
      const metadata: CacheMetadata = { hit: true, cachedAt: 1609459200 };
      expect(metadata.hit).toBe(true);
      expect(metadata.cachedAt).toBe(1609459200);
    });

    it('should create cache metadata with all fields', () => {
      const metadata: CacheMetadata = { hit: true, cachedAt: 1609459200, height: 123456 };
      expect(metadata.hit).toBe(true);
      expect(metadata.cachedAt).toBe(1609459200);
      expect(metadata.height).toBe(123456);
    });

    it('should allow cache metadata without optional fields', () => {
      const metadata: CacheMetadata = { hit: false };
      expect(metadata.hit).toBe(false);
      expect(metadata.cachedAt).toBeUndefined();
      expect(metadata.height).toBeUndefined();
    });

    it('should allow enhanced cache metadata with all fields', () => {
      const metadata: CacheMetadata = {
        hit: true,
        cacheDisabled: false,
        cachedAt: 1609459200,
        streamId: 'test-stream',
        dataProvider: '0x123456789abcdef',
        from: 1609459100,
        to: 1609459300,
        frozenAt: 1609459250,
        rowsServed: 10
      };
      
      expect(metadata.hit).toBe(true);
      expect(metadata.cacheDisabled).toBe(false);
      expect(metadata.cachedAt).toBe(1609459200);
      expect(metadata.streamId).toBe('test-stream');
      expect(metadata.dataProvider).toBe('0x123456789abcdef');
      expect(metadata.from).toBe(1609459100);
      expect(metadata.to).toBe(1609459300);
      expect(metadata.frozenAt).toBe(1609459250);
      expect(metadata.rowsServed).toBe(10);
    });

    it('should allow partial enhanced metadata', () => {
      const metadata: CacheMetadata = {
        hit: true,
        cacheDisabled: true,
        streamId: 'partial-stream'
      };
      
      expect(metadata.hit).toBe(true);
      expect(metadata.cacheDisabled).toBe(true);
      expect(metadata.streamId).toBe('partial-stream');
      expect(metadata.cachedAt).toBeUndefined();
    });
  });

  describe('CacheMetadataCollection', () => {
    it('should allow valid cache metadata collection', () => {
      const collection: CacheMetadataCollection = {
        totalQueries: 5,
        cacheHits: 3,
        cacheMisses: 2,
        cacheHitRate: 0.6,
        totalRowsServed: 100,
        entries: [
          { hit: true, rowsServed: 30 },
          { hit: false, rowsServed: 25 },
          { hit: true, rowsServed: 45 }
        ]
      };
      
      expect(collection.totalQueries).toBe(5);
      expect(collection.cacheHits).toBe(3);
      expect(collection.cacheMisses).toBe(2);
      expect(collection.cacheHitRate).toBe(0.6);
      expect(collection.totalRowsServed).toBe(100);
      expect(collection.entries).toHaveLength(3);
    });
  });

  describe('CacheAwareResponse', () => {
    it('should allow response with cache metadata', () => {
      const response: CacheAwareResponse<string[]> = {
        data: ['test1', 'test2'],
        cache: { hit: true, cachedAt: 1609459200 },
        logs: ['log1', 'log2']
      };
      
      expect(response.data).toEqual(['test1', 'test2']);
      expect(response.cache?.hit).toBe(true);
      expect(response.logs).toEqual(['log1', 'log2']);
    });

    it('should create cache aware response with all fields', () => {
      const response: CacheAwareResponse<string> = {
        data: 'test',
        cache: { hit: true, cachedAt: 1609459200, height: 123456 },
        logs: ['log1']
      };
      expect(response.data).toBe('test');
      expect(response.cache?.hit).toBe(true);
      expect(response.cache?.cachedAt).toBe(1609459200);
      expect(response.cache?.height).toBe(123456);
      expect(response.logs).toEqual(['log1']);
    });

    it('should allow response without cache metadata', () => {
      const response: CacheAwareResponse<string[]> = {
        data: ['test1', 'test2']
      };
      
      expect(response.data).toEqual(['test1', 'test2']);
      expect(response.cache).toBeUndefined();
      expect(response.logs).toBeUndefined();
    });
  });

  describe('GetRecordOptions', () => {
    it('should allow all valid options', () => {
      const options: GetRecordOptions = {
        from: 1609459200,
        to: 1609545600,
        frozenAt: 1609459200,
        baseTime: 1609459200,
        prefix: 'test_',
        useCache: true
      };
      
      expect(options.from).toBe(1609459200);
      expect(options.useCache).toBe(true);
    });

    it('should allow string baseTime', () => {
      const options: GetRecordOptions = {
        baseTime: '2021-01-01',
        useCache: false
      };
      
      expect(options.baseTime).toBe('2021-01-01');
    });

    it('should allow empty options', () => {
      const options: GetRecordOptions = {};
      expect(options.useCache).toBeUndefined();
    });
  });

  describe('GetIndexOptions', () => {
    it('should allow all valid options', () => {
      const options: GetIndexOptions = {
        from: 1609459200,
        to: 1609545600,
        frozenAt: 1609459200,
        baseTime: 1609459200,
        prefix: 'test_',
        useCache: true
      };
      
      expect(options.useCache).toBe(true);
    });
  });

  describe('GetIndexChangeOptions', () => {
    it('should allow all valid options including timeInterval', () => {
      const options: GetIndexChangeOptions = {
        from: 1609459200,
        to: 1609545600,
        frozenAt: 1609459200,
        baseTime: 1609459200,
        timeInterval: 3600,
        prefix: 'test_',
        useCache: true
      };
      
      expect(options.timeInterval).toBe(3600);
      expect(options.useCache).toBe(true);
    });

    it('should require timeInterval', () => {
      // This should compile - timeInterval is required
      const options: GetIndexChangeOptions = {
        timeInterval: 3600
      };
      
      expect(options.timeInterval).toBe(3600);
    });
  });

  describe('GetFirstRecordOptions', () => {
    it('should allow all valid options', () => {
      const options: GetFirstRecordOptions = {
        after: 1609459200,
        frozenAt: 1609459200,
        useCache: true
      };
      
      expect(options.after).toBe(1609459200);
      expect(options.useCache).toBe(true);
    });

    it('should allow empty options', () => {
      const options: GetFirstRecordOptions = {};
      expect(options.useCache).toBeUndefined();
    });
  });

  describe('CacheError', () => {
    it('should create error with message', () => {
      const error = new CacheError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('CacheError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new CacheError('Test error', cause);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('CacheError');
      expect(error.cause).toBe(cause);
    });

    it('should be instanceof Error', () => {
      const error = new CacheError('Test error');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof CacheError).toBe(true);
    });
  });
});