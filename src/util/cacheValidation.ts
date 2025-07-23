import { GetRecordOptions, GetIndexOptions, GetIndexChangeOptions, GetFirstRecordOptions } from '../types/cache';

/**
 * Validation utilities for cache-related parameters
 */
export class CacheValidation {
  /**
   * Validates GetRecordOptions parameters
   */
  static validateGetRecordOptions(options: GetRecordOptions): void {
    if (options.from !== undefined && (typeof options.from !== 'number' || options.from < 0)) {
      throw new Error('Invalid from parameter: must be a non-negative number');
    }
    
    if (options.to !== undefined && (typeof options.to !== 'number' || options.to < 0)) {
      throw new Error('Invalid to parameter: must be a non-negative number');
    }
    
    if (options.frozenAt !== undefined && (typeof options.frozenAt !== 'number' || options.frozenAt < 0)) {
      throw new Error('Invalid frozenAt parameter: must be a non-negative number');
    }
    
    if (options.useCache !== undefined && typeof options.useCache !== 'boolean') {
      throw new Error('Invalid useCache parameter: must be a boolean');
    }
    
    if (options.prefix !== undefined && typeof options.prefix !== 'string') {
      throw new Error('Invalid prefix parameter: must be a string');
    }
    
    if (options.baseTime !== undefined && typeof options.baseTime !== 'number' && typeof options.baseTime !== 'string') {
      throw new Error('Invalid baseTime parameter: must be a number or string');
    }
  }
  
  /**
   * Validates GetIndexOptions parameters
   */
  static validateGetIndexOptions(options: GetIndexOptions): void {
    // GetIndexOptions has the same validation as GetRecordOptions
    this.validateGetRecordOptions(options);
  }
  
  /**
   * Validates GetIndexChangeOptions parameters
   */
  static validateGetIndexChangeOptions(options: GetIndexChangeOptions): void {
    // Validate base options
    this.validateGetRecordOptions(options);
    
    // Validate timeInterval - required for index change
    if (typeof options.timeInterval !== 'number' || options.timeInterval <= 0) {
      throw new Error('Invalid timeInterval parameter: must be a positive number');
    }
  }
  
  /**
   * Validates GetFirstRecordOptions parameters
   */
  static validateGetFirstRecordOptions(options: GetFirstRecordOptions): void {
    if (options.after !== undefined && (typeof options.after !== 'number' || options.after < 0)) {
      throw new Error('Invalid after parameter: must be a non-negative number');
    }
    
    if (options.frozenAt !== undefined && (typeof options.frozenAt !== 'number' || options.frozenAt < 0)) {
      throw new Error('Invalid frozenAt parameter: must be a non-negative number');
    }
    
    if (options.useCache !== undefined && typeof options.useCache !== 'boolean') {
      throw new Error('Invalid useCache parameter: must be a boolean');
    }
  }
  
  /**
   * Validates time range parameters
   */
  static validateTimeRange(from?: number, to?: number): void {
    if (from !== undefined && to !== undefined && from > to) {
      throw new Error('Invalid time range: from time cannot be greater than to time');
    }
  }
}