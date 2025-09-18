// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: ['src/**/*.{js,ts}'],
    setupFiles: ['dotenv/config', 'disposablestack/auto'],
    maxConcurrency: 1, // Disable concurrency to avoid nonce errors
    fileParallelism: false,
    hookTimeout: 120000, // 120 seconds for setup hooks (Docker containers)
  },
  ssr: {
    noExternal: ['@trufnetwork/kwil-js'],
  },
})
