import { describe, it, expect } from 'vitest';
import { CacheError } from './cache';
import type { 
  CacheMetadata, 
  CacheAwareResponse, 
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

    it('should allow cache metadata without cachedAt', () => {
      const metadata: CacheMetadata = { hit: false };
      expect(metadata.hit).toBe(false);
      expect(metadata.cachedAt).toBeUndefined();
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