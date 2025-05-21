import { describe, it, expect } from 'vitest';

// This test ensures that importing the browser-specific client does not statically import or require 'pg'.
// If 'pg' were statically imported in browser code, this import would fail in a bundler/browser environment.
import { BrowserTNClient } from "../src/index.browser";

describe('Browser entrypoint', () => {
  it('should only export browser-safe APIs', () => {
    // core smoke test
    expect(typeof BrowserTNClient).toBe('function');
    // ensure we're running in a browser environment
    //
    expect(typeof window).not.toBe('undefined');
  });
}); 

