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
  /** Whether cache was disabled for this query */
  cacheDisabled?: boolean;
  /** Block height when data was cached (optional) */
  height?: number;
  
  // SDK-provided context (optional)
  /** Stream ID used in the query */
  streamId?: string;
  /** Data provider address */
  dataProvider?: string;
  /** Start time of the query range */
  from?: number;
  /** End time of the query range */
  to?: number;
  /** Frozen time for historical queries */
  frozenAt?: number;
  /** Number of rows returned */
  rowsServed?: number;
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
 * Aggregated cache metadata from multiple operations
 */
export interface CacheMetadataCollection {
  /** Total number of queries performed */
  totalQueries: number;
  /** Number of cache hits */
  cacheHits: number;
  /** Number of cache misses */
  cacheMisses: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
  /** Total rows served across all queries */
  totalRowsServed: number;
  /** Individual metadata entries */
  entries: CacheMetadata[];
}

/**
 * Error class for cache-related operations
 */
export class CacheError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'CacheError';

    // Fix prototype chain
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}