// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    includeSource: ['src/**/*.{js,ts}'],
    setupFiles: ['dotenv/config', 'disposablestack/auto'],
    maxConcurrency: 1, // Disable concurrency to avoid nonce errors
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    hookTimeout: 900000, // 900 seconds (15 minutes) for setup hooks (Docker containers in CI)
  },
  ssr: {
    noExternal: ['@trufnetwork/kwil-js'],
  },
})
