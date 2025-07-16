/**
 * Cache-related type definitions for the Truf Network SDK
 * These types enable cache-aware operations with proper TypeScript support
 */

/**
 * Metadata about cache operations
 * Matches the Go SDK implementation structure
 */
export interface CacheMetadata {
  /** Whether the data came from cache */
  hit: boolean;
  /** Unix timestamp when data was cached (optional) */
  cachedAt?: number;
}

/**
 * Enhanced options for getRecord method with cache support
 */
export interface GetRecordOptions {
  /** Start time for the query range */
  from?: number;
  /** End time for the query range */
  to?: number;
  /** Frozen time for historical queries */
  frozenAt?: number;
  /** Base time for index calculations */
  baseTime?: string | number;
  /** Procedure name prefix */
  prefix?: string;
  /** Enable cache usage for this query */
  useCache?: boolean;
}

/**
 * Enhanced options for getIndex method with cache support
 */
export interface GetIndexOptions {
  /** Start time for the query range */
  from?: number;
  /** End time for the query range */
  to?: number;
  /** Frozen time for historical queries */
  frozenAt?: number;
  /** Base time for index calculations */
  baseTime?: string | number;
  /** Procedure name prefix */
  prefix?: string;
  /** Enable cache usage for this query */
  useCache?: boolean;
}

/**
 * Enhanced options for getIndexChange method with cache support
 */
export interface GetIndexChangeOptions {
  /** Start time for the query range */
  from?: number;
  /** End time for the query range */
  to?: number;
  /** Frozen time for historical queries */
  frozenAt?: number;
  /** Base time for index calculations */
  baseTime?: string | number;
  /** Time interval for change calculations */
  timeInterval: number;
  /** Procedure name prefix */
  prefix?: string;
  /** Enable cache usage for this query */
  useCache?: boolean;
}

/**
 * Enhanced options for getFirstRecord method with cache support
 */
export interface GetFirstRecordOptions {
  /** Return records after this time */
  after?: number;
  /** Frozen time for historical queries */
  frozenAt?: number;
  /** Enable cache usage for this query */
  useCache?: boolean;
}

/**
 * Response wrapper that includes cache metadata
 * Provides structured access to both data and cache information
 */
export interface CacheAwareResponse<T> {
  /** The actual response data */
  data: T;
  /** Cache metadata (if available) */
  cache?: CacheMetadata;
  /** Action logs for debugging (optional) */
  logs?: string[];
}

/**
 * Error class for cache-related operations
 */
export class CacheError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'CacheError';
  }
}