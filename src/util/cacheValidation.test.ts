import { describe, it, expect } from 'vitest';
import { CacheValidation } from './cacheValidation';

describe('CacheValidation', () => {
  describe('validateGetRecordOptions', () => {
    it('should validate correct options', () => {
      const options = {
        from: 1609459200,
        to: 1609545600,
        frozenAt: 1609459200,
        useCache: true,
        prefix: 'test_',
        baseTime: 1609459200
      };
      
      expect(() => CacheValidation.validateGetRecordOptions(options)).not.toThrow();
    });

    it('should validate options with string baseTime', () => {
      const options = {
        baseTime: '2021-01-01',
        useCache: true
      };
      
      expect(() => CacheValidation.validateGetRecordOptions(options)).not.toThrow();
    });

    it('should validate empty options', () => {
      expect(() => CacheValidation.validateGetRecordOptions({})).not.toThrow();
    });

    it('should throw for invalid from parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ from: -1 }))
        .toThrow('Invalid from parameter: must be a non-negative number');
      
      expect(() => CacheValidation.validateGetRecordOptions({ from: 'invalid' as any }))
        .toThrow('Invalid from parameter: must be a non-negative number');
    });

    it('should throw for invalid to parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ to: -1 }))
        .toThrow('Invalid to parameter: must be a non-negative number');
    });

    it('should throw for invalid frozenAt parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ frozenAt: -1 }))
        .toThrow('Invalid frozenAt parameter: must be a non-negative number');
    });

    it('should throw for invalid useCache parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ useCache: 'true' as any }))
        .toThrow('Invalid useCache parameter: must be a boolean');
    });

    it('should throw for invalid prefix parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ prefix: 123 as any }))
        .toThrow('Invalid prefix parameter: must be a string');
    });

    it('should throw for invalid baseTime parameter', () => {
      expect(() => CacheValidation.validateGetRecordOptions({ baseTime: true as any }))
        .toThrow('Invalid baseTime parameter: must be a number or string');
    });
  });

  describe('validateGetIndexChangeOptions', () => {
    it('should validate correct options', () => {
      const options = {
        from: 1609459200,
        to: 1609545600,
        timeInterval: 3600,
        useCache: true
      };
      
      expect(() => CacheValidation.validateGetIndexChangeOptions(options)).not.toThrow();
    });

    it('should throw for missing timeInterval', () => {
      const options = {
        from: 1609459200,
        to: 1609545600
      };
      
      expect(() => CacheValidation.validateGetIndexChangeOptions(options as any))
        .toThrow('Invalid timeInterval parameter: must be a positive number');
    });

    it('should throw for invalid timeInterval', () => {
      expect(() => CacheValidation.validateGetIndexChangeOptions({ timeInterval: -1 }))
        .toThrow('Invalid timeInterval parameter: must be a positive number');
      
      expect(() => CacheValidation.validateGetIndexChangeOptions({ timeInterval: 0 }))
        .toThrow('Invalid timeInterval parameter: must be a positive number');
      
      expect(() => CacheValidation.validateGetIndexChangeOptions({ timeInterval: 'invalid' as any }))
        .toThrow('Invalid timeInterval parameter: must be a positive number');
    });
  });

  describe('validateGetFirstRecordOptions', () => {
    it('should validate correct options', () => {
      const options = {
        after: 1609459200,
        frozenAt: 1609459200,
        useCache: true
      };
      
      expect(() => CacheValidation.validateGetFirstRecordOptions(options)).not.toThrow();
    });

    it('should throw for invalid after parameter', () => {
      expect(() => CacheValidation.validateGetFirstRecordOptions({ after: -1 }))
        .toThrow('Invalid after parameter: must be a non-negative number');
    });

    it('should throw for invalid frozenAt parameter', () => {
      expect(() => CacheValidation.validateGetFirstRecordOptions({ frozenAt: -1 }))
        .toThrow('Invalid frozenAt parameter: must be a non-negative number');
    });

    it('should throw for invalid useCache parameter', () => {
      expect(() => CacheValidation.validateGetFirstRecordOptions({ useCache: 'true' as any }))
        .toThrow('Invalid useCache parameter: must be a boolean');
    });
  });

  describe('validateTimeRange', () => {
    it('should validate correct time range', () => {
      expect(() => CacheValidation.validateTimeRange(1609459200, 1609545600)).not.toThrow();
    });

    it('should validate undefined parameters', () => {
      expect(() => CacheValidation.validateTimeRange(undefined, undefined)).not.toThrow();
      expect(() => CacheValidation.validateTimeRange(1609459200, undefined)).not.toThrow();
      expect(() => CacheValidation.validateTimeRange(undefined, 1609545600)).not.toThrow();
    });

    it('should validate equal times', () => {
      expect(() => CacheValidation.validateTimeRange(1609459200, 1609459200)).not.toThrow();
    });

    it('should throw for invalid time range', () => {
      expect(() => CacheValidation.validateTimeRange(1609545600, 1609459200))
        .toThrow('Invalid time range: from time cannot be greater than to time');
    });
  });
});