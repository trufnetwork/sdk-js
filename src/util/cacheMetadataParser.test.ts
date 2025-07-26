import { describe, it, expect } from 'vitest';
import { CacheMetadataParser } from './cacheMetadataParser';
import type { CacheMetadata } from '../types/cache';

describe('CacheMetadataParser', () => {
  describe('extractFromLogs', () => {
    it('should extract cache hit metadata from valid log', () => {
      const logs = ['{"cache_hit": true, "cache_height": 123456}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should extract enhanced cache metadata with cacheDisabled field', () => {
      const logs = ['{"cache_hit": false, "cache_disabled": true}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: false,
        cacheDisabled: true,
        height: undefined
      });
    });

    it('should extract cache miss metadata from valid log', () => {
      const logs = ['{"cache_hit": false}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: false,
        cacheDisabled: undefined,
        height: undefined
      });
    });

    it('should handle cache hit without height field', () => {
      const logs = ['{"cache_hit": true}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: undefined
      });
    });

    it('should handle single string log with newlines', () => {
      const log = 'other log entry\n{"cache_hit": true, "cache_height": 123456}\nmore logs';
      const result = CacheMetadataParser.extractFromLogs(log);
      
      expect(result).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should handle array of logs', () => {
      const logs = [
        'normal log entry',
        '{"cache_hit": true, "cache_height": 123456}',
        'another log'
      ];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should return null for logs without cache metadata', () => {
      const logs = ['normal log entry', 'another log'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      const logs = ['{"cache_hit": true invalid json}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toBeNull();
    });

    it('should return null for empty logs', () => {
      const result = CacheMetadataParser.extractFromLogs([]);
      expect(result).toBeNull();
    });

    it('should handle empty string logs', () => {
      const result = CacheMetadataParser.extractFromLogs(['', '   ', '\n']);
      expect(result).toBeNull();
    });

    it('should extract cache hit metadata with all fields', () => {
      const logs = ['{"cache_hit": true, "cache_height": 123456}'];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      expect(metadata).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should extract cache hit without optional fields', () => {
      const logs = ['{"cache_hit": true}'];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      expect(metadata).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: undefined
      });
    });

    it('should extract cache miss', () => {
      const logs = ['{"cache_hit": false}'];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      expect(metadata).toEqual({
        hit: false,
        cacheDisabled: undefined,
        height: undefined
      });
    });

    it('should handle logs with prepended numeric prefixes', () => {
      const logs = ['1. {"cache_hit": true, "cache_height": 123456}\n2. some other log\n3. {"cache_hit": false}'];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      // Should extract the first cache metadata found (cache hit)
      expect(metadata).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should handle array of logs with prepended numeric prefixes', () => {
      const logs = [
        '1. normal log line',
        '2. {"cache_hit": false, "cache_disabled": true}',
        '3. another log line'
      ];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      expect(metadata).toEqual({
        hit: false,
        cacheDisabled: true,
        height: undefined
      });
    });

    it('should handle mixed format logs (some with prefixes, some without)', () => {
      const logs = [
        'normal log without prefix',
        '1. {"cache_hit": true}',
        'another log without prefix'
      ];
      const metadata = CacheMetadataParser.extractFromLogs(logs);
      expect(metadata).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: undefined
      });
    });
  });

  describe('isValidCacheMetadata', () => {
    it('should validate correct cache metadata', () => {
      const metadata = { hit: true, height: 123456 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should validate metadata without height', () => {
      const metadata = { hit: false };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should validate enhanced cache metadata with all fields', () => {
      const metadata: CacheMetadata = {
        hit: true,
        cacheDisabled: false,
        height: 123456,
        streamId: 'test-stream',
        dataProvider: '0x123456789abcdef',
        from: 1609459100,
        to: 1609459300,
        frozenAt: 1609459250,
        rowsServed: 10
      };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should validate metadata with optional fields', () => {
      const metadata = { hit: true, cacheDisabled: true };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should reject metadata without hit field', () => {
      const metadata = { height: 123456 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid hit type', () => {
      const metadata = { hit: 'true', height: 123456 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid cacheDisabled type', () => {
      const metadata = { hit: true, cacheDisabled: 'false' };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid streamId type', () => {
      const metadata = { hit: true, streamId: 123 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid dataProvider type', () => {
      const metadata = { hit: true, dataProvider: 456 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid numeric fields', () => {
      const invalidFromMetadata = { hit: true, from: '123' };
      const invalidToMetadata = { hit: true, to: '456' };
      const invalidFrozenAtMetadata = { hit: true, frozenAt: '789' };
      const invalidRowsServedMetadata = { hit: true, rowsServed: '10' };

      expect(CacheMetadataParser.isValidCacheMetadata(invalidFromMetadata)).toBe(false);
      expect(CacheMetadataParser.isValidCacheMetadata(invalidToMetadata)).toBe(false);
      expect(CacheMetadataParser.isValidCacheMetadata(invalidFrozenAtMetadata)).toBe(false);
      expect(CacheMetadataParser.isValidCacheMetadata(invalidRowsServedMetadata)).toBe(false);
    });

    it('should validate complete metadata', () => {
      const metadata = { hit: true, height: 123456 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should reject metadata with invalid height type', () => {
      const metadata = { hit: true, height: '123456' };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject null or undefined', () => {
      expect(CacheMetadataParser.isValidCacheMetadata(null)).toBe(false);
      expect(CacheMetadataParser.isValidCacheMetadata(undefined)).toBe(false);
    });
  });

  describe('extractFromResponse', () => {
    it('should extract from response with logs', () => {
      const response = {
        data: { result: [] },
        logs: ['{"cache_hit": true, "cache_height": 123456}']
      };
      const result = CacheMetadataParser.extractFromResponse(response);
      
      expect(result).toEqual({
        hit: true,
        cacheDisabled: undefined,
        height: 123456
      });
    });

    it('should return null for response without logs', () => {
      const response = { data: { result: [] } };
      const result = CacheMetadataParser.extractFromResponse(response);
      
      expect(result).toBeNull();
    });

    it('should return null for null response', () => {
      const result = CacheMetadataParser.extractFromResponse(null);
      expect(result).toBeNull();
    });
  });

  describe('aggregate', () => {
    it('should aggregate empty metadata list', () => {
      const result = CacheMetadataParser.aggregate([]);
      
      expect(result).toEqual({
        totalQueries: 0,
        cacheHits: 0,
        cacheMisses: 0,
        cacheHitRate: 0,
        totalRowsServed: 0,
        entries: []
      });
    });

    it('should aggregate single metadata entry', () => {
      const metadata: CacheMetadata = {
        hit: true,
        height: 123456,
        streamId: 'test-stream',
        rowsServed: 5
      };
      
      const result = CacheMetadataParser.aggregate([metadata]);
      
      expect(result).toEqual({
        totalQueries: 1,
        cacheHits: 1,
        cacheMisses: 0,
        cacheHitRate: 1.0,
        totalRowsServed: 5,
        entries: [metadata]
      });
    });

    it('should aggregate multiple metadata entries', () => {
      const metadata1: CacheMetadata = {
        hit: true,
        height: 123456,
        streamId: 'stream-1',
        rowsServed: 10
      };
      
      const metadata2: CacheMetadata = {
        hit: false,
        streamId: 'stream-2',
        rowsServed: 5
      };
      
      const metadata3: CacheMetadata = {
        hit: true,
        height: 123457,
        streamId: 'stream-3',
        rowsServed: 15
      };
      
      const result = CacheMetadataParser.aggregate([metadata1, metadata2, metadata3]);
      
      expect(result).toEqual({
        totalQueries: 3,
        cacheHits: 2,
        cacheMisses: 1,
        cacheHitRate: 2/3,
        totalRowsServed: 30,
        entries: [metadata1, metadata2, metadata3]
      });
    });

    it('should handle metadata without rowsServed', () => {
      const metadata1: CacheMetadata = { hit: true, height: 123456 };
      const metadata2: CacheMetadata = { hit: false };
      const metadata3: CacheMetadata = { hit: true, rowsServed: 8 };
      
      const result = CacheMetadataParser.aggregate([metadata1, metadata2, metadata3]);
      
      expect(result).toEqual({
        totalQueries: 3,
        cacheHits: 2,
        cacheMisses: 1,
        cacheHitRate: 2/3,
        totalRowsServed: 8, // Only metadata3 has rowsServed
        entries: [metadata1, metadata2, metadata3]
      });
    });

    it('should calculate correct cache hit rate for mixed results', () => {
      const metadataList: CacheMetadata[] = [
        { hit: true, rowsServed: 1 },
        { hit: false, rowsServed: 2 },
        { hit: false, rowsServed: 3 },
        { hit: true, rowsServed: 4 },
        { hit: true, rowsServed: 5 }
      ];
      
      const result = CacheMetadataParser.aggregate(metadataList);
      
      expect(result.totalQueries).toBe(5);
      expect(result.cacheHits).toBe(3);
      expect(result.cacheMisses).toBe(2);
      expect(result.cacheHitRate).toBe(0.6); // 3/5 = 0.6
      expect(result.totalRowsServed).toBe(15); // 1+2+3+4+5 = 15
    });
  });
});