import { CacheMetadata, CacheMetadataCollection } from '../types/cache';

/**
 * Parser for extracting cache metadata from action logs
 * Handles the parsing of cache-related information from SQL action responses
 */
export class CacheMetadataParser {
  /**
   * Parses logs and removes prepended numeric prefixes (e.g., "1. ", "2. ")
   * @param logsInput - The logs string or array to parse
   * @returns Array of clean log lines
   */
  private static parseLogsForMetadata(logsInput: string | string[]): string[] {
    const logs: string[] = [];
    const logArray = Array.isArray(logsInput) ? logsInput : [logsInput];
    
    for (const log of logArray) {
      if (!log || typeof log !== 'string') {
        continue;
      }
      
      const lines = log.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) {
          continue;
        }
        
        // Check for prepended numeric format (e.g., "1. ", "2. ")
        const dotSpaceIndex = trimmedLine.indexOf('. ');
        if (dotSpaceIndex > 0) {
          const prefix = trimmedLine.substring(0, dotSpaceIndex);
          // Check if prefix is a number
          if (/^\d+$/.test(prefix)) {
            const cleanLine = trimmedLine.substring(dotSpaceIndex + 2).trim();
            if (cleanLine) {
              logs.push(cleanLine);
            }
            continue;
          }
        }
        
        // If no prepended format found, add the line as-is
        logs.push(trimmedLine);
      }
    }
    
    return logs;
  }

  /**
   * Extracts cache metadata from action logs
   * @param logs - The action logs returned from the backend (may be a single string or array)
   * @returns Cache metadata if found, null otherwise
   */
  static extractFromLogs(logs: string | string[]): CacheMetadata | null {
    // Parse logs and remove prepended numeric prefixes
    const logLines = this.parseLogsForMetadata(logs);
    
    for (const line of logLines) {
      // Look for cache-related log entries
      if (line.includes('cache_hit')) {
        try {
          // Try to parse as JSON
          const logData = JSON.parse(line);
          
          // Check if this is a cache hit entry
          if (logData.cache_hit === true) {
            return {
              hit: true,
              cacheDisabled: logData.cache_disabled,
              height: logData.cache_height ? Number(logData.cache_height) : undefined
            };
          }
          
          // Cache miss case
          if (logData.cache_hit === false) {
            return {
              hit: false,
              cacheDisabled: logData.cache_disabled,
              height: undefined
            };
          }
          
        } catch (error) {
          // If JSON parsing fails, continue checking other logs
          // This is expected for non-JSON log entries
          continue;
        }
      }
    }
    
    // No cache metadata found
    return null;
  }
  
  /**
   * Validates cache metadata structure
   * @param metadata - The cache metadata to validate
   * @returns True if metadata is valid, false otherwise
   */
  static isValidCacheMetadata(metadata: any): metadata is CacheMetadata {
    if (!metadata || typeof metadata !== 'object') {
      return false;
    }
    
    // Check required fields
    if (typeof metadata.hit !== 'boolean') {
      return false;
    }
    
    // Check optional fields
    if (metadata.cacheDisabled !== undefined && typeof metadata.cacheDisabled !== 'boolean') {
      return false;
    }
    
    if (metadata.streamId !== undefined && typeof metadata.streamId !== 'string') {
      return false;
    }
    
    if (metadata.dataProvider !== undefined && typeof metadata.dataProvider !== 'string') {
      return false;
    }
    
    if (metadata.from !== undefined && typeof metadata.from !== 'number') {
      return false;
    }
    
    if (metadata.to !== undefined && typeof metadata.to !== 'number') {
      return false;
    }
    
    if (metadata.frozenAt !== undefined && typeof metadata.frozenAt !== 'number') {
      return false;
    }
    
    if (metadata.rowsServed !== undefined && typeof metadata.rowsServed !== 'number') {
      return false;
    }

    if (metadata.height !== undefined && typeof metadata.height !== 'number') {
      return false;
    }
    
    return true;
  }
  
  /**
   * Extracts cache metadata from Kwil response structure
   * @param response - The full response from Kwil client
   * @returns Cache metadata if found, null otherwise
   */
  static extractFromResponse(response: any): CacheMetadata | null {
    // Check if response has logs
    if (!response || !response.logs) {
      return null;
    }
    
    return this.extractFromLogs(response.logs);
  }
  
  /**
   * Aggregates multiple cache metadata entries into a collection
   * @param metadataList - Array of cache metadata entries
   * @returns Aggregated cache metadata collection
   */
  static aggregate(metadataList: CacheMetadata[]): CacheMetadataCollection {
    const totalQueries = metadataList.length;
    let cacheHits = 0;
    let totalRowsServed = 0;
    
    for (const metadata of metadataList) {
      if (metadata.hit) {
        cacheHits++;
      }
      
      if (metadata.rowsServed) {
        totalRowsServed += metadata.rowsServed;
      }
    }
    
    const cacheMisses = totalQueries - cacheHits;
    const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;
    
    return {
      totalQueries,
      cacheHits,
      cacheMisses,
      cacheHitRate,
      totalRowsServed,
      entries: metadataList
    };
  }
}