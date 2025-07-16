import { describe, it, expect } from 'vitest';
import { CacheMetadataParser } from './cacheMetadataParser';

describe('CacheMetadataParser', () => {
  describe('extractFromLogs', () => {
    it('should extract cache hit metadata from valid log', () => {
      const logs = ['{"cache_hit": true, "cached_at": 1609459200}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cachedAt: 1609459200
      });
    });

    it('should extract cache miss metadata from valid log', () => {
      const logs = ['{"cache_hit": false}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: false,
        cachedAt: undefined
      });
    });

    it('should handle cache hit without cached_at field', () => {
      const logs = ['{"cache_hit": true}'];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cachedAt: undefined
      });
    });

    it('should handle single string log with newlines', () => {
      const log = 'other log entry\n{"cache_hit": true, "cached_at": 1609459200}\nmore logs';
      const result = CacheMetadataParser.extractFromLogs(log);
      
      expect(result).toEqual({
        hit: true,
        cachedAt: 1609459200
      });
    });

    it('should handle array of logs', () => {
      const logs = [
        'normal log entry',
        '{"cache_hit": true, "cached_at": 1609459200}',
        'another log'
      ];
      const result = CacheMetadataParser.extractFromLogs(logs);
      
      expect(result).toEqual({
        hit: true,
        cachedAt: 1609459200
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
  });

  describe('isValidCacheMetadata', () => {
    it('should validate correct cache metadata', () => {
      const metadata = { hit: true, cachedAt: 1609459200 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should validate metadata without cachedAt', () => {
      const metadata = { hit: false };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(true);
    });

    it('should reject metadata without hit field', () => {
      const metadata = { cachedAt: 1609459200 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid hit type', () => {
      const metadata = { hit: 'true', cachedAt: 1609459200 };
      expect(CacheMetadataParser.isValidCacheMetadata(metadata)).toBe(false);
    });

    it('should reject metadata with invalid cachedAt type', () => {
      const metadata = { hit: true, cachedAt: '1609459200' };
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
        logs: ['{"cache_hit": true, "cached_at": 1609459200}']
      };
      const result = CacheMetadataParser.extractFromResponse(response);
      
      expect(result).toEqual({
        hit: true,
        cachedAt: 1609459200
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
});